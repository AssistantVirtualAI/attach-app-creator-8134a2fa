package com.lemtel.softphone

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.AudioTrack
import android.media.AudioFormat
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "CapacitorPjsip",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class CapacitorPjsip : Plugin() {

    private var audioManager: AudioManager? = null
    private var sipStatusReceiver: BroadcastReceiver? = null

    override fun load() {
        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        sipStatusReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != SipConnectionService.ACTION_STATUS) return
                notifyListeners("sipServiceStatus", statusFromIntent(intent), true)
            }
        }
        try {
            val filter = IntentFilter(SipConnectionService.ACTION_STATUS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(sipStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                context.registerReceiver(sipStatusReceiver, filter)
            }
        } catch (_: Exception) {}
    }

    override fun handleOnDestroy() {
        try { context.unregisterReceiver(sipStatusReceiver) } catch (_: Exception) {}
        sipStatusReceiver = null
        super.handleOnDestroy()
    }

    @PluginMethod
    fun initAccount(call: PluginCall) {
        val server = call.getString("server") ?: "pbxnode.lemtel.tel"
        val port = call.getInt("port") ?: 5060
        val username = call.getString("username") ?: call.getString("extension") ?: ""
        val password = call.getString("password") ?: ""
        val domain = call.getString("domain") ?: "lemtel.lemtel.tel"
        val transport = call.getString("transport") ?: "TCP"

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback")
            return
        }
        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        call.resolve(JSObject().apply {
            put("ok", true)
            put("status", "ok")
            put("server", server)
            put("port", port)
            put("username", username)
            put("domain", domain)
            put("transport", transport)
        })
    }

    @PermissionCallback
    fun microphonePermissionCallback(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
            call.resolve(JSObject().apply { put("ok", true); put("status", "ok") })
        } else {
            call.reject("Microphone permission denied")
        }
    }

    @PluginMethod fun makeCall(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true); put("status", "calling") }) }
    @PluginMethod
    fun startCall(call: PluginCall) {
        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        audioManager?.isSpeakerphoneOn = false
        call.resolve(JSObject().apply { put("ok", true) })
    }
    @PluginMethod fun hangup(call: PluginCall) { audioManager?.mode = AudioManager.MODE_NORMAL; call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun answer(call: PluginCall) { audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION; call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun setMute(call: PluginCall) { val m = call.getBoolean("muted", false) ?: false; audioManager?.isMicrophoneMute = m; call.resolve(JSObject().apply { put("ok", true); put("muted", m) }) }
    @PluginMethod fun setHold(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun sendDTMF(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun disconnect(call: PluginCall) { audioManager?.mode = AudioManager.MODE_NORMAL; call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun setLogLevel(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun getSnapshot(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun setHeld(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun startRecord(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun stopRecord(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun startRecording(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun stopRecording(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun snapshot(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun transfer(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun park(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun addCall(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun setLiveTranscriptionEnabled(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }

    @PluginMethod
    fun startSipService(call: PluginCall) {
        try {
            // Save credentials so the native Verto WebSocket can re-register
            // independently of the WebView when the screen is locked.
            val host = call.getString("host") ?: "pbxnode.lemtel.tel"
            val port = call.getInt("port") ?: 8082
            val login = call.getString("login") ?: call.getString("extension") ?: ""
            val password = call.getString("password") ?: ""
            val domain = call.getString("domain") ?: "lemtel.lemtel.tel"
            val displayName = call.getString("displayName") ?: login
            if (login.isNotEmpty() && password.isNotEmpty()) {
                SipConnectionService.saveCredentials(context, host, port, login, password, domain, displayName)
            }
            SipConnectionService.start(context)
            call.resolve(readSipServiceStatus().apply { put("ok", true) })
        } catch (e: Exception) {
            call.reject(e.message ?: "startSipService failed")
        }
    }

    @PluginMethod
    fun getSipServiceStatus(call: PluginCall) {
        call.resolve(readSipServiceStatus().apply { put("ok", true) })
    }

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                call.resolve(JSObject().apply { put("ok", true); put("ignored", true); put("requested", false) })
                return
            }
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val packageName = context.packageName
            val alreadyIgnored = pm.isIgnoringBatteryOptimizations(packageName)
            if (!alreadyIgnored) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            }
            call.resolve(JSObject().apply {
                put("ok", true)
                put("ignored", alreadyIgnored)
                put("requested", !alreadyIgnored)
            })
        } catch (e: Exception) {
            call.reject(e.message ?: "battery optimization request failed")
        }
    }

    @PluginMethod
    fun stopSipService(call: PluginCall) {
        try {
            SipConnectionService.stop(context)
            call.resolve(JSObject().apply { put("ok", true) })
        } catch (e: Exception) {
            call.reject(e.message ?: "stopSipService failed")
        }
    }

    @PluginMethod
    fun setAudioRoute(call: PluginCall) {
        when (call.getString("route", "earpiece")) {
            "speaker" -> { audioManager?.isSpeakerphoneOn = true }
            "earpiece" -> { audioManager?.isSpeakerphoneOn = false }
            "bluetooth" -> { audioManager?.isBluetoothScoOn = true }
        }
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun getAudioRoute(call: PluginCall) {
        val route = when {
            audioManager?.isSpeakerphoneOn == true -> "speaker"
            audioManager?.isBluetoothScoOn == true -> "bluetooth"
            else -> "earpiece"
        }
        val outputs = JSArray()
        outputs.put(JSObject().apply { put("portType", route); put("portName", route) })
        val inputs = JSArray()
        inputs.put(JSObject().apply { put("portType", "builtin_mic"); put("portName", "Microphone") })
        call.resolve(JSObject().apply {
            put("route", route)
            put("ok", true)
            put("outputs", outputs)
            put("inputs", inputs)
        })
    }

    @PluginMethod
    fun getRtpStats(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("running", false)
            put("audioBackend", "jssip-webrtc")
            put("ok", true)
        })
    }

    @PluginMethod
    fun playTestTone(call: PluginCall) {
        try {
            val sampleRate = 44100
            val numSamples = sampleRate * 2
            val buffer = ShortArray(numSamples)
            for (i in 0 until numSamples) {
                buffer[i] = (Math.sin(2.0 * Math.PI * 440.0 * i / sampleRate) * 32767).toInt().toShort()
            }
            val audioTrack = AudioTrack(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
                buffer.size * 2,
                AudioTrack.MODE_STATIC,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            )
            audioTrack.write(buffer, 0, buffer.size)
            audioTrack.play()
            Handler(Looper.getMainLooper()).postDelayed({ audioTrack.release() }, 2500)
        } catch (e: Exception) {
            android.util.Log.e("CapacitorPjsip", "playTestTone error: ${e.message}")
        }
        call.resolve(JSObject().apply { put("ok", true); put("micPeak", 0.0); put("route", "speaker") })
    }

    @PluginMethod
    fun requestMicrophonePermission(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            call.resolve(JSObject().apply { put("granted", true) })
        } else {
            requestPermissionForAlias("microphone", call, "micPermCallback")
        }
    }

    @PermissionCallback
    fun micPermCallback(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        call.resolve(JSObject().apply { put("granted", granted) })
    }

    private fun statusFromIntent(intent: Intent): JSObject {
        return JSObject().apply {
            put("status", intent.getStringExtra("status") ?: "unknown")
            put("reason", intent.getStringExtra("reason") ?: "")
            put("updatedAt", intent.getLongExtra("updatedAt", 0L))
            put("lastLoginAt", intent.getLongExtra("lastLoginAt", 0L))
            put("lastPingAt", intent.getLongExtra("lastPingAt", 0L))
            put("lastFrameAt", intent.getLongExtra("lastFrameAt", 0L))
            put("reconnectAttempt", intent.getIntExtra("reconnectAttempt", 0))
            put("connecting", intent.getBooleanExtra("connecting", false))
            put("loggedIn", intent.getBooleanExtra("loggedIn", false))
            put("wakeLockHeld", intent.getBooleanExtra("wakeLockHeld", false))
            put("wifiLockHeld", intent.getBooleanExtra("wifiLockHeld", false))
        }
    }

    private fun readSipServiceStatus(): JSObject {
        val p = context.getSharedPreferences(SipConnectionService.PREFS_NAME, Context.MODE_PRIVATE)
        return JSObject().apply {
            put("status", p.getString(SipConnectionService.KEY_STATUS, "unknown") ?: "unknown")
            put("reason", p.getString(SipConnectionService.KEY_REASON, "") ?: "")
            put("updatedAt", p.getLong(SipConnectionService.KEY_UPDATED_AT, 0L))
            put("lastLoginAt", p.getLong(SipConnectionService.KEY_LAST_LOGIN_AT, 0L))
            put("lastPingAt", p.getLong(SipConnectionService.KEY_LAST_PING_AT, 0L))
            put("lastFrameAt", p.getLong(SipConnectionService.KEY_LAST_FRAME_AT, 0L))
            put("reconnectAttempt", p.getInt(SipConnectionService.KEY_RECONNECT_ATTEMPT, 0))
            put("connecting", p.getBoolean(SipConnectionService.KEY_CONNECTING, false))
            put("loggedIn", p.getBoolean(SipConnectionService.KEY_LOGGED_IN, false))
            put("wakeLockHeld", p.getBoolean(SipConnectionService.KEY_WAKE_HELD, false))
            put("wifiLockHeld", p.getBoolean(SipConnectionService.KEY_WIFI_HELD, false))
        }
    }
}
