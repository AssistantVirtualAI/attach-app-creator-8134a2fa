package com.lemtel.softphone

import android.Manifest
import android.content.Context
import android.media.AudioManager
import android.media.AudioTrack
import android.media.AudioFormat
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
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

    override fun load() {
        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
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
            call.resolve(JSObject().apply { put("ok", true) })
        } catch (e: Exception) {
            call.reject(e.message ?: "startSipService failed")
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
}
