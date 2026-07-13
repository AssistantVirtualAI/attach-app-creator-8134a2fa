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
import org.pjsip.pjsua2.*

/**
 * Android PJSIP native bridge — remplace le stub JsSIP WebView.
 *
 * Utilise PJSIP 2.16 compilé avec ENABLE_16KB_PAGE_SIZE=1 (arm64-v8a).
 * Miroir de l'interface iOS CapacitorPjsip pour que nativeSipProvider.ts
 * fonctionne identiquement sur les deux plateformes.
 *
 * Événements émis vers JS :
 *   registration      { status: "registered"|"unregistered"|"error", code: Int }
 *   callReceived      { callId: String, from: String }
 *   callStateChanged  { callId: String, state: String }
 *   callEnded         { callId: String, reason: String }
 */
@CapacitorPlugin(
    name = "CapacitorPjsip",
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")
    ]
)
class CapacitorPjsip : Plugin() {

    var ep: Endpoint? = null
    var account: LemtelAccount? = null
    var currentCall: LemtelCall? = null
    private var audioManager: AudioManager? = null
    private var foregroundServiceRunning = false

    companion object {
        init {
            try {
                System.loadLibrary("pjsua2")
                android.util.Log.i("CapacitorPjsip", "libpjsua2.so loaded (PJSIP native)")
            } catch (e: UnsatisfiedLinkError) {
                android.util.Log.e("CapacitorPjsip", "libpjsua2.so NOT found: ${e.message}")
            }
        }
    }

    override fun load() {
        audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        android.util.Log.i("CapacitorPjsip", "CapacitorPjsip PJSIP native loaded")
    }

    override fun handleOnDestroy() {
        destroyPjsip()
        stopForegroundServiceIfNeeded()
        super.handleOnDestroy()
    }

