package com.lemtel.softphone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import okhttp3.*
import okio.ByteString
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Foreground service that maintains a native Kotlin WebSocket connection to
 * FreeSWITCH Verto (port 8082) independently of the WebView / JavaScript layer.
 *
 * This ensures the extension stays REGISTERED even when:
 *  - The screen is locked
 *  - The app is in the background
 *  - Android throttles JS timers in the WebView
 *
 * The service holds a PARTIAL_WAKE_LOCK (CPU) and WIFI_MODE_FULL_HIGH_PERF
 * WifiLock (radio) so the WebSocket stays alive 24/7.
 *
 * Credentials are stored in SharedPreferences by CapacitorPjsip when the JS
 * layer calls startSipService({ host, port, login, password, domain }).
 *
 * When an incoming call arrives (verto.invite), the service fires a local
 * notification so the user can tap to open the app and answer.
 */
class SipConnectionService : Service() {

    companion object {
        const val TAG = "SipConnectionService"
        const val CHANNEL_ID = "sip_connection_channel"
        const val CALL_CHANNEL_ID = "sip_incoming_call_channel"
        const val NOTIFICATION_ID = 1001
        const val INCOMING_CALL_NOTIFICATION_ID = 1002
        const val PREFS_NAME = "verto_creds"

        // Keys stored in SharedPreferences
        const val KEY_HOST = "verto_host"
        const val KEY_PORT = "verto_port"
        const val KEY_LOGIN = "verto_login"
        const val KEY_PASSWORD = "verto_password"
        const val KEY_DOMAIN = "verto_domain"
        const val KEY_DISPLAY_NAME = "verto_display_name"

        fun start(context: Context) {
            val intent = Intent(context, SipConnectionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SipConnectionService::class.java))
        }

        fun saveCredentials(
            context: Context,
            host: String, port: Int, login: String,
            password: String, domain: String, displayName: String
        ) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
                putString(KEY_HOST, host)
                putInt(KEY_PORT, port)
                putString(KEY_LOGIN, login)
                putString(KEY_PASSWORD, password)
                putString(KEY_DOMAIN, domain)
                putString(KEY_DISPLAY_NAME, displayName)
                apply()
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var okHttpClient: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private val handler = Handler(Looper.getMainLooper())
    private var sessionUUID: String = UUID.randomUUID().toString()
    private var isLoggedIn = false
    private var reconnectAttempt = 0
    private var isDestroyed = false

