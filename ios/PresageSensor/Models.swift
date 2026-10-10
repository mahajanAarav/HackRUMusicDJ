import Foundation

/// One reading from a sensor provider. Only these numbers ever leave the device; video never does.
struct RawVitals {
    var pulse: Double?
    var breathing: Double?
    var hrv: Double?
    var confidence: Double
}
