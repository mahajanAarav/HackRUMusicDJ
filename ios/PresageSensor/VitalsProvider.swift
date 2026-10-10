import Foundation

protocol VitalsProvider: AnyObject {
    var onVitals: ((RawVitals) -> Void)? { get set }
    func start()
    func stop()
}

/// Works anywhere (including the iOS Simulator) so the whole pipeline can be tested without the camera.
final class SimulatedProvider: VitalsProvider {
    var onVitals: ((RawVitals) -> Void)?
    private var timer: Timer?
    private var t = 0.0

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.t += 3
            let pulse = 76 + 6 * sin(self.t / 30) + Double.random(in: -2...2)
            let breathing = 14 + sin(self.t / 45) + Double.random(in: -0.5...0.5)
            let valence = 0.2 + 0.3 * sin(self.t / 25)
            self.onVitals?(RawVitals(pulse: pulse, breathing: breathing, valence: valence, confidence: 0.85))
        }
    }
    func stop() { timer?.invalidate(); timer = nil }
}