    // ── Foreground service ─────────────────────────────────────────────────────
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
        try { context.stopService(Intent(context, SipForegroundService::class.java)) } catch (_: Exception) {}
        foregroundServiceRunning = false
    }

    // ── PJSIP init / destroy ───────────────────────────────────────────────────
    private fun initPjsip(
        extension: String,
        domain: String,
        password: String,
        host: String,
        port: Int,
        transport: String,
        logLevel: Int
    ) {
        destroyPjsip()
        try {
            val endpoint = Endpoint()
            endpoint.libCreate()

            val epConfig = EpConfig()
            epConfig.logConfig.level = logLevel.toLong()
            epConfig.logConfig.consoleLevel = logLevel.toLong()
            epConfig.medConfig.noVad = true
            endpoint.libInit(epConfig)

            val transportConfig = TransportConfig()
            transportConfig.port = 0
            val transportType = when (transport.lowercase()) {
                "tls" -> pjsip_transport_type_e.PJSIP_TRANSPORT_TLS
                "tcp" -> pjsip_transport_type_e.PJSIP_TRANSPORT_TCP
                else  -> pjsip_transport_type_e.PJSIP_TRANSPORT_TCP
            }
            endpoint.transportCreate(transportType, transportConfig)
            endpoint.libStart()

            val acfg = AccountConfig()
            acfg.idUri = "sip:$extension@$domain"
            acfg.regConfig.registrarUri = "sip:$host:$port;transport=${transport.lowercase()}"
            acfg.regConfig.registerOnAdd = true
            acfg.regConfig.timeoutSec = 120

            val cred = AuthCredInfo("digest", "*", extension, 0, password)
            acfg.sipConfig.authCreds.add(cred)

            // SIP/TCP direct — pas de WebRTC/ICE
            acfg.natConfig.iceEnabled = false
            acfg.natConfig.turnEnabled = false

            val acc = LemtelAccount(this)
            acc.create(acfg)

            ep = endpoint
            account = acc
            android.util.Log.i("CapacitorPjsip", "PJSIP initialized for sip:$extension@$domain via $transport:$port")
        } catch (e: Exception) {
            android.util.Log.e("CapacitorPjsip", "initPjsip error: ${e.message}")
            emitEvent("registration", JSObject().apply {
                put("status", "error"); put("reason", e.message)
            })
        }
    }

    private fun destroyPjsip() {
        try { currentCall?.hangup(CallOpParam()) } catch (_: Exception) {}
        currentCall = null
        try { account?.delete() } catch (_: Exception) {}
        account = null
        try { ep?.libDestroy() } catch (_: Exception) {}
        ep = null
    }

    // ── Event helper ───────────────────────────────────────────────────────────
    fun emitEvent(event: String, data: JSObject) {
        try { notifyListeners(event, data) } catch (e: Exception) {
            android.util.Log.w("CapacitorPjsip", "emitEvent $event error: ${e.message}")
        }
    }

    // ── Plugin methods ─────────────────────────────────────────────────────────
    @PluginMethod
    fun initAccount(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermCallback")
            return
        }
        val extension = call.getString("extension") ?: run { call.reject("missing extension"); return }
        val domain    = call.getString("domain")    ?: run { call.reject("missing domain"); return }
        val password  = call.getString("password")  ?: ""
        val host      = call.getString("host") ?: call.getString("server") ?: domain
        val port      = call.getInt("port") ?: 5060
        val transport = call.getString("transport") ?: "tcp"
        val logLevel  = call.getInt("logLevel") ?: 3

        audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
        startForegroundServiceIfNeeded()

        Thread {
            initPjsip(extension, domain, password, host, port, transport, logLevel)
            Handler(Looper.getMainLooper()).post {
                call.resolve(JSObject().apply { put("ok", true); put("status", "ok"); put("audioBackend", "pjsip-native") })
            }
        }.start()
    }

    @PermissionCallback
    fun micPermCallback(call: PluginCall) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) initAccount(call)
        else call.reject("microphone permission denied")
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        Thread {
            destroyPjsip()
            stopForegroundServiceIfNeeded()
            audioManager?.mode = AudioManager.MODE_NORMAL
            Handler(Looper.getMainLooper()).post { call.resolve(JSObject().apply { put("ok", true) }) }
        }.start()
    }

    @PluginMethod
    fun makeCall(call: PluginCall) {
        val number = call.getString("number") ?: run { call.reject("missing number"); return }
        val acc = account ?: run { call.reject("not registered"); return }
        Thread {
            try {
                val c = LemtelCall(this, acc, -1)
                val domain = acc.info.uri.substringAfter("@").substringBefore(";")
                c.makeCall("sip:$number@$domain", CallOpParam(true))
                currentCall = c
                Handler(Looper.getMainLooper()).post { call.resolve() }
            } catch (e: Exception) {
                android.util.Log.e("CapacitorPjsip", "makeCall error: ${e.message}")
                Handler(Looper.getMainLooper()).post { call.reject(e.message) }
            }
        }.start()
    }

    @PluginMethod
    fun hangup(call: PluginCall) {
        Thread {
            try { currentCall?.hangup(CallOpParam()) } catch (_: Exception) {}
            currentCall = null
            Handler(Looper.getMainLooper()).post { call.resolve() }
        }.start()
    }

    @PluginMethod
    fun answer(call: PluginCall) {
        Thread {
            try {
                val prm = CallOpParam()
                prm.statusCode = pjsip_status_code.PJSIP_SC_OK
                currentCall?.answer(prm)
            } catch (e: Exception) {
                android.util.Log.e("CapacitorPjsip", "answer error: ${e.message}")
            }
            Handler(Looper.getMainLooper()).post { call.resolve() }
        }.start()
    }

    @PluginMethod
    fun setMute(call: PluginCall) {
        val muted = call.getBoolean("muted") ?: false
        try { audioManager?.isMicrophoneMute = muted } catch (_: Exception) {}
        call.resolve(JSObject().apply { put("ok", true); put("muted", muted) })
    }

    @PluginMethod
    fun setHold(call: PluginCall) {
        val onHold = call.getBoolean("held") ?: call.getBoolean("onHold") ?: false
        Thread {
            try {
                if (onHold) currentCall?.setHold(CallOpParam())
                else currentCall?.reinvite(CallOpParam())
            } catch (_: Exception) {}
            Handler(Looper.getMainLooper()).post {
                call.resolve(JSObject().apply { put("ok", true) })
            }
        }.start()
    }

    @PluginMethod
    fun sendDTMF(call: PluginCall) {
        val digits = call.getString("digits") ?: call.getString("digit") ?: ""
        Thread {
            try {
                val prm = CallSendDtmfParam()
                prm.digits = digits
                currentCall?.sendDtmf(prm)
            } catch (_: Exception) {}
            Handler(Looper.getMainLooper()).post { call.resolve() }
        }.start()
    }

    @PluginMethod
    fun setAudioRoute(call: PluginCall) {
        val route = call.getString("route", "earpiece")
        when (route) {
            "speaker"   -> { audioManager?.isSpeakerphoneOn = true; audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION }
            "earpiece"  -> { audioManager?.isSpeakerphoneOn = false; audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION }
            "bluetooth" -> { audioManager?.isBluetoothScoOn = true }
            else        -> { audioManager?.isSpeakerphoneOn = false }
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

    @PluginMethod
    fun playTestTone(call: PluginCall) {
        val seconds   = (call.getDouble("seconds")   ?: 2.0).coerceIn(0.1, 5.0)
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
        val c = currentCall
        if (c == null) {
            call.resolve(JSObject().apply { put("running", false); put("audioBackend", "pjsip-native") })
            return
        }
        try {
            val info = c.info
            val stats = c.getStreamStat(0)
            call.resolve(JSObject().apply {
                put("running", info.state == pjsip_inv_state.PJSIP_INV_STATE_CONFIRMED)
                put("txPackets", stats.rtcp.txStat.pkt)
                put("rxPackets", stats.rtcp.rxStat.pkt)
                put("audioBackend", "pjsip-native")
            })
        } catch (e: Exception) {
            call.resolve(JSObject().apply { put("running", false); put("audioBackend", "pjsip-native") })
        }
    }

    @PluginMethod fun startRecord(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true); put("recording", false) }) }
    @PluginMethod fun stopRecord(call: PluginCall)  { call.resolve(JSObject().apply { put("ok", true); put("recording", false) }) }
    @PluginMethod fun transfer(call: PluginCall)    { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun park(call: PluginCall)        { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun addCall(call: PluginCall)     { call.resolve(JSObject().apply { put("ok", true) }) }
    @PluginMethod fun getSnapshot(call: PluginCall) { call.resolve(JSObject().apply { put("ok", true) }) }
}

// ── PJSIP Account callbacks ────────────────────────────────────────────────────
class LemtelAccount(private val plugin: CapacitorPjsip) : Account() {
    override fun onRegState(prm: OnRegStateParam) {
        try {
            val info = info
            val registered = info.regIsActive
            val code = prm.code.swigValue()
            android.util.Log.i("CapacitorPjsip", "onRegState: registered=$registered code=$code")
            plugin.emitEvent("registration", JSObject().apply {
                put("status", if (registered) "registered" else if (code in 200..299) "unregistered" else "error")
                put("code", code)
            })
        } catch (e: Exception) {
            android.util.Log.e("CapacitorPjsip", "onRegState error: ${e.message}")
        }
    }

    override fun onIncomingCall(prm: OnIncomingCallParam) {
        try {
            val call = LemtelCall(plugin, this, prm.callId)
            plugin.currentCall = call
            val from = call.info.remoteUri
            android.util.Log.i("CapacitorPjsip", "Incoming call from $from")
            plugin.emitEvent("callReceived", JSObject().apply {
                put("callId", prm.callId.toString())
                put("from", from)
            })
        } catch (e: Exception) {
            android.util.Log.e("CapacitorPjsip", "onIncomingCall error: ${e.message}")
        }
    }
}

// ── PJSIP Call callbacks ───────────────────────────────────────────────────────
class LemtelCall(
    private val plugin: CapacitorPjsip,
    account: Account,
    callId: Int
) : Call(account, callId) {

    override fun onCallState(prm: OnCallStateParam) {
        try {
            val info = info
            val state = info.state
            val stateStr = when (state) {
                pjsip_inv_state.PJSIP_INV_STATE_NULL         -> "null"
                pjsip_inv_state.PJSIP_INV_STATE_CALLING      -> "calling"
                pjsip_inv_state.PJSIP_INV_STATE_INCOMING     -> "incoming"
                pjsip_inv_state.PJSIP_INV_STATE_EARLY        -> "early"
                pjsip_inv_state.PJSIP_INV_STATE_CONNECTING   -> "connecting"
                pjsip_inv_state.PJSIP_INV_STATE_CONFIRMED    -> "confirmed"
                pjsip_inv_state.PJSIP_INV_STATE_DISCONNECTED -> "disconnected"
                else -> "unknown"
            }
            android.util.Log.i("CapacitorPjsip", "onCallState: $stateStr")
            if (state == pjsip_inv_state.PJSIP_INV_STATE_DISCONNECTED) {
                plugin.emitEvent("callEnded", JSObject().apply {
                    put("callId", id.toString())
                    put("reason", info.lastReason)
                })
                if (plugin.currentCall == this) plugin.currentCall = null
            } else {
                plugin.emitEvent("callStateChanged", JSObject().apply {
                    put("callId", id.toString())
                    put("state", stateStr)
                })
            }
        } catch (e: Exception) {
            android.util.Log.e("CapacitorPjsip", "onCallState error: ${e.message}")
        }
    }

    override fun onCallMediaState(prm: OnCallMediaStateParam) {
        try {
            val info = info
            for (i in 0 until info.media.size().toInt()) {
                val mi = info.media[i.toLong()]
                if (mi.type == pjmedia_type.PJMEDIA_TYPE_AUDIO &&
                    mi.status == pjsua_call_media_status.PJSUA_CALL_MEDIA_ACTIVE) {
                    val aud = AudioMedia.typecastFromMedia(getMedia(i.toLong()))
                    val ep = Endpoint.instance()
                    aud.startTransmit(ep.audDevManager().captureDevMedia)
                    ep.audDevManager().playbackDevMedia.startTransmit(aud)
                    android.util.Log.i("CapacitorPjsip", "Audio media active — RTP flowing")
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("CapacitorPjsip", "onCallMediaState error: ${e.message}")
        }
    }
}
