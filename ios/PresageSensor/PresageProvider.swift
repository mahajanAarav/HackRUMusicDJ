import Foundation
// import SmartSpectra   // <- add the Swift package from https://github.com/Presage-Security/SmartSpectra (swift/) and uncomment
// import AVFoundation

/// INTEGRATION POINT (the one file that needs the real SDK). Not compiled or verified against the SDK yet.
///
/// From the SDK README: `SmartSpectraSDK.shared`, metrics requested with `SmartSpectraConfig.breathingMetrics`,
/// `SmartSpectraConfig.cardioMetrics` and `MetricType.expressions`, API key set per the "Option 1: API key"
/// quickstart (keep the key out of git: read it from Info.plist / an xcconfig that is git-ignored),
/// and a camera `start()`. The SDK probably brings its own SwiftUI camera view, which must be on screen while
/// it measures: embed it inside `ScanOverlayView` (see the TODO there).
///
/// When the SDK publishes a metric, forward it:
///
///     onVitals?(RawVitals(pulse: <bpm>, breathing: <breaths/min>, hrv: <ms or nil>, confidence: <0...1>))
///
/// Rules: needs a physical iPhone (camera). Never keep or upload frames. If the SDK reports expressions as
/// categories you can ignore them for now; the web app only needs pulse and breathing.
final class PresageProvider: VitalsProvider {
    var onVitals: ((RawVitals) -> Void)?
    func start() { /* TODO: SmartSpectraSDK.shared ... start() */ }
    func stop() { /* TODO: stop the SDK session */ }
}
