import Foundation

final class Uploader {
    var baseURL: URL
    var room: String
    var guestId: String
    private let enc = JSONEncoder()
    private let iso = ISO8601DateFormatter()

    init(baseURL: URL, room: String, guestId: String) {
        self.baseURL = baseURL; self.room = room; self.guestId = guestId
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    /// Returns an error string for the UI (e.g. 403 if the guest has not opted in on the web app).
    func send(_ raw: RawVitals) async -> String? {
        let reading = VitalsReading(
            guest_id: guestId,
            timestamp: iso.string(from: Date()),
            pulse_bpm: raw.pulse,
            breathing_rpm: raw.breathing,
            expression: raw.valence.map { v in .init(label: v > 0.25 ? "positive" : v < -0.25 ? "negative" : "neutral", valence: v) },
            confidence: raw.confidence
        )
        var req = URLRequest(url: baseURL.appendingPathComponent("api/rooms/\(room)/vitals"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? enc.encode(reading)
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode >= 300 {
                return (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String ?? "HTTP \(http.statusCode)"
            }
            return nil
        } catch { return error.localizedDescription }
    }
}
