package com.lemtel.softphone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Foreground service that maintains a native Kotlin WebSocket connection to
 * FreeSWITCH Verto (port 8082) independently of the WebView / JavaScript layer.
 *
 * Uses only Android-native APIs (javax.net.ssl.SSLSocket) — no OkHttp dependency.
 * This ensures the extension stays REGISTERED even when:
 *  - The screen is locked
 *  - The app is in the background
 *  - Android throttles JS timers in the WebView
 */
class SipConnectionService : Service() {

    companion object {
        const val TAG = "SipConnectionService"
        const val CHANNEL_ID = "sip_connection_channel"
        const val CALL_CHANNEL_ID = "sip_incoming_call_channel"
        const val NOTIFICATION_ID = 1001
        const val INCOMING_CALL_NOTIFICATION_ID = 1002
        const val PREFS_NAME = "verto_creds"

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
    private val executor: ScheduledExecutorService = Executors.newScheduledThreadPool(2)
    private val handler = Handler(Looper.getMainLooper())
    private var isDestroyed = false

    // WebSocket state
    private var sslSocket: SSLSocket? = null
    private var outputStream: OutputStream? = null
    private var sessionUUID: String = UUID.randomUUID().toString()
    private var isLoggedIn = false
    private var reconnectAttempt = 0
    private var pingFuture: ScheduledFuture<*>? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LemtelSoftphone::SipWakeLock").apply {
            setReferenceCounted(false)
            acquire()
        }

