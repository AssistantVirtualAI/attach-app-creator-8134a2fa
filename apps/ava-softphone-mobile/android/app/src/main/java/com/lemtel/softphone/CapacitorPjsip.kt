package com.lemtel.softphone

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
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
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback")
            return
        }
        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        val ret = JSObject()
        ret.put("ok", true)
        ret.put("status", "ok")
        call.resolve(ret)
    }

    @PermissionCallback
    fun microphonePermissionCallback(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
            val ret = JSObject()
            ret.put("ok", true)
            ret.put("status", "ok")
            call.resolve(ret)
        } else {
            call.reject("Microphone permission denied")
        }
    }

    @PluginMethod
    fun makeCall(call: PluginCall) {
        val ret = JSObject()
        ret.put("ok", true)
        ret.put("status", "calling")
        call.resolve(ret)
    }

    @PluginMethod
    fun hangup(call: PluginCall) {
        audioManager?.mode = AudioManager.MODE_NORMAL
        val ret = JSObject()
        ret.put("ok", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun answer(call: PluginCall) {
        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        val ret = JSObject()
        ret.put("ok", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun setMute(call: PluginCall) {
        val muted = call.getBoolean("muted", false) ?: false
        audioManager?.isMicrophoneMute = muted
        val ret = JSObject()
        ret.put("ok", true)
        ret.put("muted", muted)
        call.resolve(ret)
    }

    @PluginMethod
    fun setHold(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun sendDTMF(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun setAudioRoute(call: PluginCall) {
        val route = call.getString("route", "earpiece")
        when (route) {
            "speaker" -> {
                audioManager?.isSpeakerphoneOn = true
                audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
            }
            "earpiece" -> {
                audioManager?.isSpeakerphoneOn = false
                audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
            }
            "bluetooth" -> {
                audioManager?.isBluetoothScoOn = true
            }
            else -> {
                audioManager?.isSpeakerphoneOn = false
            }
        }
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        audioManager?.mode = AudioManager.MODE_NORMAL
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun setLogLevel(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun getSnapshot(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun requestMicrophonePermission(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED) {
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

    // ---------------------------------------------------------------------
    // Stubs — Android uses JsSIP (WebRTC) for actual SIP, but the shared JS
    // layer calls these plugin methods. Return safe defaults so nothing throws
    // "not implemented on android".
    // ---------------------------------------------------------------------

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
            track.write(buffer, 0, buffer.size)
            track.play()
            Handler(Looper.getMainLooper()).postDelayed({
                try { track.stop(); track.release() } catch (_: Exception) {}
            }, ((seconds * 1000).toLong() + 500))
        } catch (e: Exception) {
            android.util.Log.e("CapacitorPjsip", "playTestTone error: ${e.message}")
        }
        val route = currentRoute()
        call.resolve(JSObject().apply {
            put("ok", true)
            put("micPeak", 0.0)
            put("route", route)
        })
    }

    private fun currentRoute(): String = when {
        audioManager?.isSpeakerphoneOn == true -> "speaker"
        audioManager?.isBluetoothScoOn == true -> "bluetooth"
        else -> "earpiece"
    }

    @PluginMethod
    fun getAudioRoute(call: PluginCall) {
        val route = currentRoute()
        val outputs = org.json.JSONArray().apply {
            put(JSObject().apply { put("portType", route); put("portName", route) })
        }
        val inputs = org.json.JSONArray().apply {
            put(JSObject().apply { put("portType", "builtin_mic"); put("portName", "Microphone") })
        }
        call.resolve(JSObject().apply {
            put("ok", true)
            put("route", route)
            put("outputs", outputs)
            put("availableInputs", inputs)
        })
    }

    @PluginMethod
    fun getRtpStats(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("running", false)
            put("audioBackend", "jssip-webrtc")
        })
    }

    @PluginMethod
    fun startRecord(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true); put("recording", true) })
    }

    @PluginMethod
    fun stopRecord(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true); put("recording", false) })
    }

    @PluginMethod
    fun startRecording(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true); put("recording", true) })
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true); put("recording", false) })
    }

    @PluginMethod
    fun snapshot(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun transfer(call: PluginCall) {
        val target = call.getString("target") ?: ""
        call.resolve(JSObject().apply { put("ok", true); put("target", target) })
    }

    @PluginMethod
    fun park(call: PluginCall) {
        val code = call.getString("code") ?: ""
        call.resolve(JSObject().apply { put("ok", true); put("code", code) })
    }

    @PluginMethod
    fun addCall(call: PluginCall) {
        val target = call.getString("target") ?: ""
        call.resolve(JSObject().apply { put("ok", true); put("target", target) })
    }

    @PluginMethod
    fun setLiveTranscriptionEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        call.resolve(JSObject().apply { put("ok", true); put("enabled", enabled) })
    }
}
