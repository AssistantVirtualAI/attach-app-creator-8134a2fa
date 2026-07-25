package com.lemtel.softphone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
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
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.SocketTimeoutException
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

        const val ACTION_STATUS = "com.lemtel.softphone.SIP_SERVICE_STATUS"
        const val KEY_STATUS = "verto_native_status"
        const val KEY_REASON = "verto_native_reason"
        const val KEY_UPDATED_AT = "verto_native_updated_at"
        const val KEY_LAST_LOGIN_AT = "verto_native_last_login_at"
        const val KEY_LAST_PING_AT = "verto_native_last_ping_at"
        const val KEY_LAST_FRAME_AT = "verto_native_last_frame_at"
        const val KEY_RECONNECT_ATTEMPT = "verto_native_reconnect_attempt"
        const val KEY_CONNECTING = "verto_native_connecting"
        const val KEY_LOGGED_IN = "verto_native_logged_in"
        const val KEY_WAKE_HELD = "verto_native_wake_held"
        const val KEY_WIFI_HELD = "verto_native_wifi_held"

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
    private var reconnectFuture: ScheduledFuture<*>? = null
    @Volatile private var connecting = false
    @Volatile private var lastFrameAt = 0L
    @Volatile private var lastLoginAt = 0L
    @Volatile private var lastPingAt = 0L
    @Volatile private var lastReason = ""
    @Volatile private var currentCallId: String? = null
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var callActionReceiver: android.content.BroadcastReceiver? = null

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
        emitStatus("idle", "service_created")
        registerNetworkWatchdog()
        registerCallActionReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification("Connecté · Prêt à recevoir des appels")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        emitStatus(if (isLoggedIn) "registered" else "connecting", "service_start")
        if (!isLoggedIn && !connecting) executor.submit { connectVerto() }
        return START_STICKY
    }

    override fun onDestroy() {
        isDestroyed = true
        pingFuture?.cancel(true)
        reconnectFuture?.cancel(true)
        unregisterNetworkWatchdog()
        unregisterCallActionReceiver()
        try { AudioFocusHelper.releaseCallAudioFocus(this) } catch (_: Exception) {}
        closeSocket()
        executor.shutdownNow()
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Keep the SIP/Verto foreground registration alive even if Android removes
        // the WebView task. The stored credentials let the sticky service restore
        // the connection without opening the UI.
        emitStatus("reconnecting", "task_removed")
        scheduleReconnect(1_000L)
        super.onTaskRemoved(rootIntent)
    }

    // ── WebSocket (RFC 6455) over TLS ────────────────────────────────────────

    private fun connectVerto() {
        if (isDestroyed) return
        if (connecting) return
        connecting = true
        reconnectFuture?.cancel(false)
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val host = prefs.getString(KEY_HOST, "pbxnode.lemtel.tel") ?: "pbxnode.lemtel.tel"
        val port = prefs.getInt(KEY_PORT, 8082)
        val login = prefs.getString(KEY_LOGIN, "") ?: ""
        val password = prefs.getString(KEY_PASSWORD, "") ?: ""
        val domain = prefs.getString(KEY_DOMAIN, "lemtel.lemtel.tel") ?: "lemtel.lemtel.tel"
        val displayName = prefs.getString(KEY_DISPLAY_NAME, login) ?: login

        if (login.isEmpty() || password.isEmpty()) {
            Log.w(TAG, "No credentials stored — skipping native Verto connect")
            connecting = false
            emitStatus("error", "missing_credentials")
            return
        }

        try {
            Log.i(TAG, "Connecting native Verto WS to wss://$host:$port ext=$login")
            updateNotification("Connexion en cours...")
            emitStatus("connecting", "open_socket")

            val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
            val socket = factory.createSocket(host, port) as SSLSocket
            socket.keepAlive = true
            // Detect dead sockets faster: 30s read timeout + ping every 15s so
            // Doze/network-drop induced silence is caught within ~45s instead of ~95s.
            socket.soTimeout = 30_000
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

            // Read HTTP response without BufferedReader so it cannot pre-buffer
            // the first WebSocket frame after \r\n\r\n. Losing that frame can
            // make the native background service think it never registered.
            val responseHeader = readHttpHeader(socket)
            val statusLine = responseHeader.lineSequence().firstOrNull() ?: throw Exception("No HTTP response")
            if (!statusLine.contains("101")) throw Exception("WS upgrade failed: $statusLine")

            sslSocket = socket
            outputStream = socket.outputStream
            sessionUUID = UUID.randomUUID().toString()
            isLoggedIn = false
            lastFrameAt = System.currentTimeMillis()
            connecting = false
            emitStatus("connecting", "ws_upgraded")

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
            connecting = false
            emitStatus("disconnected", e.message ?: "verto_ws_error")
            closeSocket()
            scheduleReconnect()
        }
    }

    private fun readLoop(socket: SSLSocket) {
        try {
            val input = socket.inputStream
            while (!isDestroyed && !socket.isClosed) {
                // Read WebSocket frame header (2 bytes minimum)
                val b0: Int
                val b1: Int
                try {
                    b0 = input.read()
                    b1 = input.read()
                } catch (_: SocketTimeoutException) {
                    if (isLoggedIn && System.currentTimeMillis() - lastFrameAt < 95_000L) continue
                    if (isLoggedIn) throw Exception("Verto socket stale in background")
                    throw Exception("Verto read timeout before login")
                }
                if (b0 < 0 || b1 < 0) break
                lastFrameAt = System.currentTimeMillis()

                val isMasked = (b1 and 0x80) != 0
                var payloadLen = (b1 and 0x7F).toLong()

                payloadLen = when (payloadLen.toInt()) {
                    126 -> {
                        val ext = input.readExact(2)
                        ((ext[0].toInt() and 0xFF) shl 8 or (ext[1].toInt() and 0xFF)).toLong()
                    }
                    127 -> {
                        val ext = input.readExact(8)
                        var len = 0L
                        for (i in 0..7) len = (len shl 8) or (ext[i].toLong() and 0xFF)
                        len
                    }
                    else -> payloadLen
                }

                val maskKey = if (isMasked) input.readExact(4) else null
                val payload = input.readExact(payloadLen.toInt())
                if (maskKey != null) {
                    for (i in payload.indices) payload[i] = (payload[i].toInt() xor maskKey[i % 4].toInt()).toByte()
                }

                val opcode = b0 and 0x0F
                when (opcode) {
                    0x1 -> handleVertoMessage(String(payload, Charsets.UTF_8)) // text
                    0x8 -> { Log.i(TAG, "Verto WS close frame"); break }        // close
                    0x9 -> sendPong(payload)                                     // ping
                    0xA -> { /* pong */ }
                }
            }
        } catch (e: Exception) {
            if (!isDestroyed) Log.w(TAG, "Read loop ended: ${e.message}")
        }
        isLoggedIn = false
        connecting = false
        emitStatus("disconnected", "read_loop_ended")
        closeSocket()
        if (!isDestroyed) scheduleReconnect()
    }

    private fun readHttpHeader(socket: SSLSocket): String {
        val input = socket.inputStream
        val buffer = ByteArrayOutputStream()
        var previous3 = -1
        var previous2 = -1
        var previous1 = -1
        while (buffer.size() < 16_384) {
            val b = input.read()
            if (b < 0) break
            buffer.write(b)
            if (previous3 == '\r'.code && previous2 == '\n'.code && previous1 == '\r'.code && b == '\n'.code) break
            previous3 = previous2
            previous2 = previous1
            previous1 = b
        }
        return buffer.toString(Charsets.US_ASCII.name())
    }

    @Synchronized
    private fun sendFrame(text: String): Boolean {
        try {
            val payload = text.toByteArray(Charsets.UTF_8)
            val out = outputStream ?: return false
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
            return true
        } catch (e: Exception) {
            Log.w(TAG, "sendFrame failed: ${e.message}")
            return false
        }
    }

    private fun sendPong(payload: ByteArray) {
        try {
            val out = outputStream ?: return
            val mask = ByteArray(4).also { SecureRandom().nextBytes(it) }
            val masked = ByteArray(payload.size) { i -> (payload[i].toInt() xor mask[i % 4].toInt()).toByte() }
            out.write(byteArrayOf(0x8A.toByte(), (0x80 or payload.size).toByte()))
            out.write(mask)
            out.write(masked)
            out.flush()
        } catch (e: Exception) { /* ignore */ }
    }

    private fun closeSocket() {
        try { sslSocket?.close() } catch (e: Exception) { /* ignore */ }
        sslSocket = null
        outputStream = null
    }

    private fun InputStream.readExact(size: Int): ByteArray {
        val buffer = ByteArray(size)
        var offset = 0
        while (offset < size) {
            val n = read(buffer, offset, size - offset)
            if (n < 0) throw Exception("WebSocket frame ended early")
            offset += n
        }
        return buffer
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
        if (!sendFrame(msg.toString())) scheduleReconnect()
    }

    private fun sendPing() {
        if (!isLoggedIn) return
        try {
            lastPingAt = System.currentTimeMillis()
            val ping = JSONObject().apply {
                put("jsonrpc", "2.0")
                put("id", System.currentTimeMillis().toInt())
                put("method", "echo")
                put("params", JSONObject().apply {
                    put("sessid", sessionUUID)
                    put("keepalive", System.currentTimeMillis())
                })
            }
            if (!sendFrame(ping.toString())) {
                isLoggedIn = false
                emitStatus("disconnected", "ping_send_failed")
                closeSocket()
                scheduleReconnect()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Ping failed: ${e.message}")
            isLoggedIn = false
            emitStatus("disconnected", e.message ?: "ping_failed")
            closeSocket()
            scheduleReconnect()
        }
    }

    private fun handleVertoMessage(text: String) {
        try {
            val json = JSONObject(text)
            val method = json.optString("method")
            val result = json.optJSONObject("result")
            val id = if (json.has("id")) json.opt("id") else null

            if (method.isNotEmpty() && id != null) {
                sendFrame(JSONObject().apply {
                    put("jsonrpc", "2.0")
                    put("id", id)
                    put("result", JSONObject().apply { put("method", method) })
                }.toString())
            }

            when {
                result != null && json.optInt("id") == 1 -> {
                    val sessid = result.optString("sessid")
                    val message = result.optString("message")
                    val loginOk = sessid.isNotEmpty() || message.lowercase().contains("logged in")
                    if (loginOk) {
                        isLoggedIn = true
                        connecting = false
                        lastLoginAt = System.currentTimeMillis()
                        reconnectAttempt = 0
                        reconnectFuture?.cancel(false)
                        Log.i(TAG, "Verto login SUCCESS — extension registered ✅")
                        emitStatus("registered", "login_ok")
                        handler.post { updateNotification("Connecté · Prêt à recevoir des appels") }
                    } else {
                        Log.e(TAG, "Verto login FAILED: $text")
                        isLoggedIn = false
                        connecting = false
                        emitStatus("error", "login_failed")
                        closeSocket()
                        scheduleReconnect()
                    }
                }
                method == "verto.invite" -> {
                    val params = json.optJSONObject("params")
                    val callerName = params?.optString("caller_id_name") ?: "Appel entrant"
                    val callerNumber = params?.optString("caller_id_number") ?: ""
                    val callId = params?.optString("callID") ?: ""
                    if (callId.isNotEmpty()) currentCallId = callId
                    Log.i(TAG, "Incoming call: $callerName <$callerNumber> callID=$callId")
                    try { AudioFocusHelper.requestCallAudioFocus(this) } catch (_: Exception) {}
                    emitStatus("incoming", "${callerName} <${callerNumber}>")
                    handler.post { showIncomingCallNotification(callerName, callerNumber) }
                }
                method == "verto.bye" -> {
                    Log.i(TAG, "Remote hangup (verto.bye)")
                    currentCallId = null
                    try { AudioFocusHelper.releaseCallAudioFocus(this) } catch (_: Exception) {}
                    handler.post { clearCallNotifications() }
                    emitStatus("idle", "remote_bye")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse Verto message: ${e.message}")
        }
    }

    private fun scheduleReconnect() {
        scheduleReconnect(null)
    }

    private fun scheduleReconnect(forcedDelayMs: Long?) {
        if (isDestroyed) return
        if (reconnectFuture?.isDone == false) return
        reconnectAttempt++
        val delay = forcedDelayMs ?: minOf(5_000L * reconnectAttempt, 30_000L)
        Log.i(TAG, "Reconnecting in ${delay}ms (attempt $reconnectAttempt)")
        emitStatus("reconnecting", "delay=${delay}ms attempt=$reconnectAttempt")
        handler.post { updateNotification("Reconnexion en cours...") }
        reconnectFuture = executor.schedule({ if (!isDestroyed) connectVerto() }, delay, TimeUnit.MILLISECONDS)
    }

    private fun registerNetworkWatchdog() {
        try {
            connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.i(TAG, "Network available — refreshing Verto registration")
                    if (!isDestroyed) {
                        if (!isLoggedIn && connecting) return
                        if (!isLoggedIn && sslSocket == null) {
                            emitStatus("reconnecting", "network_available_no_socket")
                            scheduleReconnect(1_000L)
                            return
                        }
                        isLoggedIn = false
                        emitStatus("reconnecting", "network_available_refresh")
                        closeSocket()
                        scheduleReconnect(1_000L)
                    }
                }

                override fun onLost(network: Network) {
                    Log.i(TAG, "Network lost — marking Verto offline")
                    isLoggedIn = false
                    emitStatus("disconnected", "network_lost")
                    closeSocket()
                    if (!isDestroyed) scheduleReconnect(5_000L)
                }
            }
            connectivityManager?.registerNetworkCallback(request, callback)
            networkCallback = callback
        } catch (e: Exception) {
            Log.w(TAG, "Network watchdog unavailable: ${e.message}")
        }
    }

    private fun unregisterNetworkWatchdog() {
        try {
            val cb = networkCallback ?: return
            connectivityManager?.unregisterNetworkCallback(cb)
        } catch (_: Exception) {
        } finally {
            networkCallback = null
        }
    }

    private fun emitStatus(status: String, reason: String? = null) {
        val now = System.currentTimeMillis()
        lastReason = reason ?: lastReason
        try {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().apply {
                putString(KEY_STATUS, status)
                putString(KEY_REASON, lastReason)
                putLong(KEY_UPDATED_AT, now)
                putLong(KEY_LAST_LOGIN_AT, lastLoginAt)
                putLong(KEY_LAST_PING_AT, lastPingAt)
                putLong(KEY_LAST_FRAME_AT, lastFrameAt)
                putInt(KEY_RECONNECT_ATTEMPT, reconnectAttempt)
                putBoolean(KEY_CONNECTING, connecting)
                putBoolean(KEY_LOGGED_IN, isLoggedIn)
                putBoolean(KEY_WAKE_HELD, wakeLock?.isHeld == true)
                putBoolean(KEY_WIFI_HELD, wifiLock?.isHeld == true)
                apply()
            }
        } catch (_: Exception) {}

        try {
            sendBroadcast(Intent(ACTION_STATUS).apply {
                setPackage(packageName)
                putExtra("status", status)
                putExtra("reason", lastReason)
                putExtra("updatedAt", now)
                putExtra("lastLoginAt", lastLoginAt)
                putExtra("lastPingAt", lastPingAt)
                putExtra("lastFrameAt", lastFrameAt)
                putExtra("reconnectAttempt", reconnectAttempt)
                putExtra("connecting", connecting)
                putExtra("loggedIn", isLoggedIn)
                putExtra("wakeLockHeld", wakeLock?.isHeld == true)
                putExtra("wifiLockHeld", wifiLock?.isHeld == true)
            })
        } catch (_: Exception) {}
    }

    // ── Notifications ────────────────────────────────────────────────────────

    private fun actionPendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(action).setPackage(packageName).setClass(this, CallActionReceiver::class.java)
        return PendingIntent.getBroadcast(
            this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun showIncomingCallNotification(callerName: String, callerNumber: String) {
        val nm = getSystemService(NotificationManager::class.java)
        val fullScreen = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("incoming_call", true)
            putExtra("caller_number", callerNumber)
        }
        val fullScreenPI = PendingIntent.getActivity(
            this, INCOMING_CALL_NOTIFICATION_ID, fullScreen,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val answerPI  = actionPendingIntent(CallActionReceiver.ACTION_ANSWER,  110)
        val declinePI = actionPendingIntent(CallActionReceiver.ACTION_DECLINE, 111)

        val notification = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setContentTitle("Appel entrant — Lemtel")
            .setContentText("$callerName${if (callerNumber.isNotEmpty()) " <$callerNumber>" else ""}")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setDefaults(Notification.DEFAULT_ALL)
            .setContentIntent(fullScreenPI)
            .setFullScreenIntent(fullScreenPI, true)
            .setAutoCancel(true)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Refuser", declinePI)
            .addAction(android.R.drawable.ic_menu_call, "Répondre", answerPI)
            .build()
        nm.notify(INCOMING_CALL_NOTIFICATION_ID, notification)
    }

    /**
     * Ongoing-call notification with Hangup / Hold / Resume actions so the user
     * can control an active call from the lockscreen or notification drawer.
     */
    fun showOngoingCallNotification(peerLabel: String, onHold: Boolean) {
        val nm = getSystemService(NotificationManager::class.java)
        val openApp = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPI = PendingIntent.getActivity(
            this, 120, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val hangupPI = actionPendingIntent(CallActionReceiver.ACTION_HANGUP, 121)
        val holdPI   = actionPendingIntent(
            if (onHold) CallActionReceiver.ACTION_RESUME else CallActionReceiver.ACTION_HOLD,
            122,
        )
        val builder = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setContentTitle(if (onHold) "En attente — Lemtel" else "Appel en cours — Lemtel")
            .setContentText(peerLabel)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(openPI)
            .setOngoing(true)
            .setSilent(true)
            .addAction(
                if (onHold) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
                if (onHold) "Reprendre" else "En attente",
                holdPI,
            )
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Raccrocher", hangupPI)
        nm.notify(INCOMING_CALL_NOTIFICATION_ID, builder.build())
    }

    fun clearCallNotifications() {
        try { getSystemService(NotificationManager::class.java).cancel(INCOMING_CALL_NOTIFICATION_ID) } catch (_: Exception) {}
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

    // ── Notification-action → native hangup fallback ─────────────────────────
    // When the user taps "Raccrocher" from the lockscreen notification while
    // the WebView is not running (app killed/suspended), the JS bridge is
    // unavailable and verto.bye would never reach FreeSWITCH. Send it from
    // the native WebSocket directly so the PBX-side leg is torn down.

    private fun registerCallActionReceiver() {
        try {
            val filter = android.content.IntentFilter(CallActionReceiver.ACTION_CALL_ACTION_EVENT)
            val recv = object : android.content.BroadcastReceiver() {
                override fun onReceive(ctx: Context?, intent: Intent?) {
                    val action = intent?.getStringExtra(CallActionReceiver.EXTRA_ACTION) ?: return
                    when (action) {
                        "hangup", "decline" -> handleNativeHangup(action)
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(recv, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                registerReceiver(recv, filter)
            }
            callActionReceiver = recv
        } catch (e: Exception) {
            Log.w(TAG, "registerCallActionReceiver failed: ${e.message}")
        }
    }

    private fun unregisterCallActionReceiver() {
        try { callActionReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        callActionReceiver = null
    }

    private fun handleNativeHangup(reason: String) {
        val callId = currentCallId
        if (callId != null && isLoggedIn) {
            try { sendFrame(buildVertoByeMessage(callId)) } catch (_: Exception) {}
        }
        currentCallId = null
        try { AudioFocusHelper.releaseCallAudioFocus(this) } catch (_: Exception) {}
        handler.post { clearCallNotifications() }
        emitStatus("idle", "native_${reason}")
    }

    private fun buildVertoByeMessage(callId: String): String {
        val msg = JSONObject().apply {
            put("jsonrpc", "2.0")
            put("id", System.currentTimeMillis().toInt())
            put("method", "verto.bye")
            put("params", JSONObject().apply {
                put("sessid", sessionUUID)
                put("dialogParams", JSONObject().apply {
                    put("callID", callId)
                })
                put("cause", "NORMAL_CLEARING")
                put("causeCode", 16)
            })
        }
        return msg.toString()
    }
}
