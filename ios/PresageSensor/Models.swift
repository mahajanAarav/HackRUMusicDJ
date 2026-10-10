import Foundation

/// Matches the backend payload (docs/schemas.md). Only these numbers ever leave the phone.
struct VitalsReading: Codable {
    struct Expression: Codable { var label: String; var valence: Double }
    var guest_id: String
    var timestamp: String
    var pulse_bpm: Double?
    var breathing_rpm: Double?
    var expression: Expression?
    var confidence: Double
    var source: String = "presage"
}

/// What a provider emits before we stamp it with a guest id and time.
struct RawVitals {
    var pulse: Double?
    var breathing: Double?
    var valence: Double?
    var confidence: Double
}
