## Plan

1. **Fix the real iOS issue**
   - The log shows `native plugin unavailable in this build`, so the app is falling back to WebView/JsSIP only.
   - iOS suspends the WebView when the phone is locked/closed, so SIP drops and inbound calls go straight to voicemail.

2. **Make native SIP/VoIP compile reliably**
   - Update the Planiprêt mobile native config script so `PpSipKeepAlive` and `PpVoipCall` are always registered/compiled correctly in the iOS app.
   - Keep `audio`, `voip`, `remote-notification`, and `fetch` background modes in iOS config.
   - Ensure PushKit/CallKit plugin methods are available instead of returning `UNIMPLEMENTED`.

3. **Fix VoIP push token registration**
   - Verify/patch the mobile hook so the iOS VoIP token is uploaded after SIP credentials are loaded.
   - Ensure the token stores the correct extension, bundle id, platform, and environment.
   - Add safe debug output on the mobile SIP screen so we can see: native SIP available, VoIP token uploaded, background guard active.

4. **Fix reconnect behavior**
   - Prevent the JS softphone from fighting the native keep-alive during background/foreground transitions.
   - On foreground return, show a protected/registered state immediately while re-registration refreshes instead of showing disconnected first.

5. **Backend inbound-call wake path**
   - Confirm the inbound webhook sends VoIP push to the broker’s stored iOS token.
   - Add clearer backend logging for “no token”, “APNs not configured”, or “APNs delivery failed”.

6. **Deploy/verify**
   - Deploy changed backend functions.
   - After implementation, you’ll need to pull the project and run `npx cap sync`, then rebuild the iOS app in Xcode so the native plugin is actually inside the app binary.