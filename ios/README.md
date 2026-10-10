# Biofeedback DJ iPhone app (Presage SmartSpectra)

A thin SwiftUI shell. It opens the deployed web app in a web view and runs the **Presage SmartSpectra SDK** natively
for the pulse scan. The web app asks for a scan (`window.webkit.messageHandlers.presage.postMessage({type:"start",seconds:20})`),
the app measures, and only numbers come back to the page. Video never leaves the phone from our code.

Not yet built in Xcode (written without Xcode). Syntax-checked only. Expect small compile fixes.

## Setup (needs a Mac with Xcode and a physical iPhone)
1. Xcode: File > New > Project > iOS App, SwiftUI, name it `PresageSensor`. Delete the template files and drag in everything in this folder.
2. Info.plist: add `NSCameraUsageDescription` ("Presage reads your pulse from the camera") and `NSMicrophoneUsageDescription` ("Voice notes for the DJ").
3. Run it. First launch asks for your deployed site URL (the https `onrender.com` link). Leave **Use simulated sensor** ON to verify the bridge: open the Pulse tab, opt in, tap Start. The web page labels results "simulated".
4. Wire in the real SDK (the only file that needs it is `PresageProvider.swift`):
   - File > Add Package Dependencies > https://github.com/Presage-Security/SmartSpectra (the `swift/` package). Follow the README "Option 1: API key" quickstart.
   - **Keep the API key out of git**: put it in a git-ignored xcconfig or local plist, never in a committed file.
   - In `PresageProvider.start()` start the SDK; when it publishes pulse / breathing / HRV call `onVitals?(RawVitals(pulse:, breathing:, hrv:, confidence:))`.
   - The SDK likely has its own SwiftUI camera view. Put it where the TODO is in `ScanOverlayView` (`RootView.swift`); it must be on screen while measuring.
5. Turn **Use simulated sensor** OFF. The web page then shows "measured with presage smartspectra".

## Questions for Presage (Discord)
- Does the SDK send raw video anywhere, or only derived metrics? (We tell guests video stays on the phone.)
- Rate limits on the free tier?
- Which metrics does the iOS SDK expose in continuous mode (pulse, breathing, HRV, expression)?

## Files
- `WebShell.swift`: web view + JS bridge. `ScanCoordinator.swift`: runs a scan, streams progress, returns median numbers.
- `PresageProvider.swift`: **real SDK goes here**. `VitalsProvider.swift`: protocol + the simulated sensor.
- `RootView.swift`: site URL setup + scan screen. `Models.swift`, `PresageSensorApp.swift`.
