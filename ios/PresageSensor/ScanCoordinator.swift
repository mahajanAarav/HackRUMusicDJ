import Foundation
import SwiftUI

/// Runs one scan on behalf of the web page: starts the sensor, streams progress back, and finishes with
/// a single result (median pulse/breathing over the window). Everything it sends back is plain numbers.
@MainActor
final class ScanCoordinator: ObservableObject {
    @Published var scanning = false
    @Published var secondsLeft = 0
    @Published var livePulse: Double?

    /// Set by the web view; delivers an event dictionary to the page.
    var emit: (([String: Any]) -> Void)?

    static var useSimulated: Bool { UserDefaults.standard.object(forKey: "useSimulated") as? Bool ?? true }

    private var provider: VitalsProvider?
    private var samples: [RawVitals] = []
    private var timer: Timer?

    func start(seconds: Int) {
        guard !scanning else { return }
        scanning = true
        secondsLeft = seconds
        livePulse = nil
        samples = []

        let p: VitalsProvider = Self.useSimulated ? SimulatedProvider() : PresageProvider()
        p.onVitals = { [weak self] raw in
            Task { @MainActor in
                guard let self, self.scanning else { return }
                self.samples.append(raw)
                if let pulse = raw.pulse { self.livePulse = pulse }
            }
        }
        provider = p
        p.start()

        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.scanning else { return }
                self.secondsLeft -= 1
                if self.secondsLeft <= 0 { self.finish() } else { self.emitProgress() }
            }
        }
        emitProgress()
    }

    func cancel() {
        guard scanning else { return }
        teardown()
        emit?(["type": "cancelled"])
    }

    private func emitProgress() {
        var e: [String: Any] = ["type": "progress", "seconds_left": secondsLeft]
        if let p = livePulse { e["pulse_bpm"] = (p * 10).rounded() / 10 }
        emit?(e)
    }

    private func finish() {
        let pulses = samples.compactMap(\.pulse)
        let breaths = samples.compactMap(\.breathing)
        let hrvs = samples.compactMap(\.hrv)
        let conf = samples.isEmpty ? 0 : samples.map(\.confidence).reduce(0, +) / Double(samples.count)
        let n = samples.count
        teardown()
        var e: [String: Any] = ["type": "result", "n_samples": n, "confidence": (conf * 100).rounded() / 100]
        e["pulse_bpm"] = Self.median(pulses).map { ($0 * 10).rounded() / 10 } ?? NSNull()
        e["breathing_rpm"] = Self.median(breaths).map { ($0 * 10).rounded() / 10 } ?? NSNull()
        e["hrv_ms"] = Self.median(hrvs).map { ($0 * 10).rounded() / 10 } ?? NSNull()
        emit?(e)
    }

    private func teardown() {
        timer?.invalidate(); timer = nil
        provider?.stop(); provider = nil
        scanning = false
        samples = []
    }

    private static func median(_ xs: [Double]) -> Double? {
        guard !xs.isEmpty else { return nil }
        let s = xs.sorted()
        return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
    }
}
