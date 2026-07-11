package com.lemtel.softphone

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
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
import org.pjsip.pjsua2.Account
import org.pjsip.pjsua2.AccountConfig
import org.pjsip.pjsua2.AudioMediaRecorder
import org.pjsip.pjsua2.AuthCredInfo
import org.pjsip.pjsua2.CallInfo
import org.pjsip.pjsua2.CallOpParam
import org.pjsip.pjsua2.Endpoint
import org.pjsip.pjsua2.EpConfig
import org.pjsip.pjsua2.OnCallMediaStateParam
import org.pjsip.pjsua2.OnCallStateParam
import org.pjsip.pjsua2.OnIncomingCallParam
import org.pjsip.pjsua2.OnRegStateParam
import org.pjsip.pjsua2.TransportConfig
import org.pjsip.pjsua2.pjmedia_type
import org.pjsip.pjsua2.pjsip_inv_state
import org.pjsip.pjsua2.pjsip_status_code
import org.pjsip.pjsua2.pjsip_transport_type_e
import org.pjsip.pjsua2.pjsua_call_media_status
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

@CapacitorPlugin(
    name = "CapacitorPjsip",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class CapacitorPjsip : Plugin() {

    private var audioManager: AudioManager? = null
    private val sipExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var endpoint: Endpoint? = null
    private var account: NativeAccount? = null
    private var currentCall: NativeCall? = null
    private var recorder: AudioMediaRecorder? = null
    private var recorderPath: String? = null
    private var pjsuaStarted = false
    private var pjsuaLoaded = false
    private var currentDomain = "lemtel.lemtel.tel"
    private var currentTransport = "tcp"
    private var currentServer = "pbxnode.lemtel.tel"
    private var currentPort = 5060

    override fun load() {
        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        logNative("load — Android PJSUA2 bridge ready")
    }

    @PluginMethod
    fun initAccount(call: PluginCall) {
        val server = call.getString("server") ?: "pbxnode.lemtel.tel"
        val port = call.getInt("port") ?: 5060
        val username = call.getString("username") ?: call.getString("extension") ?: ""
        val password = call.getString("password") ?: ""
        val domain = call.getString("domain") ?: "lemtel.lemtel.tel"
        val transport = normalizeTransport(call.getString("transport") ?: "TCP")
        val logLevel = (call.getInt("logLevel") ?: 3).coerceIn(0, 5)

        if (username.isBlank() || password.isBlank()) {
            call.reject("username and password required")
            return
        }

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback")
            return
        }
        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        emit("registration", JSObject().apply {
            put("state", "connecting")
            put("status", "connecting")
            put("server", server)
            put("port", port)
            put("transport", transport)
        })

        sipExecutor.execute {
            try {
                loadPjsua2()
                ensureEndpoint(logLevel, transport)

                currentDomain = domain
                currentTransport = transport
                currentServer = server
                currentPort = port

                account?.deleteSafely()
                account = NativeAccount().also { acc ->
                    val cfg = AccountConfig().apply {
                        idUri = "sip:$username@$domain"
                        regConfig.registrarUri = registrarUri(server, port, transport)
                        regConfig.timeoutSec = 3600L
                        regConfig.retryIntervalSec = 30L
                        regConfig.firstRetryIntervalSec = 5L
                        regConfig.randomRetryIntervalSec = 0L
                        sipConfig.authCreds.add(AuthCredInfo("Digest", "*", username, 0, password))
                        sipConfig.proxies.add(proxyUri(server, port, transport))
                        sipConfig.contactUriParams = ";transport=$transport"
                        sipConfig.contactParams = ";q=1.0;+sip.instance=\"<urn:uuid:${deviceInstanceId()}>\""
                        natConfig.udpKaIntervalSec = 15L
                    }
                    acc.create(cfg, true)
                }
                resolve(call, JSObject().apply {
                    put("ok", true)
                    put("status", "ok")
                    put("audioBackend", "pjsip")
                    put("server", server)
                    put("port", port)
                    put("username", username)
                    put("domain", domain)
                    put("transport", transport.uppercase())
                })
                logNative("initAccount native PJSUA2 server=$server port=$port user=$username domain=$domain transport=$transport")
            } catch (e: java.lang.Exception) {
                val msg = e.message ?: e.toString()
                emitRegistrationError(msg)
                reject(call, "Native PJSIP init failed: $msg")
            }
        }
    }

    @PermissionCallback
    fun microphonePermissionCallback(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
            call.resolve(JSObject().apply { put("ok", true); put("status", "ok") })
        } else {
            emit("micPermission", JSObject().apply { put("granted", false); put("status", "denied") })
            call.reject("Microphone permission denied")
        }
    }

    @PluginMethod
    fun makeCall(call: PluginCall) {
        val number = call.getString("number") ?: call.getString("destination") ?: ""
        if (number.isBlank()) {
            call.reject("number required")
            return
        }
        sipExecutor.execute {
            try {
                val acc = account ?: throw IllegalStateException("not registered")
                startCallService()
                val nativeCall = NativeCall(acc, -1)
                currentCall = nativeCall
                val uri = if (number.contains("@")) "sip:$number" else "sip:$number@$currentDomain;transport=$currentTransport"
                nativeCall.makeCall(uri, CallOpParam(true))
                resolve(call, JSObject().apply { put("ok", true); put("status", "calling"); put("number", number) })
                emit("callStateChanged", JSObject().apply { put("state", "ringing"); put("direction", "out"); put("number", number); put("stage", "invite_sent") })
            } catch (e: java.lang.Exception) {
                stopCallService()
                reject(call, e.message ?: "makeCall failed")
            }
        }
    }

    @PluginMethod
    fun hangup(call: PluginCall) {
        sipExecutor.execute {
            try {
                currentCall?.hangup(CallOpParam())
                currentCall = null
                stopCallService()
                audioManager?.mode = AudioManager.MODE_NORMAL
                resolve(call, JSObject().apply { put("ok", true) })
            } catch (e: java.lang.Exception) {
                reject(call, e.message ?: "hangup failed")
            }
        }
    }

    @PluginMethod
    fun answer(call: PluginCall) {
        sipExecutor.execute {
            try {
                startCallService()
                audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
                val prm = CallOpParam(true).apply { statusCode = pjsip_status_code.PJSIP_SC_OK }
                currentCall?.answer(prm)
                resolve(call, JSObject().apply { put("ok", true) })
            } catch (e: java.lang.Exception) {
                reject(call, e.message ?: "answer failed")
            }
        }
    }

    @PluginMethod
    fun setMute(call: PluginCall) {
        val muted = call.getBoolean("muted", false) ?: false
        sipExecutor.execute {
            try {
                audioManager?.isMicrophoneMute = muted
                currentCall?.let { nativeCall ->
                    val info = nativeCall.info
                    for (i in 0 until info.media.size) {
                        val media = info.media[i]
                        if (media.type == pjmedia_type.PJMEDIA_TYPE_AUDIO) {
                            nativeCall.getAudioMedia(i).adjustTxLevel(if (muted) 0.0f else 1.0f)
                        }
                    }
                }
                emit("muteChanged", JSObject().apply { put("muted", muted) })
                resolve(call, JSObject().apply { put("ok", true); put("muted", muted) })
            } catch (e: java.lang.Exception) {
                reject(call, e.message ?: "setMute failed")
            }
        }
    }

    @PluginMethod
    fun setHold(call: PluginCall) {
        val held = call.getBoolean("onHold") ?: call.getBoolean("held") ?: false
        sipExecutor.execute {
            try {
                currentCall?.let { nativeCall ->
                    if (held) nativeCall.setHold(CallOpParam(true)) else nativeCall.reinvite(CallOpParam(true))
                }
                emit("holdChanged", JSObject().apply { put("onHold", held); put("held", held) })
                resolve(call, JSObject().apply { put("ok", true); put("onHold", held) })
            } catch (e: java.lang.Exception) {
                reject(call, e.message ?: "setHold failed")
            }
        }
    }

    @PluginMethod
    fun sendDTMF(call: PluginCall) {
        val digit = call.getString("digit") ?: call.getString("digits") ?: ""
        sipExecutor.execute {
            try {
                if (digit.isNotBlank()) currentCall?.dialDtmf(digit)
                resolve(call, JSObject().apply { put("ok", true) })
            } catch (e: java.lang.Exception) {
                reject(call, e.message ?: "sendDTMF failed")
            }
        }
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
        sipExecutor.execute {
            try {
                currentCall?.hangup(CallOpParam())
                currentCall = null
                recorder?.deleteSafely()
                recorder = null
                recorderPath = null
                account?.deleteSafely()
                account = null
                stopCallService()
                audioManager?.mode = AudioManager.MODE_NORMAL
                resolve(call, JSObject().apply { put("ok", true) })
            } catch (e: java.lang.Exception) {
                reject(call, e.message ?: "disconnect failed")
            }
        }
    }

    @PluginMethod
    fun setLogLevel(call: PluginCall) {
        val level = (call.getInt("level") ?: 3).coerceIn(0, 5)
        call.resolve(JSObject().apply { put("ok", true); put("level", level) })
    }

    @PluginMethod
    fun getSnapshot(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true) })
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
        emit("micPermission", JSObject().apply { put("granted", granted); put("status", if (granted) "granted" else "denied") })
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
        sipExecutor.execute {
            val ret = JSObject().apply { put("audioBackend", "pjsip") }
            try {
                val info = currentCall?.info
                ret.put("running", info != null)
                if (info != null) {
                    ret.put("sessionState", info.stateText)
                    ret.put("lastSipCode", statusCodeValue(info.lastStatusCode))
                }
            } catch (_: java.lang.Exception) {
                ret.put("running", false)
            }
            resolve(call, ret)
        }
    }

    @PluginMethod
    fun startRecord(call: PluginCall) {
        sipExecutor.execute {
            try {
                val nativeCall = currentCall ?: throw IllegalStateException("no active call")
                val path = File(context.filesDir, "call-${System.currentTimeMillis()}.wav").absolutePath
                val rec = AudioMediaRecorder().apply { createRecorder(path) }
                val info = nativeCall.info
                for (i in 0 until info.media.size) {
                    val media = info.media[i]
                    if (media.type == pjmedia_type.PJMEDIA_TYPE_AUDIO) {
                        nativeCall.getAudioMedia(i).startTransmit(rec)
                        endpoint?.audDevManager()?.getCaptureDevMedia()?.startTransmit(rec)
                    }
                }
                recorder = rec
                recorderPath = path
                emit("recordingChanged", JSObject().apply { put("recording", true); put("path", path) })
                resolve(call, JSObject().apply { put("ok", true); put("recording", true); put("path", path) })
            } catch (e: java.lang.Exception) {
                resolve(call, JSObject().apply { put("ok", false); put("recording", false); put("error", e.message ?: "record failed") })
            }
        }
    }

    @PluginMethod
    fun stopRecord(call: PluginCall) {
        sipExecutor.execute {
            recorder?.deleteSafely()
            recorder = null
            val path = recorderPath ?: ""
            recorderPath = null
            emit("recordingChanged", JSObject().apply { put("recording", false); put("path", path) })
            resolve(call, JSObject().apply { put("ok", true); put("recording", false); put("path", path) })
        }
    }

    @PluginMethod
    fun startRecording(call: PluginCall) {
        startRecord(call)
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        stopRecord(call)
    }

    @PluginMethod
    fun snapshot(call: PluginCall) {
        call.resolve(JSObject().apply { put("ok", true) })
    }

    @PluginMethod
    fun transfer(call: PluginCall) {
        val target = call.getString("target") ?: ""
        if (target.isBlank()) { call.reject("target required"); return }
        sipExecutor.execute {
            try {
                val uri = if (target.contains("@")) "sip:$target" else "sip:$target@$currentDomain"
                currentCall?.xfer(uri, CallOpParam(true))
                resolve(call, JSObject().apply { put("ok", true); put("target", target) })
            } catch (e: java.lang.Exception) {
                reject(call, e.message ?: "transfer failed")
            }
        }
    }

    @PluginMethod
    fun park(call: PluginCall) {
        val code = call.getString("code") ?: ""
        call.resolve(JSObject().apply { put("ok", true); put("code", code) })
    }

    @PluginMethod
    fun addCall(call: PluginCall) {
        val target = call.getString("target") ?: ""
        if (target.isBlank()) { call.resolve(JSObject().apply { put("ok", false); put("target", target) }); return }
        makeCall(call)
    }

    @PluginMethod
    fun setLiveTranscriptionEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        call.resolve(JSObject().apply { put("ok", true); put("enabled", enabled) })
    }

    private inner class NativeAccount : Account() {
        override fun onRegState(prm: OnRegStateParam) {
            val code = statusCodeValue(prm.code)
            val reason = prm.reason ?: ""
            val registered = code in 200..299
            emit("registration", JSObject().apply {
                put("state", if (registered) "registered" else "error")
                put("status", if (registered) "registered" else "error")
                put("code", code)
                put("reason", if (registered) "OK" else reason.ifBlank { "Registration failed: $code" })
                put("audioBackend", "pjsip")
                put("server", currentServer)
                put("port", currentPort)
                put("transport", currentTransport.uppercase())
            })
            logNative("registration code=$code reason=$reason")
        }

        override fun onIncomingCall(prm: OnIncomingCallParam) {
            try {
                val nativeCall = NativeCall(this, prm.callId)
                currentCall = nativeCall
                val info = nativeCall.info
                emit("callReceived", JSObject().apply {
                    put("from", info.remoteUri)
                    put("number", info.remoteUri)
                    put("direction", "in")
                })
            } catch (e: java.lang.Exception) {
                logNative("incoming call error: ${e.message}", 1)
            }
        }
    }

    private inner class NativeCall(acc: Account, callId: Int) : org.pjsip.pjsua2.Call(acc, callId) {
        override fun onCallState(prm: OnCallStateParam?) {
            try {
                val ci = info
                val code = statusCodeValue(ci.lastStatusCode)
                when (ci.state) {
                    pjsip_inv_state.PJSIP_INV_STATE_CALLING -> emitCallState("ringing", ci, code, "invite_sent")
                    pjsip_inv_state.PJSIP_INV_STATE_EARLY -> emitCallState("ringing", ci, code, if (code == 183) "early_media" else "remote_ringing")
                    pjsip_inv_state.PJSIP_INV_STATE_CONFIRMED -> {
                        currentCall = this
                        emitCallState("active", ci, code, "confirmed")
                    }
                    pjsip_inv_state.PJSIP_INV_STATE_DISCONNECTED -> {
                        emit("callEnded", JSObject().apply { put("reason", ci.lastReason); put("code", code) })
                        emitCallState("ended", ci, code, "disconnected")
                        currentCall = null
                        stopCallService()
                    }
                    else -> emitCallState("ringing", ci, code, ci.stateText)
                }
            } catch (e: java.lang.Exception) {
                logNative("call state error: ${e.message}", 1)
            }
        }

        override fun onCallMediaState(prm: OnCallMediaStateParam?) {
            try {
                val ci = info
                for (i in 0 until ci.media.size) {
                    val media = ci.media[i]
                    if (media.type == pjmedia_type.PJMEDIA_TYPE_AUDIO &&
                        (media.status == pjsua_call_media_status.PJSUA_CALL_MEDIA_ACTIVE ||
                            media.status == pjsua_call_media_status.PJSUA_CALL_MEDIA_REMOTE_HOLD)) {
                        val audioMedia = getAudioMedia(i)
                        endpoint?.audDevManager()?.let { adm ->
                            adm.getCaptureDevMedia().startTransmit(audioMedia)
                            audioMedia.startTransmit(adm.getPlaybackDevMedia())
                        }
                        emit("audioStateChanged", JSObject().apply {
                            put("status", "running")
                            put("audioBackend", "pjsip")
                            put("restartAttempts", 0)
                        })
                    }
                }
            } catch (e: java.lang.Exception) {
                emit("audioStateChanged", JSObject().apply { put("status", "error"); put("lastError", e.message ?: "media failed") })
            }
        }
    }

    private fun ensureEndpoint(logLevel: Int, transport: String) {
        if (pjsuaStarted && endpoint != null) return
        val ep = Endpoint()
        endpoint = ep
        ep.libCreate()
        val cfg = EpConfig().apply {
            uaConfig.userAgent = "Lemtel Android PJSIP"
            logConfig.level = logLevel.toLong()
            logConfig.consoleLevel = logLevel.toLong()
            medConfig.clockRate = 8000
            medConfig.sndClockRate = 0
            medConfig.ecTailLen = 200
        }
        ep.libInit(cfg)
        val tpCfg = TransportConfig().apply { port = 0 }
        val transportType = if (transport == "tls") pjsip_transport_type_e.PJSIP_TRANSPORT_TLS else pjsip_transport_type_e.PJSIP_TRANSPORT_TCP
        ep.transportCreate(transportType, tpCfg)
        ep.libStart()
        pjsuaStarted = true
    }

    private fun loadPjsua2() {
        if (pjsuaLoaded) return
        try {
            System.loadLibrary("pjsua2")
            pjsuaLoaded = true
        } catch (e: UnsatisfiedLinkError) {
            throw IllegalStateException("libpjsua2 not packaged/loaded: ${e.message}")
        }
    }

    private fun emitCallState(state: String, ci: CallInfo, code: Int, stage: String) {
        emit("callStateChanged", JSObject().apply {
            put("state", state)
            put("stage", stage)
            put("code", code)
            put("number", ci.remoteUri)
            put("remoteUri", ci.remoteUri)
            put("audioBackend", "pjsip")
        })
    }

    private fun registrarUri(server: String, port: Int, transport: String): String = "sip:$server:${port};transport=$transport"

    private fun proxyUri(server: String, port: Int, transport: String): String = "sip:$server:${port};lr;transport=$transport"

    private fun normalizeTransport(value: String): String = when (value.lowercase()) {
        "tls", "sips" -> "tls"
        else -> "tcp"
    }

    private fun statusCodeValue(code: Int): Int = code

    private fun deviceInstanceId(): String {
        val prefs = context.getSharedPreferences("lemtel-pjsip", Context.MODE_PRIVATE)
        val existing = prefs.getString("sip.instance.uuid", null)
        if (!existing.isNullOrBlank()) return existing
        val fresh = UUID.randomUUID().toString().lowercase()
        prefs.edit().putString("sip.instance.uuid", fresh).apply()
        return fresh
    }

    private fun startCallService() {
        try {
            ContextCompat.startForegroundService(context, Intent(context, SipForegroundService::class.java))
        } catch (e: java.lang.Exception) {
            logNative("foreground service start failed: ${e.message}", 2)
        }
    }

    private fun stopCallService() {
        try { context.stopService(Intent(context, SipForegroundService::class.java)) } catch (_: java.lang.Exception) {}
    }

    private fun emitRegistrationError(reason: String) {
        emit("registration", JSObject().apply {
            put("state", "error")
            put("status", "error")
            put("reason", reason)
            put("audioBackend", "pjsip")
        })
    }

    private fun emit(event: String, data: JSObject) {
        mainHandler.post { notifyListeners(event, data) }
    }

    private fun resolve(call: PluginCall, data: JSObject) {
        mainHandler.post { call.resolve(data) }
    }

    private fun reject(call: PluginCall, message: String) {
        mainHandler.post { call.reject(message) }
    }

    private fun logNative(message: String, level: Int = 3) {
        android.util.Log.println(if (level <= 1) android.util.Log.ERROR else if (level == 2) android.util.Log.WARN else android.util.Log.INFO, "CapacitorPjsip", message)
        emit("log", JSObject().apply { put("level", level); put("tag", "android-pjsip"); put("category", "native"); put("message", message) })
    }

    private fun Account.deleteSafely() {
        try { delete() } catch (_: java.lang.Exception) {}
    }

    private fun AudioMediaRecorder.deleteSafely() {
        try { delete() } catch (_: java.lang.Exception) {}
    }
}