        val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "LemtelSoftphone::SipWifiLock").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("Connecté · Prêt à recevoir des appels")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        executor.submit { connectVerto() }
        return START_STICKY
    }

    override fun onDestroy() {
        isDestroyed = true
        pingFuture?.cancel(true)
        closeSocket()
        executor.shutdownNow()
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── WebSocket (RFC 6455) over TLS ────────────────────────────────────────

    private fun connectVerto() {
        if (isDestroyed) return
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val host = prefs.getString(KEY_HOST, "pbxnode.lemtel.tel") ?: "pbxnode.lemtel.tel"
        val port = prefs.getInt(KEY_PORT, 8082)
        val login = prefs.getString(KEY_LOGIN, "") ?: ""
        val password = prefs.getString(KEY_PASSWORD, "") ?: ""
        val domain = prefs.getString(KEY_DOMAIN, "lemtel.lemtel.tel") ?: "lemtel.lemtel.tel"
        val displayName = prefs.getString(KEY_DISPLAY_NAME, login) ?: login

        if (login.isEmpty() || password.isEmpty()) {
            Log.w(TAG, "No credentials stored — skipping native Verto connect")
            return
        }

        try {
            Log.i(TAG, "Connecting native Verto WS to wss://$host:$port ext=$login")
            updateNotification("Connexion en cours...")

            val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
            val socket = factory.createSocket(host, port) as SSLSocket
            socket.soTimeout = 60_000
            socket.startHandshake()

            // WebSocket HTTP Upgrade handshake
            val wsKey = Base64.encodeToString(ByteArray(16).also { SecureRandom().nextBytes(it) }, Base64.NO_WRAP)
            val handshake = buildString {
                append("GET / HTTP/1.1\r\n")
                append("Host: $host:$port\r\n")
                append("Upgrade: websocket\r\n")
                append("Connection: Upgrade\r\n")
                append("Sec-WebSocket-Key: $wsKey\r\n")
                append("Sec-WebSocket-Version: 13\r\n")
                append("Sec-WebSocket-Protocol: json\r\n")
                append("\r\n")
            }
            socket.outputStream.write(handshake.toByteArray(Charsets.US_ASCII))
            socket.outputStream.flush()

            // Read HTTP response
            val reader = BufferedReader(InputStreamReader(socket.inputStream, Charsets.US_ASCII))
            val statusLine = reader.readLine() ?: throw Exception("No HTTP response")
            if (!statusLine.contains("101")) throw Exception("WS upgrade failed: $statusLine")
            // Drain headers
            while (true) { val line = reader.readLine() ?: break; if (line.isEmpty()) break }

            sslSocket = socket
            outputStream = socket.outputStream
            sessionUUID = UUID.randomUUID().toString()
            isLoggedIn = false
            reconnectAttempt = 0

            // Send verto.login
            sendVertoLogin(login, password, domain, displayName)

            // Start ping keepalive
            pingFuture?.cancel(false)
            pingFuture = executor.scheduleAtFixedRate({
                if (isLoggedIn && !isDestroyed) sendPing()
            }, 25, 25, TimeUnit.SECONDS)

            // Read loop
            readLoop(socket)

        } catch (e: Exception) {
            Log.e(TAG, "Verto WS error: ${e.message}")
            isLoggedIn = false
            closeSocket()
            scheduleReconnect()
        }
    }

    private fun readLoop(socket: SSLSocket) {
        try {
            val input = socket.inputStream
            while (!isDestroyed && !socket.isClosed) {
                // Read WebSocket frame header (2 bytes minimum)
                val b0 = input.read()
                val b1 = input.read()
                if (b0 < 0 || b1 < 0) break

                val isMasked = (b1 and 0x80) != 0
                var payloadLen = (b1 and 0x7F).toLong()

                payloadLen = when (payloadLen.toInt()) {
                    126 -> {
                        val ext = ByteArray(2)
                        input.read(ext)
                        ((ext[0].toInt() and 0xFF) shl 8 or (ext[1].toInt() and 0xFF)).toLong()
                    }
                    127 -> {
                        val ext = ByteArray(8)
                        input.read(ext)
                        var len = 0L
                        for (i in 0..7) len = (len shl 8) or (ext[i].toLong() and 0xFF)
                        len
                    }
                    else -> payloadLen
                }

                val maskKey = if (isMasked) ByteArray(4).also { input.read(it) } else null
                val payload = ByteArray(payloadLen.toInt())
                var read = 0
                while (read < payload.size) {
                    val n = input.read(payload, read, payload.size - read)
                    if (n < 0) break
                    read += n
                }
                if (maskKey != null) {
                    for (i in payload.indices) payload[i] = (payload[i].toInt() xor maskKey[i % 4].toInt()).toByte()
                }

                val opcode = b0 and 0x0F
                when (opcode) {
                    0x1 -> handleVertoMessage(String(payload, Charsets.UTF_8)) // text
                    0x8 -> { Log.i(TAG, "Verto WS close frame"); break }        // close
                    0x9 -> sendPong(payload)                                     // ping
                }
            }
        } catch (e: Exception) {
            if (!isDestroyed) Log.w(TAG, "Read loop ended: ${e.message}")
        }
        isLoggedIn = false
        closeSocket()
        if (!isDestroyed) scheduleReconnect()
    }

    private fun sendFrame(text: String) {
        try {
            val payload = text.toByteArray(Charsets.UTF_8)
            val out = outputStream ?: return
            // Client frames must be masked
            val mask = ByteArray(4).also { SecureRandom().nextBytes(it) }
            val masked = ByteArray(payload.size) { i -> (payload[i].toInt() xor mask[i % 4].toInt()).toByte() }

            val header = mutableListOf<Byte>()
            header.add(0x81.toByte()) // FIN + text opcode
            when {
                payload.size <= 125 -> header.add((0x80 or payload.size).toByte())
                payload.size <= 65535 -> {
                    header.add((0x80 or 126).toByte())
                    header.add((payload.size shr 8).toByte())
                    header.add((payload.size and 0xFF).toByte())
                }
                else -> {
                    header.add((0x80 or 127).toByte())
                    for (i in 7 downTo 0) header.add(((payload.size.toLong() shr (i * 8)) and 0xFF).toByte())
                }
            }
            header.addAll(mask.toList())
            out.write(header.toByteArray())
            out.write(masked)
            out.flush()
        } catch (e: Exception) {
            Log.w(TAG, "sendFrame failed: ${e.message}")
        }
    }

    private fun sendPong(payload: ByteArray) {
        try {
            val out = outputStream ?: return
            out.write(byteArrayOf(0x8A.toByte(), payload.size.toByte()))
            out.write(payload)
            out.flush()
        } catch (e: Exception) { /* ignore */ }
    }

    private fun closeSocket() {
        try { sslSocket?.close() } catch (e: Exception) { /* ignore */ }
        sslSocket = null
        outputStream = null
    }

    // ── Verto protocol ───────────────────────────────────────────────────────

    private fun sendVertoLogin(login: String, password: String, domain: String, displayName: String) {
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
        sendFrame(msg.toString())
    }

    private fun sendPing() {
        if (!isLoggedIn) return
        try {
            val ping = JSONObject().apply {
                put("jsonrpc", "2.0")
                put("id", System.currentTimeMillis().toInt())
                put("method", "verto.ping")
                put("params", JSONObject().apply { put("sessid", sessionUUID) })
            }
            sendFrame(ping.toString())
        } catch (e: Exception) {
            Log.w(TAG, "Ping failed: ${e.message}")
        }
    }

    private fun handleVertoMessage(text: String) {
        try {
            val json = JSONObject(text)
            val method = json.optString("method")
            val result = json.optJSONObject("result")

            when {
                result != null && json.optInt("id") == 1 -> {
                    val sessid = result.optString("sessid")
                    if (sessid.isNotEmpty()) {
                        isLoggedIn = true
                        reconnectAttempt = 0
                        Log.i(TAG, "Verto login SUCCESS — extension registered ✅")
                        handler.post { updateNotification("Connecté · Prêt à recevoir des appels") }
                    } else {
                        Log.e(TAG, "Verto login FAILED: $text")
                        scheduleReconnect()
                    }
                }
                method == "verto.invite" -> {
                    val params = json.optJSONObject("params")
                    val callerName = params?.optString("caller_id_name") ?: "Appel entrant"
                    val callerNumber = params?.optString("caller_id_number") ?: ""
                    Log.i(TAG, "Incoming call: $callerName <$callerNumber>")
                    handler.post { showIncomingCallNotification(callerName, callerNumber) }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse Verto message: ${e.message}")
        }
    }

    private fun scheduleReconnect() {
        if (isDestroyed) return
        reconnectAttempt++
        val delay = minOf(5_000L * reconnectAttempt, 30_000L)
        Log.i(TAG, "Reconnecting in ${delay}ms (attempt $reconnectAttempt)")
        handler.post { updateNotification("Reconnexion en cours...") }
        executor.schedule({ if (!isDestroyed) connectVerto() }, delay, TimeUnit.MILLISECONDS)
    }

    // ── Notifications ────────────────────────────────────────────────────────

    private fun showIncomingCallNotification(callerName: String, callerNumber: String) {
        val nm = getSystemService(NotificationManager::class.java)
        val notification = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setContentTitle("Appel entrant — Lemtel")
            .setContentText("$callerName${if (callerNumber.isNotEmpty()) " <$callerNumber>" else ""}")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
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
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Connexion SIP", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Maintien de la connexion téléphonique"
                    setShowBadge(false)
                }
            )
            nm.createNotificationChannel(
                NotificationChannel(CALL_CHANNEL_ID, "Appels entrants", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Notifications d'appels entrants"
                    setShowBadge(true)
                }
            )
        }
    }
}
