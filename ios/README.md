# PresageSensor (iOS)

SwiftUI app that posts vitals readings to the backend every ~3 s. **Not yet built in Xcode** (written without Xcode available); expect to create the project and fix small compile issues.

1. Xcode: new iOS App named PresageSensor (SwiftUI), drop these `.swift` files in, delete the template ones.
2. Info.plist: `NSCameraUsageDescription`, and allow local networking / ATS exception for `http://<your-LAN-ip>:3000`.
3. Run with "Simulated sensor" on first to verify the backend path (works in the iOS Simulator).
4. Real sensing: add the SmartSpectra Swift package, wire `PresageProvider.swift` (physical iPhone required), turn the simulated toggle off.
5. In the web guest page, opt in to sensing first; the backend rejects readings from guests who have not (403).
