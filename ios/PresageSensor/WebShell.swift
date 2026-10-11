import SwiftUI
import WebKit

/// Hosts the DJ Sense site in a web view and exposes the Presage scan to it.
///   web -> native:  window.webkit.messageHandlers.presage.postMessage({ type: "start", seconds: 20 })
///   native -> web:  window "presage-event" CustomEvent with { type: "progress" | "result" | "error" | "cancelled", ... }
struct WebShell: UIViewRepresentable {
    let url: URL
    @ObservedObject var scan: ScanCoordinator

    func makeCoordinator() -> Coordinator { Coordinator(scan: scan) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Tell the page it is inside the app, and whether the sensor is real or simulated.
        let simulated = ScanCoordinator.useSimulated ? "true" : "false"
        let js = "window.presageNative = { available: true, simulated: \(simulated) };"
        config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(context.coordinator, name: "presage")

        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        context.coordinator.web = web
        scan.emit = { [weak web] event in
            guard let web, let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('presage-event', { detail: \(json) }))")
            }
        }
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate {
        let scan: ScanCoordinator
        weak var web: WKWebView?
        init(scan: ScanCoordinator) { self.scan = scan }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "presage", let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            Task { @MainActor in
                switch type {
                case "start": self.scan.start(seconds: (body["seconds"] as? Int) ?? 20)
                case "stop": self.scan.cancel()
                default: break
                }
            }
        }

        // Let the page use the microphone (voice notes) after iOS has asked the user once.
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(.grant)
        }
    }
}
