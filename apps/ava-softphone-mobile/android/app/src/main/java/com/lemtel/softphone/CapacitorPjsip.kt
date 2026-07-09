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
}
