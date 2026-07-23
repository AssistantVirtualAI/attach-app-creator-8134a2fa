import Foundation
import Capacitor
import AVFoundation

/// Thin Capacitor wrapper around PJSIP (PJSUA high-level API).
///
/// Replaces the previous custom NWConnection-based SIP stack and
/// hand-rolled RTPAudioSession. PJSIP runs its own worker threads,
/// handles RTP / jitter buffer / AEC / codec negotiation, and keeps
/// audio/SIP work completely off the main thread.
///
/// The bridged JS plugin name MUST remain `CapacitorPjsip` — that is
/// what `registerPlugin<CapacitorSipPlugin>('CapacitorPjsip')` expects
/// in `src/lib/sip/nativeSipProvider.ts`, and what
/// `AppBridgeViewController.registerPluginInstance(...)` registers.
@objc(CapacitorPjsip)
public class CapacitorPjsip: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CapacitorPjsip"
    public let jsName = "CapacitorPjsip"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initAccount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "makeCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hangup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "answer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setHold", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendDTMF", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLogLevel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestMicrophonePermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAudioRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAudioRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playTestTone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRtpStats", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecord", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecord", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "park", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSipServiceStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "triggerReregister", returnType: CAPPluginReturnPromise),
    ]


    // Serial queue for all PJSUA calls. PJSUA itself is thread-safe but
    // keeping work off the main thread guarantees the UI never blocks.
    private let sipQueue = DispatchQueue(label: "pjsip.worker", qos: .userInitiated)

    private var pjsuaStarted = false
    private var accId: pjsua_acc_id = pjsua_acc_id(PJSUA_INVALID_ID.rawValue)
    private var currentCallId: pjsua_call_id = pjsua_call_id(PJSUA_INVALID_ID.rawValue)
    private var recorderId: pjsua_recorder_id = pjsua_recorder_id(PJSUA_INVALID_ID.rawValue)
    private var recorderPath: String?
    // Domain stored at initAccount time so makeCall can build the correct SIP URI
    // without requiring the caller to pass it again.
    private var currentDomain: String = "lemtel.lemtel.tel"
    // VoIP push token received from PushKit (set by AppDelegate).
    private var voipPushToken: String? = UserDefaults.standard.string(forKey: "ava.voipPushToken")

    // C callbacks need a static reference to reach back into the instance.
    // internal (not fileprivate) so AppDelegate can reach shared + notifyBg
    internal static weak var shared: CapacitorPjsip?

    /// Called by AppDelegate when PushKit delivers a new VoIP token.
    /// If the account is already registered we trigger an immediate
    /// re-REGISTER so the Contact header carries the fresh pn-prid —
    /// otherwise FusionPBX has no way to wake the app via APNs.
    public func setVoipPushToken(_ token: String?) {
        let changed = voipPushToken != token
        voipPushToken = token
        NSLog("[CapacitorPjsip] VoIP push token updated: \(token?.prefix(16) ?? "nil") changed=\(changed)")
        if changed, token != nil, self.accId != pjsua_acc_id(PJSUA_INVALID_ID.rawValue) {
            self.triggerReregister()
        }
    }

    public override func load() {
        CapacitorPjsip.shared = self

        // Wire CallKit actions to PJSIP. Apple requires CallKit to own the
        // audio session lifecycle for VoIP apps — answering/ending from the
        // native UI must drive the SDK, not the other way around.
        CallKitManager.shared.onAnswer = { [weak self] in
            self?.sipQueue.async {
                self?.registerThreadIfNeeded()
                guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else { return }
                pjsua_call_answer(self.currentCallId, 200, nil, nil)
            }
        }
        CallKitManager.shared.onEnd = { [weak self] in
            self?.sipQueue.async {
                self?.registerThreadIfNeeded()
                guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else { return }
                pjsua_call_hangup(self.currentCallId, 0, nil, nil)
                self.currentCallId = pjsua_call_id(PJSUA_INVALID_ID.rawValue)
            }
        }

        // CRITICAL: CallKit calls didActivate on its own internal thread which is
        // NOT registered in PJLIB. Calling pjsua_set_snd_dev directly from didActivate
        // causes: "Assertion failed: Calling pjlib from unknown/external thread"
        // Solution: dispatch pjsua_set_snd_dev on sipQueue (a PJLIB-registered thread).
        CallKitManager.shared.onAudioActivated = { [weak self] in
            self?.sipQueue.async {
                self?.registerThreadIfNeeded()
                guard let self = self else { return }
                let r = pjsua_set_snd_dev(PJMEDIA_AUD_DEFAULT_CAPTURE_DEV, PJMEDIA_AUD_DEFAULT_PLAYBACK_DEV)
                print("[CapacitorPjsip] 🔊 pjsua_set_snd_dev via sipQueue: \(r)")
                // Reconnect audio conference if a call is already active
                if self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) {
                    var info = pjsua_call_info()
                    pjsua_call_get_info(self.currentCallId, &info)
                    pjsua_conf_connect(info.conf_slot, 0)
                    pjsua_conf_connect(0, info.conf_slot)
                    print("[CapacitorPjsip] 🔊 conf_connect conf_slot=\(info.conf_slot)")
                }
            }
        }

        NSLog("[CapacitorPjsip] load — plugin ready, PJSUA will init on first initAccount")
    }

    deinit {
        if pjsuaStarted {
            pjsua_destroy()
        }
    }

    // MARK: - PJLIB thread registration
    // pj_thread_register requires a unique, zeroed 512-byte descriptor buffer per
    // pthread. We keep a dictionary keyed by pthread_t so each pthread always gets
    // its own fresh buffer. The lock protects concurrent dictionary access.
    private var _pjThreadMap: [UInt: UnsafeMutableRawPointer] = [:]
    private let _pjThreadLock = NSLock()

    private func registerThreadIfNeeded() {
        guard pj_thread_is_registered() == 0 else { return }
        let tid = UInt(bitPattern: pthread_self())
        _pjThreadLock.lock()
        let block: UnsafeMutableRawPointer
        if let existing = _pjThreadMap[tid] {
            // Same pthread, same buffer — but zero it first so pj_thread_register
            // sees a clean descriptor (handles pjsua restart within the same pthread).
            existing.initializeMemory(as: UInt8.self, repeating: 0, count: 8 + 512)
            block = existing
        } else {
            let b = UnsafeMutableRawPointer.allocate(byteCount: 8 + 512, alignment: 16)
            b.initializeMemory(as: UInt8.self, repeating: 0, count: 8 + 512)
            _pjThreadMap[tid] = b
            block = b
        }
        _pjThreadLock.unlock()
        let threadPtrPtr = block.assumingMemoryBound(to: OpaquePointer?.self)
        let descPtr = (block + 8).assumingMemoryBound(to: Int.self)
        _ = pj_thread_register("sipQueue", descPtr, threadPtrPtr)
    }

    /// Build a transient pj_str_t backed by a Swift String. The returned
    /// pj_str_t is only valid for the duration of `body`.
    private func withPjStr<T>(_ s: String, _ body: (inout pj_str_t) -> T) -> T {
        var str = s
        return str.withUTF8 { buf in
            let base = buf.baseAddress!
            var pj = pj_str_t(
                ptr: UnsafeMutableRawPointer(mutating: base).assumingMemoryBound(to: CChar.self),
                slen: pj_ssize_t(buf.count)
            )
            return body(&pj)
        }
    }

    /// Convert a Swift String to a heap-allocated pj_str_t (caller must keep
    /// the backing CString alive — used for account config that PJSUA copies).
    private func pjStrDup(_ s: String) -> pj_str_t {
        let cstr = strdup(s)!
        return pj_str_t(ptr: cstr, slen: pj_ssize_t(strlen(cstr)))
    }

    internal func notifyBg(_ event: String, _ data: [String: Any]) {
        sipQueue.async { [weak self] in
            guard let self = self else { return }
            self.registerThreadIfNeeded()
            self.notifyListeners(event, data: data)
        }
    }

    // MARK: - Lifecycle

    @objc func initAccount(_ call: CAPPluginCall) {
        let server = call.getString("server") ?? call.getString("host") ?? "pbxnode.lemtel.tel"
        let username = call.getString("username") ?? call.getString("extension") ?? ""
        let password = call.getString("password") ?? ""
        let domain = call.getString("domain") ?? "lemtel.lemtel.tel"
        let logLevel = call.getInt("logLevel") ?? 3

        guard !username.isEmpty, !password.isEmpty else {
            call.reject("username and password required")
            return
        }

        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self else { return }

            if !self.pjsuaStarted {
                var status = pjsua_create()
                guard status == PJ_SUCCESS.rawValue else {
                    call.reject("pjsua_create failed: \(status)")
                    return
                }

                var cfg = pjsua_config()
                pjsua_config_default(&cfg)
                cfg.cb.on_reg_state = { accId in
                    guard let plugin = CapacitorPjsip.shared else { return }
                    var info = pjsua_acc_info()
                    pjsua_acc_get_info(accId, &info)
                    let code = Int(info.status.rawValue)
                    if code == 200 {
                        plugin.notifyBg("registration", ["state": "registered", "status": "registered", "code": code])
                    } else {
                        plugin.notifyBg("registration", [
                            "state": "error",
                            "status": "error",
                            "code": code,
                            "reason": "Registration failed: \(code)"
                        ])
                    }
                }
                cfg.cb.on_call_state = { callId, _ in
                    guard let plugin = CapacitorPjsip.shared else { return }
                    var info = pjsua_call_info()
                    pjsua_call_get_info(callId, &info)
                    switch info.state {
                    case PJSIP_INV_STATE_CALLING, PJSIP_INV_STATE_EARLY:
                        plugin.notifyBg("callStateChanged", ["state": "ringing", "direction": "out"])
                    case PJSIP_INV_STATE_CONFIRMED:
                        plugin.currentCallId = callId
                        plugin.notifyBg("callStateChanged", ["state": "active"])
                    case PJSIP_INV_STATE_DISCONNECTED:
                        if plugin.currentCallId == callId {
                            plugin.currentCallId = pjsua_call_id(PJSUA_INVALID_ID.rawValue)
                        }
                        plugin.notifyBg("callEnded", ["reason": "remote_bye"])
                        plugin.notifyBg("callStateChanged", ["state": "ended"])
                    default:
                        break
                    }
                }
                cfg.cb.on_call_media_state = { callId in
                    guard let plugin = CapacitorPjsip.shared else { return }
                    var info = pjsua_call_info()
                    pjsua_call_get_info(callId, &info)
                    let mediaStatus = info.media.0.status
                    if mediaStatus == PJSUA_CALL_MEDIA_ACTIVE {
                        pjsua_conf_connect(info.conf_slot, 0)
                        pjsua_conf_connect(0, info.conf_slot)
                        print("[CapacitorPjsip] ✅ Audio connected conf_slot=\(info.conf_slot)")
                    }
                }
                cfg.cb.on_incoming_call = { _, callId, _ in
                    guard let plugin = CapacitorPjsip.shared else { return }
                    plugin.currentCallId = callId
                    var info = pjsua_call_info()
                    pjsua_call_get_info(callId, &info)
                    let remote = String(cString: info.remote_info.ptr)
                    plugin.notifyBg("callReceived", ["from": remote])
                }

                var logCfg = pjsua_logging_config()
                pjsua_logging_config_default(&logCfg)
                logCfg.console_level = UInt32(max(0, min(5, logLevel)))

                var mediaCfg = pjsua_media_config()
                pjsua_media_config_default(&mediaCfg)
                mediaCfg.clock_rate = 8000
                mediaCfg.snd_clock_rate = 0
                mediaCfg.ec_tail_len = 200
                mediaCfg.no_vad = 0
                // Disable ICE: FreeSWITCH/FusionPBX does not support ICE in SDP.
                // Without this, PJSIP waits for ICE negotiation that never completes
                // and RTP never starts → no audio in either direction.
                mediaCfg.enable_ice = 0

                status = pjsua_init(&cfg, &logCfg, &mediaCfg)
                guard status == PJ_SUCCESS.rawValue else {
                    call.reject("pjsua_init failed: \(status)")
                    return
                }

                var tcpCfg = pjsua_transport_config()
                pjsua_transport_config_default(&tcpCfg)
                tcpCfg.port = 5060
                var transportId: pjsua_transport_id = 0
                status = pjsua_transport_create(PJSIP_TRANSPORT_TCP, &tcpCfg, &transportId)
                guard status == PJ_SUCCESS.rawValue else {
                    call.reject("transport_create failed: \(status)")
                    return
                }

                status = pjsua_start()
                guard status == PJ_SUCCESS.rawValue else {
                    call.reject("pjsua_start failed: \(status)")
                    return
                }
                self.pjsuaStarted = true
            }

            // Account
            var accCfg = pjsua_acc_config()
            pjsua_acc_config_default(&accCfg)
            accCfg.id = self.pjStrDup("sip:\(username)@\(domain)")
            accCfg.reg_uri = self.pjStrDup("sip:\(server);transport=tcp")

            // Correction 1 — Expiry 3600s pour priorité supérieure à Ringotel (2623s)
            // FreeSWITCH route l'INVITE entrant au contact avec le plus grand expires.
            // Ringotel s'enregistre avec expires=2623 — on dépasse avec 3600.
            accCfg.reg_timeout = 3600
            accCfg.reg_retry_interval = 30

            // Correction 2 — Forcer un contact propre sans +sip.ice
            // PJSIP ajoute +sip.ice dans le Contact header même quand
            // mediaCfg.enable_ice = 0, car le flag ICE est aussi dans accCfg.
            // Ce paramètre parasite le routage FreeSWITCH et empêche les appels
            // entrants d'être routés vers cette app.
            // Build contact URI — include pn-prid (push token) if available
            // so FusionPBX mod_sofia can wake the app via APNs VoIP push.
            // q=1.0 = priorité maximale pour le forking FreeSWITCH.
            // ka_interval=15 = keep-alive TCP toutes les 15s pour maintenir
            // la connexion active en arrière-plan (workaround avant PushKit).
            accCfg.ka_interval = 25

            // +sip.instance (RFC 5626) — unique per-device identifier.
            // FreeSWITCH/FusionPBX uses this to distinguish contacts from
            // different apps registered on the same extension. Without it,
            // a new REGISTER from this app can silently REPLACE the Ringotel
            // contact in the registrar instead of adding a second binding,
            // which prevents parallel forking (only Ringotel rings).
            // We use a stable per-device UUID stored in UserDefaults so the
            // instance ID survives app restarts and re-registrations.
            let instanceKey = "pjsip.sip.instance.uuid"
            let instanceId: String
            if let stored = UserDefaults.standard.string(forKey: instanceKey), !stored.isEmpty {
                instanceId = stored
            } else {
                let fresh = UUID().uuidString.lowercased()
                UserDefaults.standard.set(fresh, forKey: instanceKey)
                instanceId = fresh
            }
            let instanceParam = "+sip.instance=\"<urn:uuid:\(instanceId)>\""

            // RFC 8599 — pn-param MUST be the APNs topic. For VoIP PushKit
            // the topic is <bundle-id>.voip. Previously we sent "apns.voip"
            // which FusionPBX/mod_sofia rejects, so no push was ever emitted
            // when the app was suspended → phone never rang while locked.
            let bundleId = Bundle.main.bundleIdentifier ?? "com.lemtel.softphone"
            let apnsTopic = "\(bundleId).voip"
            if let token = self.voipPushToken, !token.isEmpty {
                // q=1.0 = highest priority so FreeSWITCH prefers this contact
                // over any other binding (e.g. Ringotel) when routing INVITE.
                let contact = "sip:\(username)@\(server);transport=tcp;pn-prid=\(token);pn-param=\(apnsTopic);pn-provider=apns;pn-silent=1;q=1.0;\(instanceParam)"
                accCfg.force_contact = self.pjStrDup(contact)
                NSLog("[CapacitorPjsip] REGISTER contact with VoIP push token topic=%@ q=1.0 instance=%@ token=%@…", apnsTopic, instanceId, String(token.prefix(12)))
            } else {
                let contact = "sip:\(username)@\(server);transport=tcp;q=1.0;\(instanceParam)"
                accCfg.force_contact = self.pjStrDup(contact)
                NSLog("[CapacitorPjsip] ⚠️ REGISTER without VoIP push token — app will only ring while foregrounded. instance=%@", instanceId)
            }

            accCfg.cred_count = 1
            accCfg.cred_info.0.realm = self.pjStrDup("*")
            accCfg.cred_info.0.scheme = self.pjStrDup("digest")
            accCfg.cred_info.0.username = self.pjStrDup(username)
            accCfg.cred_info.0.data_type = Int32(PJSIP_CRED_DATA_PLAIN_PASSWD.rawValue)
            accCfg.cred_info.0.data = self.pjStrDup(password)

            if self.accId != pjsua_acc_id(PJSUA_INVALID_ID.rawValue) {
                pjsua_acc_del(self.accId)
                self.accId = pjsua_acc_id(PJSUA_INVALID_ID.rawValue)
            }

            let status = pjsua_acc_add(&accCfg, pj_bool_t(PJ_TRUE.rawValue), &self.accId)
            guard status == PJ_SUCCESS.rawValue else {
                call.reject("pjsua_acc_add failed: \(status)")
                return
            }
            // Persist domain so makeCall can build the correct SIP URI.
            self.currentDomain = domain
            call.resolve(["ok": true, "status": "ok"])
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self else { return }
            if self.accId != pjsua_acc_id(PJSUA_INVALID_ID.rawValue) {
                pjsua_acc_del(self.accId)
                self.accId = pjsua_acc_id(PJSUA_INVALID_ID.rawValue)
            }
            call.resolve(["ok": true])
        }
    }

    // MARK: - Calls

    @objc func makeCall(_ call: CAPPluginCall) {
        let number = call.getString("number") ?? call.getString("destination") ?? ""
        // Prefer the domain stored at registration time; fall back to the value
        // passed by the caller (for legacy callers), then to the hard-coded default.
        let domain = call.getString("domain") ?? (self.currentDomain.isEmpty ? "lemtel.lemtel.tel" : self.currentDomain)
        guard !number.isEmpty else { call.reject("number required"); return }

        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.accId != pjsua_acc_id(PJSUA_INVALID_ID.rawValue) else {
                call.reject("not registered"); return
            }
            let uri = "sip:\(number)@\(domain);transport=tcp"
            var callId: pjsua_call_id = pjsua_call_id(PJSUA_INVALID_ID.rawValue)
            let status = self.withPjStr(uri) { dst -> pj_status_t in
                pjsua_call_make_call(self.accId, &dst, nil, nil, nil, &callId)
            }
            guard status == PJ_SUCCESS.rawValue else {
                call.reject("make_call failed: \(status)"); return
            }
            self.currentCallId = callId
            call.resolve(["ok": true, "status": "calling", "callId": Int(callId)])
        }
    }

    @objc func hangup(_ call: CAPPluginCall) {
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self else { return }
            if self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) {
                pjsua_call_hangup(self.currentCallId, 0, nil, nil)
                self.currentCallId = pjsua_call_id(PJSUA_INVALID_ID.rawValue)
                // Explicitly emit ended events — when the call is still in
                // CALLING state PJSUA may not fire on_call_state(DISCONNECTED),
                // which would leave the JS side stuck on the active-call sheet.
                self.notifyBg("callEnded", ["reason": "local_hangup"])
                self.notifyBg("callStateChanged", ["state": "ended"])
            }
            call.resolve(["ok": true])
        }
    }

    @objc func answer(_ call: CAPPluginCall) {
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self else { return }
            if self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) {
                pjsua_call_answer(self.currentCallId, 200, nil, nil)
            }
            call.resolve(["ok": true])
        }
    }

    @objc func setMute(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else {
                call.resolve(["ok": true]); return
            }
            var info = pjsua_call_info()
            pjsua_call_get_info(self.currentCallId, &info)
            if muted {
                pjsua_conf_disconnect(0, info.conf_slot)
            } else {
                pjsua_conf_connect(0, info.conf_slot)
            }
            self.notifyBg("muteChanged", ["muted": muted])
            call.resolve(["ok": true, "muted": muted])
        }
    }

    @objc func setHold(_ call: CAPPluginCall) {
        let hold = call.getBool("onHold") ?? call.getBool("held") ?? false
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else {
                call.resolve(["ok": true]); return
            }
            if hold {
                pjsua_call_set_hold(self.currentCallId, nil)
            } else {
                pjsua_call_reinvite(self.currentCallId, UInt32(PJ_TRUE.rawValue), nil)
            }
            self.notifyBg("holdChanged", ["onHold": hold])
            call.resolve(["ok": true, "onHold": hold])
        }
    }

    @objc func sendDTMF(_ call: CAPPluginCall) {
        let digit = call.getString("digit") ?? call.getString("digits") ?? ""
        guard !digit.isEmpty else { call.resolve(); return }
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else {
                call.resolve(); return
            }
            _ = self.withPjStr(digit) { d -> pj_status_t in
                pjsua_call_dial_dtmf(self.currentCallId, &d)
            }
            call.resolve(["ok": true])
        }
    }

    @objc func setLogLevel(_ call: CAPPluginCall) {
        let level = call.getInt("level") ?? 3
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self else { return }
            // pjsua_set_log_level may not be available in all PJSIP builds;
            // update the logging config via pjsua_reconfigure_logging instead.
            var logCfg = pjsua_logging_config()
            pjsua_logging_config_default(&logCfg)
            logCfg.console_level = UInt32(max(0, min(5, level)))
            pjsua_reconfigure_logging(&logCfg)
            call.resolve(["level": level])
        }
    }

    // MARK: - Microphone permission

    @objc func requestMicrophonePermission(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            call.resolve([
                "ok": granted,
                "granted": granted,
                "status": granted ? "granted" : "denied"
            ])
        }
    }

    // MARK: - Audio routing (PJSIP owns the audio device — these are best-effort)

    @objc func setAudioRoute(_ call: CAPPluginCall) {
        let route = call.getString("route") ?? "auto"
        do {
            let session = AVAudioSession.sharedInstance()
            switch route {
            case "speaker":
                try session.overrideOutputAudioPort(.speaker)
            default:
                try session.overrideOutputAudioPort(.none)
            }
            call.resolve(["ok": true, "route": route, "outputs": route])
        } catch {
            call.resolve(["ok": false, "route": route, "outputs": "", "error": error.localizedDescription])
        }
    }

    @objc func getAudioRoute(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        let outputs = session.currentRoute.outputs.map { ["portType": $0.portType.rawValue, "portName": $0.portName] }
        let inputs = (session.availableInputs ?? []).map { ["portType": $0.portType.rawValue, "portName": $0.portName] }
        call.resolve(["outputs": outputs, "availableInputs": inputs])
    }

    @objc func playTestTone(_ call: CAPPluginCall) {
        // PJSIP can play a built-in tone; return a stub for compatibility.
        call.resolve(["ok": true, "micPeak": 0, "route": "speaker"])
    }

    @objc func getRtpStats(_ call: CAPPluginCall) {
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else {
                call.resolve(["running": false]); return
            }
            var info = pjsua_call_info()
            pjsua_call_get_info(self.currentCallId, &info)
            call.resolve([
                "running": true,
                "audioBackend": "pjsip",
                "sessionState": "\(info.state.rawValue)"
            ])
        }
    }

    // MARK: - Recording

    @objc func startRecord(_ call: CAPPluginCall) {
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else {
                call.resolve(["ok": false, "recording": false]); return
            }
            let docs = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first ?? NSTemporaryDirectory()
            let path = "\(docs)/call-\(Int(Date().timeIntervalSince1970)).wav"
            var recId: pjsua_recorder_id = pjsua_recorder_id(PJSUA_INVALID_ID.rawValue)
            let status = self.withPjStr(path) { p -> pj_status_t in
                pjsua_recorder_create(&p, 0, nil, 0, 0, &recId)
            }
            guard status == PJ_SUCCESS.rawValue else {
                call.resolve(["ok": false, "recording": false, "error": "recorder_create \(status)"]); return
            }
            var info = pjsua_call_info()
            pjsua_call_get_info(self.currentCallId, &info)
            pjsua_conf_connect(info.conf_slot, pjsua_recorder_get_conf_port(recId))
            pjsua_conf_connect(0, pjsua_recorder_get_conf_port(recId))
            self.recorderId = recId
            self.recorderPath = path
            call.resolve(["ok": true, "recording": true, "path": path])
        }
    }

    @objc func stopRecord(_ call: CAPPluginCall) {
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self else { return }
            if self.recorderId != pjsua_recorder_id(PJSUA_INVALID_ID.rawValue) {
                pjsua_recorder_destroy(self.recorderId)
                self.recorderId = pjsua_recorder_id(PJSUA_INVALID_ID.rawValue)
            }
            let path = self.recorderPath ?? ""
            self.recorderPath = nil
            call.resolve(["ok": true, "recording": false, "path": path])
        }
    }

    // MARK: - Call control

    @objc func transfer(_ call: CAPPluginCall) {
        let target = call.getString("target") ?? ""
        guard !target.isEmpty else { call.reject("target required"); return }
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else {
                call.resolve(["ok": false, "target": target]); return
            }
            let uri = target.contains("@") ? "sip:\(target)" : "sip:\(target)@lemtel.lemtel.tel"
            _ = self.withPjStr(uri) { t -> pj_status_t in
                pjsua_call_xfer(self.currentCallId, &t, nil)
            }
            call.resolve(["ok": true, "target": target])
        }
    }

    @objc func park(_ call: CAPPluginCall) {
        let code = call.getString("code") ?? "*68"
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.currentCallId != pjsua_call_id(PJSUA_INVALID_ID.rawValue) else {
                call.resolve(["ok": false, "code": code]); return
            }
            let uri = "sip:\(code)@lemtel.lemtel.tel"
            _ = self.withPjStr(uri) { t -> pj_status_t in
                pjsua_call_xfer(self.currentCallId, &t, nil)
            }
            call.resolve(["ok": true, "code": code])
        }
    }

    @objc func addCall(_ call: CAPPluginCall) {
        let target = call.getString("target") ?? ""
        guard !target.isEmpty else { call.reject("target required"); return }
        // Place a second call; PJSIP supports multiple concurrent calls natively.
        sipQueue.async { [weak self] in
            self?.registerThreadIfNeeded()
            guard let self = self, self.accId != pjsua_acc_id(PJSUA_INVALID_ID.rawValue) else {
                call.resolve(["ok": false, "target": target]); return
            }
            let uri = "sip:\(target)@lemtel.lemtel.tel;transport=tcp"
            var newCallId: pjsua_call_id = pjsua_call_id(PJSUA_INVALID_ID.rawValue)
            _ = self.withPjStr(uri) { d -> pj_status_t in
                pjsua_call_make_call(self.accId, &d, nil, nil, nil, &newCallId)
            }
            call.resolve(["ok": true, "target": target, "callId": Int(newCallId)])
        }
    }

    // MARK: - Background keep-alive helpers (parity with Android SipConnectionService)

    /// Internal helper: force a SIP re-REGISTER. Safe to call from any thread.
    func triggerReregister() {
        sipQueue.async { [weak self] in
            guard let self = self else { return }
            self.registerThreadIfNeeded()
            guard self.accId != pjsua_acc_id(PJSUA_INVALID_ID.rawValue) else {
                NSLog("[CapacitorPjsip] triggerReregister: no account — skipping")
                return
            }
            let status = pjsua_acc_set_registration(self.accId, pj_bool_t(PJ_TRUE.rawValue))
            NSLog("[CapacitorPjsip] triggerReregister: pjsua_acc_set_registration status=\(status)")
            self.notifyBg("registration", ["state": "reregistering", "source": "background_task"])
        }
    }

    /// Capacitor-facing wrapper so JS can call `triggerReregister()`.
    @objc func triggerReregister(_ call: CAPPluginCall) {
        triggerReregister()
        call.resolve(["ok": true])
    }


    /// iOS equivalent of Android `getSipServiceStatus` so the Settings /
    /// Diagnostics screen shows the same shape on both platforms.
    @objc func getSipServiceStatus(_ call: CAPPluginCall) {
        sipQueue.async { [weak self] in
            guard let self = self else { call.resolve(["loggedIn": false]); return }
            self.registerThreadIfNeeded()
            let hasAccount = self.accId != pjsua_acc_id(PJSUA_INVALID_ID.rawValue)
            var regState = "unregistered"
            var loggedIn = false
            if hasAccount {
                var accInfo = pjsua_acc_info()
                pjsua_acc_get_info(self.accId, &accInfo)
                let code = Int(accInfo.status.rawValue)
                loggedIn = code == 200
                regState = loggedIn ? "registered" : (code == 0 ? "connecting" : "error")
            }
            call.resolve([
                "ok": true,
                "loggedIn": loggedIn,
                "status": regState,
                "wakeLockHeld": true,  // iOS: PushKit + BGTask act as the wake-lock equivalent
                "wifiLockHeld": true,
                "pushKitEnabled": !(self.voipPushToken?.isEmpty ?? true),
                "voipPushToken": String(self.voipPushToken?.prefix(8) ?? "")
            ])
        }
    }
}