    // Ping interval to keep WebSocket alive (every 25 seconds)
    private val pingRunnable = object : Runnable {
        override fun run() {
            if (!isDestroyed) {
                sendPing()
                handler.postDelayed(this, 25_000)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "LemtelSoftphone::SipWakeLock"
        ).apply {
            setReferenceCounted(false)
            acquire()
        }

        val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wifiManager.createWifiLock(
            WifiManager.WIFI_MODE_FULL_HIGH_PERF,
            "LemtelSoftphone::SipWifiLock"
        ).apply {
            setReferenceCounted(false)
            acquire()
        }

        okHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("Connecté · Prêt à recevoir des appels")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // Connect native WebSocket to Verto
        connectVerto()

        return START_STICKY
    }

    override fun onDestroy() {
        isDestroyed = true
        handler.removeCallbacks(pingRunnable)
        webSocket?.close(1000, "Service stopped")
        webSocket = null
        okHttpClient?.dispatcher?.executorService?.shutdown()
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Verto WebSocket ──────────────────────────────────────────────────────

    private fun connectVerto() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val host = prefs.getString(KEY_HOST, "pbxnode.lemtel.tel") ?: "pbxnode.lemtel.tel"
        val port = prefs.getInt(KEY_PORT, 8082)
        val login = prefs.getString(KEY_LOGIN, "") ?: ""
        val password = prefs.getString(KEY_PASSWORD, "") ?: ""

        if (login.isEmpty() || password.isEmpty()) {
            Log.w(TAG, "No credentials stored — skipping native Verto connect")
            return
        }

        val url = "wss://$host:$port"
        Log.i(TAG, "Connecting native Verto WebSocket to $url ext=$login")

        val request = Request.Builder()
            .url(url)
            .addHeader("Sec-WebSocket-Protocol", "json")
            .build()

        sessionUUID = UUID.randomUUID().toString()
        isLoggedIn = false

        webSocket = okHttpClient?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "Verto WS opened — sending verto.login")
                sendVertoLogin(ws, login, password)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleVertoMessage(text)
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                handleVertoMessage(bytes.utf8())
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "Verto WS closing: $code $reason")
                ws.close(1000, null)
                isLoggedIn = false
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "Verto WS closed: $code $reason — scheduling reconnect")
                isLoggedIn = false
                scheduleReconnect()
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Verto WS failure: ${t.message} — scheduling reconnect")
                isLoggedIn = false
                scheduleReconnect()
            }
        })
    }

    private fun sendVertoLogin(ws: WebSocket, login: String, password: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val domain = prefs.getString(KEY_DOMAIN, "lemtel.lemtel.tel") ?: "lemtel.lemtel.tel"
        val displayName = prefs.getString(KEY_DISPLAY_NAME, login) ?: login

        val msg = JSONObject().apply {
            put("jsonrpc", "2.0")
            put("id", 1)
            put("method", "login")
            put("params", JSONObject().apply {
                put("login", "$login@$domain")
                put("passwd", password)
                put("sessid", sessionUUID)
                put("userVariables", JSONObject().apply {
                    put("email", login)
                    put("display_name", displayName)
                })
            })
        }
        ws.send(msg.toString())
    }

    private fun handleVertoMessage(text: String) {
        try {
            val json = JSONObject(text)
            val method = json.optString("method")
            val result = json.optJSONObject("result")

            when {
                // Login response
                result != null && json.optInt("id") == 1 -> {
                    val sessid = result.optString("sessid")
                    if (sessid.isNotEmpty()) {
                        isLoggedIn = true
                        reconnectAttempt = 0
                        Log.i(TAG, "Verto login SUCCESS — extension registered ✅")
                        updateNotification("Connecté · Prêt à recevoir des appels")
                        // Start ping keepalive
                        handler.removeCallbacks(pingRunnable)
                        handler.postDelayed(pingRunnable, 25_000)
                    } else {
                        Log.e(TAG, "Verto login FAILED: $text")
                        scheduleReconnect()
                    }
                }

                // Incoming call
                method == "verto.invite" -> {
                    val params = json.optJSONObject("params")
                    val callID = params?.optString("callID") ?: ""
                    val callerIdName = params?.optString("caller_id_name") ?: "Appel entrant"
                    val callerIdNumber = params?.optString("caller_id_number") ?: ""
                    Log.i(TAG, "Incoming call from $callerIdName <$callerIdNumber> callID=$callID")
                    showIncomingCallNotification(callerIdName, callerIdNumber)
                }

                // Ping response (keep-alive)
                method == "verto.pong" || (result != null && result.has("pong")) -> {
                    Log.d(TAG, "Verto pong received")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse Verto message: ${e.message}")
        }
    }

    private fun sendPing() {
        val ws = webSocket ?: return
        if (!isLoggedIn) return
        try {
            val ping = JSONObject().apply {
                put("jsonrpc", "2.0")
                put("id", System.currentTimeMillis().toInt())
                put("method", "verto.ping")
                put("params", JSONObject().apply {
                    put("sessid", sessionUUID)
                })
            }
            ws.send(ping.toString())
        } catch (e: Exception) {
            Log.w(TAG, "Ping failed: ${e.message}")
        }
    }

    private fun scheduleReconnect() {
        if (isDestroyed) return
        reconnectAttempt++
        val delay = minOf(5_000L * reconnectAttempt, 30_000L)
        Log.i(TAG, "Scheduling Verto reconnect in ${delay}ms (attempt $reconnectAttempt)")
        updateNotification("Reconnexion en cours...")
        handler.postDelayed({
            if (!isDestroyed) {
                webSocket?.cancel()
                webSocket = null
                connectVerto()
            }
        }, delay)
    }

    // ── Notifications ────────────────────────────────────────────────────────

    private fun showIncomingCallNotification(callerName: String, callerNumber: String) {
        val nm = getSystemService(NotificationManager::class.java)
        val notification = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setContentTitle("Appel entrant")
            .setContentText("$callerName ${if (callerNumber.isNotEmpty()) "<$callerNumber>" else ""}")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setFullScreenIntent(null, true)
            .build()
        nm.notify(INCOMING_CALL_NOTIFICATION_ID, notification)
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Lemtel Softphone")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)

            // Persistent connection channel (low priority — no sound)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Connexion SIP", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Maintien de la connexion téléphonique"
                    setShowBadge(false)
                }
            )

            // Incoming call channel (high priority — full screen intent)
            nm.createNotificationChannel(
                NotificationChannel(CALL_CHANNEL_ID, "Appels entrants", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Notifications d'appels entrants"
                    setShowBadge(true)
                }
            )
        }
    }
}
