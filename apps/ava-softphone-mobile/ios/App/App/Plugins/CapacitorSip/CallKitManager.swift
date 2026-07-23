import Foundation
import CallKit
import AVFoundation
import UIKit

/// Minimal CallKit bridge so PJSIP-driven calls show up as native iOS calls
/// (lockscreen UI, audio session priming, background ringing). The plugin
/// reports incoming/outgoing/ended events here; CXProvider handles the UI
/// and tells iOS to configure the AVAudioSession before PJSIP starts media.
@objc public final class CallKitManager: NSObject {
    @objc public static let shared = CallKitManager()

    private let provider: CXProvider
    private let callController = CXCallController()
    private var activeUUID: UUID?

    /// Called by CallKit when the user taps Answer in the native UI.
    /// Plugin assigns this so it can forward the action to PJSIP.
    public var onAnswer: (() -> Void)?
    /// Called by CallKit when the user taps End in the native UI.
    public var onEnd: (() -> Void)?
    /// Called by CallKit when the user toggles Hold in the native UI.
    /// `held == true` means the call should be placed on hold.
    public var onHold: ((Bool) -> Void)?
    /// Called by CallKit when the user toggles Mute in the native UI.
    public var onMuted: ((Bool) -> Void)?
    /// Called by CallKit when the audio session is activated.
    /// CapacitorSip dispatches pjsua_set_snd_dev on sipQueue from this callback.
    public var onAudioActivated: (() -> Void)?

    private override init() {
        let cfg = CXProviderConfiguration(localizedName: "Lemtel")
        cfg.supportsVideo = false
        cfg.maximumCallsPerCallGroup = 1
        cfg.supportedHandleTypes = [.phoneNumber, .generic]
        provider = CXProvider(configuration: cfg)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    @objc public func reportIncoming(from: String) {
        let uuid = UUID()
        activeUUID = uuid
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: from)
        update.hasVideo = false
        provider.reportNewIncomingCall(with: uuid, update: update) { _ in }
    }

    /// Called by AppDelegate when a VoIP push notification arrives.
    /// iOS 13+ requires reporting an incoming call via CallKit within the
    /// PKPushRegistryDelegate callback — otherwise the app is killed.
    /// The `completion` block MUST be called to satisfy the PushKit requirement.
    public func reportIncomingVoipPush(from: String, callId: String, completion: @escaping () -> Void) {
        let uuid = UUID()
        activeUUID = uuid
        let update = CXCallUpdate()
        // Display the caller ID from the push payload.
        let displayName = from
            .replacingOccurrences(of: "sip:", with: "")
            .components(separatedBy: "@").first ?? from
        update.remoteHandle = CXHandle(type: .generic, value: displayName)
        update.localizedCallerName = displayName
        update.hasVideo = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                NSLog("[CallKitManager] ⚠️ reportNewIncomingCall error: \(error)")
            } else {
                NSLog("[CallKitManager] 📞 Incoming VoIP push call reported to CallKit: \(displayName)")
            }
            completion()
        }
    }

    /// Returns true when the microphone permission has been granted at the OS
    /// level. Callers MUST check this before letting PJSIP activate the audio
    /// session — otherwise `pjsua_call_make_call` will fail silently and
    /// AVAudioSession activation can crash the process.
    @objc public static func hasRecordPermission() -> Bool {
        return AVAudioSession.sharedInstance().recordPermission == .granted
    }

    /// Present a native alert steering the user to Settings when the mic is
    /// blocked. Safe to call from any thread; hops to main.
    private func presentMicDeniedAlert() {
        DispatchQueue.main.async {
            let alert = UIAlertController(
                title: NSLocalizedString("Microphone access required", comment: ""),
                message: NSLocalizedString(
                    "Lemtel needs microphone access to place calls. Enable it in Settings → Lemtel → Microphone.",
                    comment: ""
                ),
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(
                title: NSLocalizedString("Open Settings", comment: ""),
                style: .default,
                handler: { _ in
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            ))
            alert.addAction(UIAlertAction(
                title: NSLocalizedString("Cancel", comment: ""),
                style: .cancel
            ))

            guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
                  let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
                return
            }
            var top: UIViewController = root
            while let presented = top.presentedViewController { top = presented }
            top.present(alert, animated: true)
        }
    }

    @objc public func reportOutgoing(to: String) {
        // Guard: never let CallKit start an outbound call while the mic is denied.
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            break
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                if granted {
                    DispatchQueue.main.async { self?.reportOutgoing(to: to) }
                } else {
                    self?.presentMicDeniedAlert()
                }
            }
            return
        case .denied:
            NSLog("[CallKitManager] ⛔ Outgoing call blocked: microphone permission denied")
            presentMicDeniedAlert()
            return
        @unknown default:
            presentMicDeniedAlert()
            return
        }

        let uuid = UUID()
        activeUUID = uuid
        let handle = CXHandle(type: .generic, value: to)
        let start = CXStartCallAction(call: uuid, handle: handle)
        callController.request(CXTransaction(action: start)) { _ in }
        provider.reportOutgoingCall(with: uuid, startedConnectingAt: nil)
    }

    @objc public func reportConnected() {
        guard let uuid = activeUUID else { return }
        provider.reportOutgoingCall(with: uuid, connectedAt: nil)
    }

    @objc public func reportEnded() {
        guard let uuid = activeUUID else { return }
        provider.reportCall(with: uuid, endedAt: nil, reason: .remoteEnded)
        activeUUID = nil
    }

    /// Programmatically toggle hold state (e.g. when JS taps the in-app Hold
    /// button). Routes through CallKit so the native UI stays in sync.
    @objc public func requestHold(_ held: Bool) {
        guard let uuid = activeUUID else { return }
        let action = CXSetHeldCallAction(call: uuid, onHold: held)
        callController.request(CXTransaction(action: action)) { _ in }
    }
}

