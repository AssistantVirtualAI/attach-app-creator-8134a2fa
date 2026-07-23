import UIKit
import Capacitor
import WebKit
import AVFoundation
import PushKit
import Intents
import BackgroundTasks


@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // PushKit VoIP registry — kept alive for the app lifetime.
    private var voipRegistry: PKPushRegistry?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        // ---- Boot guard: ensure storyboard wires the custom bridge VC, not raw CAPBridgeViewController ----
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard let root = self.window?.rootViewController else {
                NSLog("[BootGuard] ❌ No rootViewController after launch")
                return
            }
            let cls = type(of: root)
            let name = String(describing: cls)
            NSLog("[BootGuard] rootViewController class = \(name)")
            if root is AppBridgeViewController {
                NSLog("[BootGuard] ✅ AppBridgeViewController loaded — plugin registration path active")
            } else if name == "CAPBridgeViewController" {
                NSLog("[BootGuard] ❌ FATAL: Storyboard is using raw CAPBridgeViewController. Local plugins (CapacitorPjsip) will NOT be registered. Update Main.storyboard customClass to AppBridgeViewController (customModule=\"App\").")
                self.showBootError(message: "Configuration error: Main.storyboard must reference AppBridgeViewController, not CAPBridgeViewController. Plugin CapacitorPjsip cannot load.")
            } else {
                NSLog("[BootGuard] ⚠️ Unexpected rootViewController: \(name)")
            }
        }


        // Configure audio session for VoIP (full-duplex, BT + speaker route).
        let audioSession = AVAudioSession.sharedInstance()
        try? audioSession.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker, .duckOthers]
        )
        try? audioSession.setPreferredSampleRate(48000)
        try? audioSession.setPreferredIOBufferDuration(0.02)
        try? audioSession.setActive(true, options: [])

        // Proactively request microphone permission so the system prompt
        // appears on first launch rather than on first call.
        audioSession.requestRecordPermission { granted in
            NSLog("[AVA] Microphone permission granted: \(granted)")
        }

        // Register for VoIP push notifications via PushKit.
        // iOS wakes the app (even if terminated) when a VoIP push arrives.
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        voipRegistry = registry
        NSLog("[VoIP] PushKit registry started")

        // Disable mDNS ICE candidate obfuscation in WKWebView
        let webConfig = WKWebViewConfiguration()
        webConfig.allowsInlineMediaPlayback = true
        webConfig.mediaTypesRequiringUserActionForPlayback = []
        if #available(iOS 14.0, *) {
            webConfig.limitsNavigationsToAppBoundDomains = false
        }

        // Force real IP addresses for WebRTC ICE candidates
        let processPool = WKProcessPool()
        webConfig.processPool = processPool

        // Apply WebKit internal flags to disable mDNS
        let script = WKUserScript(
            source: """
                // Force WebRTC to expose real IPs
                const origGetStats = RTCPeerConnection.prototype.getStats;
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        webConfig.userContentController.addUserScript(script)

        // Register BGProcessingTask for periodic SIP re-registration (parity with Android SipConnectionService)
        if #available(iOS 13.0, *) {
            BGTaskScheduler.shared.register(forTaskWithIdentifier: "com.lemtel.softphone.sip-refresh", using: nil) { task in
                self.handleSipRefreshTask(task as! BGProcessingTask)
            }
            self.scheduleSipRefreshTask()
        }

        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {
        // Give PJSIP up to ~25 seconds to finish any pending re-REGISTER
        // before iOS suspends the process. Parity with Android WakeLock.
        var bgTask: UIBackgroundTaskIdentifier = .invalid
        bgTask = application.beginBackgroundTask(withName: "SIPKeepAlive") {
            NSLog("[SIP] Background task expired — PJSIP will be suspended")
            if bgTask != .invalid {
                application.endBackgroundTask(bgTask)
                bgTask = .invalid
            }
        }
        DispatchQueue.global(qos: .background).asyncAfter(deadline: .now() + 20) {
            NSLog("[SIP] Background keep-alive: triggering re-REGISTER")
            CapacitorPjsip.shared?.triggerReregister()
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                if bgTask != .invalid {
                    application.endBackgroundTask(bgTask)
                    bgTask = .invalid
                }
            }
        }
    }
    func applicationWillEnterForeground(_ application: UIApplication) {
        // Force an immediate re-REGISTER so the UI reflects reality after resume.
        CapacitorPjsip.shared?.triggerReregister()
    }
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    // MARK: - Background tasks (SIP registration refresh)
    @available(iOS 13.0, *)
    private func scheduleSipRefreshTask() {
        let request = BGProcessingTaskRequest(identifier: "com.lemtel.softphone.sip-refresh")
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
            NSLog("[BGTask] Scheduled sip-refresh in 15 min")
        } catch {
            NSLog("[BGTask] Failed to schedule sip-refresh: \(error)")
        }
    }

    @available(iOS 13.0, *)
    private func handleSipRefreshTask(_ task: BGProcessingTask) {
        scheduleSipRefreshTask()
        task.expirationHandler = {
            NSLog("[BGTask] sip-refresh expired")
            task.setTaskCompleted(success: false)
        }
        NSLog("[BGTask] sip-refresh running — triggering re-REGISTER")
        CapacitorPjsip.shared?.triggerReregister()
        DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
            task.setTaskCompleted(success: true)
        }
    }


    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Intercept tel: URLs from iOS Recents / Contacts tap.
        // Extract the phone number, store it in UserDefaults, then let the
        // JS layer pick it up via the ava:pendingCall event in deepLink.ts.
        if url.scheme?.lowercased() == "tel" {
            let raw = url.absoluteString
            // tel:+15141234567  →  +15141234567
            let number = raw.replacingOccurrences(of: "tel:", with: "", options: .caseInsensitive)
                           .removingPercentEncoding ?? raw
            NSLog("[DeepLink] tel: URL intercepted → number=\(number)")
            UserDefaults.standard.set(number, forKey: "ava.pendingCallNumber")
            // Post a JS-visible notification once the WebView is ready.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                CapacitorPjsip.shared?.notifyBg("pendingCall", ["number": number])
            }
            // Also open the app normally via Capacitor so the WebView loads.
            return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Intercept INStartCallIntent — fired when user picks "Call via AVA Softphone"
        // from iOS Contacts. Extract the phone number and trigger auto-dial.
        if #available(iOS 13.0, *) {
            if let interaction = userActivity.interaction {
                // INStartCallIntent (iOS 13+) or INStartAudioCallIntent (iOS 10-12)
                var rawNumber: String? = nil
                if let intent = interaction.intent as? INStartCallIntent {
                    rawNumber = intent.contacts?.first?.personHandle?.value
                } else if let intent = interaction.intent as? INStartAudioCallIntent {
                    rawNumber = intent.contacts?.first?.personHandle?.value
                }
                if let raw = rawNumber, !raw.isEmpty {
                    // Keep only digits, +, *, #
                    let allowed = CharacterSet.decimalDigits.union(CharacterSet(charactersIn: "+*#"))
                    let number = raw.unicodeScalars.filter { allowed.contains($0) }.map { String($0) }.joined()
                    if !number.isEmpty {
                        NSLog("[DeepLink] INStartCallIntent → number=\(number)")
                        UserDefaults.standard.set(number, forKey: "ava.pendingCallNumber")
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                            CapacitorPjsip.shared?.notifyBg("pendingCall", ["number": number])
                        }
                    }
                }
            }
        }
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // Display an opaque error overlay if the storyboard is mis-wired so the
    // app does not silently sit in "connecting" forever.
    private func showBootError(message: String) {
        guard let window = self.window else { return }
        let overlay = UIViewController()
        overlay.view.backgroundColor = UIColor(red: 0.10, green: 0.02, blue: 0.05, alpha: 1)
        let label = UILabel()
        label.text = "⚠️ Boot error\n\n\(message)"
        label.numberOfLines = 0
        label.textColor = .white
        label.textAlignment = .center
        label.font = .systemFont(ofSize: 16, weight: .medium)
        label.translatesAutoresizingMaskIntoConstraints = false
        overlay.view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: overlay.view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: overlay.view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: overlay.view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: overlay.view.trailingAnchor, constant: -24)
        ])
        window.rootViewController?.present(overlay, animated: false)
    }
}

// MARK: - PKPushRegistryDelegate

extension AppDelegate: PKPushRegistryDelegate {

    /// Called when iOS assigns or refreshes the VoIP push token.
    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        NSLog("[VoIP] \u{1F4F2} PushKit token: \(token.prefix(16))\u{2026}")
        CapacitorPjsip.shared?.setVoipPushToken(token)
        UserDefaults.standard.set(token, forKey: "ava.voipPushToken")
    }

    /// Called when a VoIP push notification arrives.
    /// iOS wakes the app even if terminated — must report via CallKit within ~30s.
    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP else { completion(); return }
        let dict = payload.dictionaryPayload
        NSLog("[VoIP] \u{1F4DE} Incoming VoIP push: \(dict)")
        let from = (dict["from"] as? String)
            ?? (dict["caller_id_name"] as? String)
            ?? (dict["caller_id_number"] as? String)
            ?? "Unknown"
        let callId = (dict["call-id"] as? String)
            ?? (dict["uuid"] as? String)
            ?? UUID().uuidString
        // Report to CallKit (mandatory iOS 13+).
        CallKitManager.shared.reportIncomingVoipPush(from: from, callId: callId) {
            completion()
        }
        // Notify JS layer to show in-app incoming call UI.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            CapacitorPjsip.shared?.notifyBg("callReceived", ["from": from, "callId": callId, "source": "voip-push"])
        }
    }

    /// Called when the VoIP push token is invalidated (e.g. app reinstall).
    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        NSLog("[VoIP] \u{26A0} PushKit token invalidated")
        UserDefaults.standard.removeObject(forKey: "ava.voipPushToken")
        CapacitorPjsip.shared?.setVoipPushToken(nil)
    }
}
