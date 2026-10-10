import Foundation
// import SmartSpectra   // <- add the Swift package from https://github.com/Presage-Security/SmartSpectra (swift/) and uncomment
// import AVFoundation

/// INTEGRATION POINT. Not compiled or verified against the SDK yet.
///
/// What the SDK docs confirm: `SmartSpectraSDK.shared`, config via `SmartSpectraConfig.breathingMetrics`
/// and `.cardioMetrics`, `MetricType.expressions`, and a camera `start()`. Follow the iOS README's
/// "Option 1: API key" quickstart for key setup and for how the SDK publishes metrics, then in the
/// metrics callback/observer call:
///
///     onVitals?(RawVitals(pulse: <pulse bpm>, breathing: <breaths/min>,
///                         valence: <map expression -> -1...1>, confidence: <0...1>))
///
/// Notes: needs a physical iPhone (camera), NSCameraUsageDescription in Info.plist, and the key must
/// not be committed. If the SDK exposes expressions as categories rather than a score, map them:
/// positive -> +0.6, neutral -> 0, negative -> -0.6. Never keep or upload frames; only RawVitals leaves.
final class PresageProvider: VitalsProvider {
    var onVitals: ((RawVitals) -> Void)?
    func start() { /* TODO: SmartSpectraSDK.shared ... start() */ }
    func stop() { /* TODO: stop the SDK session */ }
}