extension CallKitManager: CXProviderDelegate {
    public func providerDidReset(_ provider: CXProvider) { activeUUID = nil }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        onAnswer?()
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        onEnd?()
        action.fulfill()
        activeUUID = nil
    }

    public func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        onHold?(action.isOnHold)
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        onMuted?(action.isMuted)
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        action.fulfill()
    }

    /// iOS has activated the audio session — forward to CapacitorSip which will
    /// call pjsua_set_snd_dev on the PJLIB-registered sipQueue thread.
    /// NEVER call pjsua_set_snd_dev directly here: CallKit runs this on its own
    /// internal thread which is NOT registered in PJLIB → assertion crash.
    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // Check microphone permission BEFORE activating audio session
        let micPermission = AVAudioSession.sharedInstance().recordPermission

        switch micPermission {
        case .granted:
            // Safe to activate audio
            do {
                try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP])
                try audioSession.setActive(true)
                NSLog("[CallKit] ✅ AVAudioSession activated successfully")
                onAudioActivated?()
            } catch {
                NSLog("[CallKit] ❌ AVAudioSession activation failed: \(error)")
            }

        case .denied:
            // Microphone permission denied — cancel the call gracefully
            NSLog("[CallKit] ❌ Microphone permission denied — cancelling call")
            if let uuid = activeUUID {
                provider.reportCall(with: uuid, endedAt: Date(), reason: .failed)
            }
            // Notify JS layer so UI can show permission screen
            NotificationCenter.default.post(
                name: NSNotification.Name("MicrophoneDeniedDuringCall"),
                object: nil
            )

        case .undetermined:
            // Permission not yet requested — request it now
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.onAudioActivated?()
                    } else {
                        NSLog("[CallKit] ❌ User denied microphone during call setup")
                        if let uuid = self?.activeUUID {
                            provider.reportCall(with: uuid, endedAt: Date(), reason: .failed)
                        }
                    }
                }
            }

        @unknown default:
            NSLog("[CallKit] ❓ Unknown microphone permission state")
        }
    }

    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        print("[CallKitManager] 🔇 AVAudioSession deactivated by CallKit")
    }
}
