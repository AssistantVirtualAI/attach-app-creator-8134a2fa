package com.lemtel.softphone

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Android bridge stub.
 *
 * The actual SIP stack on Android is JsSIP running in the WebView (WSS 7443).
 * To keep the WebSocket alive when the app goes to the background we start
 * a foreground service (SipForegroundService) with a persistent notification
 * as soon as the JS layer calls initAccount(). All SIP signalling / media is
 * handled by JsSIP; this plugin only handles:
 *   - microphone permission
 *   - audio routing (speaker / earpiece / bluetooth)
 *   - starting / stopping the foreground service so Android does not kill
 *     the WebView WebSocket connection.
 *
 * PJSUA2 native binding is intentionally NOT compiled in — the required
 * .so libraries are not shipped in this project and using them would crash
 * at UnsatisfiedLinkError.
 */
@CapacitorPlugin(
    name = "CapacitorPjsip",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class CapacitorPjsip : Plugin() {

    private var audioManager: AudioManager? = null
    private var foregroundServiceRunning = false

    override fun load() {
        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        android.util.Log.i("CapacitorPjsip", "Android JsSIP bridge stub loaded")
    }

    // ---------- Foreground service (keeps WebView WSS alive in background) ----------

    private fun startForegroundServiceIfNeeded() {
        if (foregroundServiceRunning) return
        try {
            val intent = Intent(context, SipForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, intent)
            } else {
                context.startService(intent)
            }
            foregroundServiceRunning = true
            android.util.Log.i("CapacitorPjsip", "SipForegroundService started")
        } catch (e: Exception) {
            android.util.Log.w("CapacitorPjsip", "startForegroundService failed: ${e.message}")
        }
    }

    private fun stopForegroundServiceIfNeeded() {
        if (!foregroundServiceRunning) return
        try {
            context.stopService(Intent(context, SipForegroundService::class.java))
        } catch (_: Exception) {}
        foregroundServiceRunning = false
    }

    // ---------- SIP no-op API (JS layer uses JsSIP directly) ----------

    @PluginMethod
    fun initAccount(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermCallback")
            return
        }
        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        startForegroundServiceIfNeeded()
        call.resolve(JSObject().apply {
            put("ok", true)
            put("status", "ok")
            put("audioBackend", "jssip-webview")
        })
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        stopForegroundServiceIfNeeded()
        audioManager?.mode = AudioManager.MODE_NORMAL
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod fun makeCall(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun hangup(call: PluginCall)   { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun answer(call: PluginCall)   { call.resolve(JSObject().apply { put("ok", true) }) }

    @PluginMethod
    fun setMute(call: PluginCall) {
        val muted = call.getBoolean("muted", false) ?: false
        audioManager?.isMicrophoneMute = muted
        call.resolve(JSObject().apply { put("ok", true); put("muted", muted) })
    }

    @PluginMethod
    fun setHold(call: PluginCall) {
        val held = call.getBoolean("onHold") ?: call.getBoolean("held") ?: false
        call.resolve(JSObject().apply { put("ok", true); put("onHold", held) })
    }

    @PluginMethod fun sendDTMF(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }

    @PluginMethod
    fun setAudioRoute(call: PluginCall) {
        val route = call.getString("route", "earpiece")
        when (route) {
            "speaker" -> { audioManager?.isSpeakerphoneOn = true; audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION }
            "earpiece" -> { audioManager?.isSpeakerphoneOn = false; audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION }
            "bluetooth" -> { audioManager?.isBluetoothScoOn = true }
            else -> { audioManager?.isSpeakerphoneOn = false }
        }
        call.resolve(JSObject().apply { put("ok", true); put("route", route ?: "earpiece") })
    }

    @PluginMethod
    fun getAudioRoute(call: PluginCall) {
        val route = when {
            audioManager?.isSpeakerphoneOn == true -> "speaker"
            audioManager?.isBluetoothScoOn == true -> "bluetooth"
            else -> "earpiece"
        }
        val outputs = org.json.JSONArray().apply {
            put(JSObject().apply { put("portType", route); put("portName", route) })
        }
        val inputs = org.json.JSONArray().apply {
            put(JSObject().apply { put("portType", "builtin_mic"); put("portName", "Microphone") })
        }
        call.resolve(JSObject().apply {
            put("ok", true); put("route", route); put("outputs", outputs); put("availableInputs", inputs)
        })
    }

    @PluginMethod
    fun setLogLevel(call: PluginCall) {
        val level = (call.getInt("level") ?: 3).coerceIn(0, 5)
        call.resolve(JSObject().apply { put("ok", true); put("level", level) })
    }

    @PluginMethod
    fun requestMicrophonePermission(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED) {
            call.resolve(JSObject().apply { put("ok", true); put("granted", true); put("status", "granted") })
        } else {
            requestPermissionForAlias("microphone", call, "micPermCallback")
        }
    }

    @PermissionCallback
    fun micPermCallback(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        call.resolve(JSObject().apply { put("ok", granted); put("granted", granted); put("status", if (granted) "granted" else "denied") })
    }

    @PluginMethod
    fun playTestTone(call: PluginCall) {
        val seconds = (call.getDouble("seconds") ?: 2.0).coerceIn(0.1, 5.0)
        val frequency = (call.getDouble("frequency") ?: 440.0)
        try {
            val sampleRate = 44100
            val numSamples = (seconds * sampleRate).toInt()
            val buffer = ShortArray(numSamples)
            for (i in 0 until numSamples) {
                buffer[i] = (Math.sin(2.0 * Math.PI * frequency * i / sampleRate) * 16000).toInt().toShort()
            }
            val track = AudioTrack(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
                buffer.size * 2, AudioTrack.MODE_STATIC, AudioManager.AUDIO_SESSION_ID_GENERATE
            )
            track.write(buffer, 0, buffer.size)
            track.play()
            Handler(Looper.getMainLooper()).postDelayed({
                try { track.stop(); track.release() } catch (_: Exception) {}
            }, ((seconds * 1000).toLong() + 500))
        } catch (e: Exception) {
            android.util.Log.e("CapacitorPjsip", "playTestTone error: ${e.message}")
        }
        call.resolve(JSObject().apply { put("ok", true); put("micPeak", 0.0); put("route", "earpiece") })
    }

    @PluginMethod
    fun getRtpStats(call: PluginCall) {
        call.resolve(JSObject().apply { put("running", false); put("audioBackend", "jssip-webview") })
    }

    @PluginMethod fun startRecord(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true); put("recording", false) }) }
    @PluginMethod fun stopRecord(call: PluginCall)  { call.resolve(JSObject().apply { put("ok", true); put("recording", false) }) }
    @PluginMethod fun transfer(call: PluginCall)    { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun park(call: PluginCall)        { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun addCall(call: PluginCall)     { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun getSnapshot(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }

    override fun handleOnDestroy() {
        stopForegroundServiceIfNeeded()
        super.handleOnDestroy()
    }
}
