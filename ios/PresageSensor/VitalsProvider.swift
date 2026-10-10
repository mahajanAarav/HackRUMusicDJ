import Foundation

protocol VitalsProvider: AnyObject {
    var onVitals: ((RawVitals) -> Void)? { get set }
    func start()
    func stop()
}

/// Works anywhere (including the iOS Simulator) so the whole bridge can be tested without the camera.
/// The web page labels results from this as "simulated", never as Presage.
final class SimulatedProvider: VitalsProvider {
    var onVitals: ((RawVitals) -> Void)?
    private var timer: Timer?
    private var t = 0.0

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.t += 1
            let pulse = 74 + 4 * sin(self.t / 6) + Double.random(in: -1.5...1.5)
            let breathing = 14.5 + 0.8 * sin(self.t / 9) + Double.random(in: -0.3...0.3)
            self.onVitals?(RawVitals(pulse: pulse, breathing: breathing, hrv: 45 + Double.random(in: -5...5), confidence: 0.85))
        }
    }
    func stop() { timer?.invalidate(); timer = nil }
}
