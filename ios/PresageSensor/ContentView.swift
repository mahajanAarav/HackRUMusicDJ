import SwiftUI

/// Pairing is manual for the hackathon: paste the server URL, room code and your guest id
/// (shown on the guest web page under "Pulse sensing" once you opt in).
struct ContentView: View {
    @AppStorage("baseURL") private var baseURL = "http://192.168.1.10:3000"
    @AppStorage("room") private var room = ""
    @AppStorage("guestId") private var guestId = ""
    @State private var consented = false
    @State private var sensing = false
    @State private var useSimulated = true
    @State private var status = "Idle"
    @State private var last: RawVitals?
    @State private var provider: VitalsProvider?

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Server URL", text: $baseURL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Room code", text: $room).textInputAutocapitalization(.characters)
                    TextField("Guest id", text: $guestId).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Toggle("Simulated sensor (no camera)", isOn: $useSimulated)
                }
                Section("Consent") {
                    Toggle("I agree to share pulse, breathing and expression readings with this room. The camera video stays on this phone and is never stored or sent.", isOn: $consented)
                        .disabled(sensing)
                }
                Section {
                    Button(sensing ? "Stop sensing" : "Start sensing") { sensing ? stop() : start() }
                        .disabled(!consented || room.isEmpty || guestId.isEmpty)
                    Text(status).font(.footnote).foregroundStyle(.secondary)
                }
                if let l = last {
                    Section("Last reading") {
                        Text("Pulse \(l.pulse.map { String(format: "%.0f", $0) } ?? "–") bpm")
                        Text("Breathing \(l.breathing.map { String(format: "%.1f", $0) } ?? "–") rpm")
                        Text("Valence \(l.valence.map { String(format: "%.2f", $0) } ?? "–")")
                    }
                }
            }
            .navigationTitle("Presage Sensor")
            .safeAreaInset(edge: .top) {
                if sensing {
                    HStack { Circle().fill(.red).frame(width: 10, height: 10); Text("Camera sensing ON: readings only, no video stored").font(.footnote.bold()) }
                        .padding(8).frame(maxWidth: .infinity).background(.red.opacity(0.15))
                }
            }
        }
    }

    private func start() {
        guard let url = URL(string: baseURL) else { status = "Bad URL"; return }
        let up = Uploader(baseURL: url, room: room.uppercased(), guestId: guestId)
        let p: VitalsProvider = useSimulated ? SimulatedProvider() : PresageProvider()
        p.onVitals = { raw in
            Task { @MainActor in
                last = raw
                if let err = await up.send(raw) { status = "Upload error: \(err)" } else { status = "Sending every ~3s" }
            }
        }
        p.start(); provider = p; sensing = true; status = "Starting…"
    }

    private func stop() { provider?.stop(); provider = nil; sensing = false; status = "Stopped" }
}
