import Foundation
import Capacitor
import AVFoundation

/// Native SIP engine bridge for Planipret Mobile.
///
/// The plugin exposes a stable JS API (`initialize`, `register`, `answerCall`, ...).
/// The actual media/signalling engine is PJSIP, which is only linked when the
/// `libpjsip.xcframework` has been built and the `PJSIP_AVAILABLE` flag is set in
/// the podspec (see docs/pjsip-ios-setup.md).
///
/// When PJSIP is NOT linked, every method rejects with code `unavailable` so the
/// JS layer transparently falls back to the REST click-to-call path.
@objc(CapacitorPjsip)
public class CapacitorPjsip: CAPPlugin {

    private struct AccountConfig {
        let domain: String
        let username: String
        let password: String
        let proxy: String
        let transport: String
        let port: Int
        let wsUrl: String?
        let displayName: String
    }

    private var config: AccountConfig?
    private var registered = false
    private var activeCallId: String?
    private let queue = DispatchQueue(label: "ca.planipret.pjsip")

    private var engineAvailable: Bool {
        #if PJSIP_AVAILABLE
        return true
        #else
        return false
        #endif
    }

    // MARK: - Lifecycle

    @objc func initialize(_ call: CAPPluginCall) {
        guard engineAvailable else {
            call.reject("PJSIP engine not linked in this build", "unavailable")
            return
        }
        guard
            let domain = call.getString("domain"),
            let username = call.getString("username"),
            let password = call.getString("password")
        else {
            call.reject("domain, username and password are required", "invalid_config")
            return
        }

        config = AccountConfig(
            domain: domain,
            username: username,
            password: password,
            proxy: call.getString("proxy") ?? domain,
            transport: (call.getString("transport") ?? "WSS").uppercased(),
            port: call.getInt("port") ?? 9002,
            wsUrl: call.getString("wsUrl"),
            displayName: call.getString("displayName") ?? username
        )

        queue.async { [weak self] in
            guard let self else { return }
            #if PJSIP_AVAILABLE
            self.pjsipCreateAccount()
            #endif
            call.resolve(["ok": true, "username": username])
        }
    }

    @objc func register(_ call: CAPPluginCall) {
        guard engineAvailable, config != nil else {
            call.reject("PJSIP engine not linked in this build", "unavailable")
            return
        }
        queue.async { [weak self] in
            guard let self else { return }
            #if PJSIP_AVAILABLE
            self.pjsipRegister(true)
            #endif
            call.resolve()
        }
    }

    @objc func unregister(_ call: CAPPluginCall) {
        guard engineAvailable else { call.reject("unavailable", "unavailable"); return }
        queue.async { [weak self] in
            #if PJSIP_AVAILABLE
            self?.pjsipRegister(false)
            #endif
            call.resolve()
        }
    }

    // MARK: - Calls

    @objc func makeCall(_ call: CAPPluginCall) {
        guard engineAvailable, let destination = call.getString("destination") else {
            call.reject("unavailable", "unavailable"); return
        }
        queue.async { [weak self] in
            #if PJSIP_AVAILABLE
            self?.pjsipMakeCall(destination)
            #endif
            call.resolve(["callId": self?.activeCallId ?? ""])
        }
    }

    @objc func answerCall(_ call: CAPPluginCall) {
        guard engineAvailable else { call.reject("unavailable", "unavailable"); return }
        let callId = call.getString("callId") ?? activeCallId
        queue.async { [weak self] in
            self?.configureAudioForCall()
            #if PJSIP_AVAILABLE
            self?.pjsipAnswer(callId)
            #endif
            call.resolve(["callId": callId ?? ""])
        }
    }

    @objc func hangupCall(_ call: CAPPluginCall) {
        guard engineAvailable else { call.reject("unavailable", "unavailable"); return }
        let callId = call.getString("callId") ?? activeCallId
        queue.async { [weak self] in
            #if PJSIP_AVAILABLE
            self?.pjsipHangup(callId)
            #endif
            self?.activeCallId = nil
            call.resolve()
        }
    }

    @objc func setMute(_ call: CAPPluginCall) {
        guard engineAvailable else { call.reject("unavailable", "unavailable"); return }
        #if PJSIP_AVAILABLE
        pjsipSetMute(call.getBool("muted") ?? false)
        #endif
        call.resolve()
    }

    @objc func setSpeaker(_ call: CAPPluginCall) {
        guard engineAvailable else { call.reject("unavailable", "unavailable"); return }
        let on = call.getBool("enabled") ?? false
        do {
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(on ? .speaker : .none)
        } catch {
            CAPLog.print("[CapacitorPjsip] speaker override failed: \(error)")
        }
        call.resolve()
    }

    @objc func sendDTMF(_ call: CAPPluginCall) {
        guard engineAvailable, let digits = call.getString("digits") else {
            call.reject("unavailable", "unavailable"); return
        }
        #if PJSIP_AVAILABLE
        pjsipSendDTMF(digits)
        #endif
        call.resolve()
    }

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve([
            "available": engineAvailable,
            "registered": registered,
            "username": config?.username ?? "",
            "callId": activeCallId ?? ""
        ])
    }

    // MARK: - Audio

    /// CallKit owns the audio session while a call is up: never re-set the
    /// category if the session is already active for voice chat.
    private func configureAudioForCall() {
        let session = AVAudioSession.sharedInstance()
        do {
            if session.category != .playAndRecord {
                try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .duckOthers])
            }
            try session.setActive(true, options: [])
        } catch {
            CAPLog.print("[CapacitorPjsip] audio session error: \(error)")
        }
    }

    // MARK: - Event emitters (called from the PJSIP callbacks)

    fileprivate func emitRegistration(state: String, code: Int = 0) {
        registered = (state == "registered")
        notifyListeners("registrationState", data: [
            "state": state,
            "code": code,
            "username": config?.username ?? ""
        ], retainUntilConsumed: true)
    }

    fileprivate func emitIncoming(callId: String, remoteNumber: String, remoteName: String?) {
        activeCallId = callId
        notifyListeners("incomingCall", data: [
            "callId": callId,
            "remoteNumber": remoteNumber,
            "remoteName": remoteName ?? remoteNumber
        ], retainUntilConsumed: true)
    }

    fileprivate func emitCallState(_ state: String, callId: String?) {
        notifyListeners("callState", data: [
            "state": state,
            "callId": callId ?? activeCallId ?? ""
        ], retainUntilConsumed: true)
    }

    // MARK: - PJSIP glue (compiled only when the framework is linked)

    #if PJSIP_AVAILABLE
    private func pjsipCreateAccount() { /* implemented in docs/pjsip-ios-setup.md step 4 */ }
    private func pjsipRegister(_ renew: Bool) { }
    private func pjsipMakeCall(_ destination: String) { }
    private func pjsipAnswer(_ callId: String?) { }
    private func pjsipHangup(_ callId: String?) { }
    private func pjsipSetMute(_ muted: Bool) { }
    private func pjsipSendDTMF(_ digits: String) { }
    #endif
}
