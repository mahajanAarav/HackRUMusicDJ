import SwiftUI

struct RootView: View {
    @AppStorage("siteURL") private var siteURL = ""
    @AppStorage("useSimulated") private var useSimulated = true
    @State private var draft = ""
    @StateObject private var scan = ScanCoordinator()

    var body: some View {
        if let url = URL(string: siteURL), !siteURL.isEmpty {
            ZStack(alignment: .topTrailing) {
                WebShell(url: url, scan: scan).ignoresSafeArea(edges: .bottom)
                Button("Change site") { siteURL = "" }.font(.caption2).padding(6).opacity(0.5)
            }
            .fullScreenCover(isPresented: Binding(get: { scan.scanning }, set: { if !$0 { scan.cancel() } })) {
                ScanOverlayView(scan: scan)
            }
        } else {
            Form {
                Section("Your Biofeedback DJ site") {
                    TextField("https://your-site.onrender.com", text: $draft)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Button("Open") { siteURL = draft.trimmingCharacters(in: .whitespaces) }.disabled(URL(string: draft) == nil || draft.isEmpty)
                }
                Section("Sensor") {
                    Toggle("Use simulated sensor (testing only)", isOn: $useSimulated)
                    Text(useSimulated ? "Scans will be labeled \"simulated\" in the web app. Turn this off once the Presage SDK is wired into PresageProvider.swift." : "Scans use the Presage SmartSpectra SDK on this phone's camera.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// Shown while a scan runs. The Presage SDK needs its camera view on screen while it measures.
struct ScanOverlayView: View {
    @ObservedObject var scan: ScanCoordinator

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 18) {
                // TODO: embed the SmartSpectra SDK's camera view here (see Presage's iOS quickstart), e.g. SmartSpectraView().
                // Keep it large and centered on the face; this is where the user's face must be visible.
                RoundedRectangle(cornerRadius: 24).fill(Color.white.opacity(0.08))
                    .overlay(Text(ScanCoordinator.useSimulated ? "Simulated sensor\n(no camera in use)" : "Presage camera view goes here").multilineTextAlignment(.center).foregroundStyle(.white.opacity(0.6)))
                    .frame(maxWidth: 320, maxHeight: 380)
                Text("\(scan.secondsLeft)s").font(.system(size: 54, weight: .heavy, design: .rounded)).foregroundStyle(.white)
                if let p = scan.livePulse { Text("\(Int(p.rounded())) bpm").foregroundStyle(.white.opacity(0.7)) }
                Text("Face the light and hold still").font(.footnote).foregroundStyle(.white.opacity(0.6))
                Button("Cancel") { scan.cancel() }.buttonStyle(.bordered).tint(.white)
            }
        }
    }
}
