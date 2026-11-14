import SwiftUI
import WebKit

enum Config {
    static let defaultURL = "https://vire.fly.dev/#/ears"
    static let urlKey = "vire.url"

    static var startURL: URL {
        let stored = UserDefaults.standard.string(forKey: urlKey) ?? defaultURL
        return URL(string: stored) ?? URL(string: defaultURL)!
    }
}

/// The whole UI is the web app. This shell adds what a browser cannot give it:
/// AirPods head motion and AirPods Pro heart rate, pushed into the page through `window.__vireNative`.
struct WebShell: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.applicationNameForUserAgent = "VireShell/2"
        cfg.userContentController.add(context.coordinator.bridge, name: "vire")

        let stage = UIColor(red: 0.078, green: 0.067, blue: 0.051, alpha: 1)
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = context.coordinator
        web.navigationDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = stage
        web.scrollView.backgroundColor = stage
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.isInspectable = true
        context.coordinator.bridge.webView = web
        web.load(URLRequest(url: Config.startURL))
        // A practice is five minutes with no touch, eyes often closed: the phone must not lock itself while Vire is open.
        UIApplication.shared.isIdleTimerDisabled = true
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate, WKNavigationDelegate {
        let bridge = Bridge()

        // Camera and microphone: the system prompt already asked; do not ask a second time per page load.
        func webView(
            _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }

        func webView(
            _ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            decisionHandler(.grant)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showOffline(webView, error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showOffline(webView, error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.load(URLRequest(url: Config.startURL))
        }

        private func showOffline(_ webView: WKWebView, _ error: Error) {
            let code = (error as NSError).code
            if code == NSURLErrorCancelled { return }
            let url = Config.startURL.absoluteString
            let html = """
            <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="background:#14110d;color:#f3ece0;font:17px -apple-system;padding:48px 28px">
            <h2 style="font-weight:500">Can't reach Vire</h2>
            <p style="color:#a79f90">\(error.localizedDescription)</p>
            <p><a href="\(url)" style="color:#e4572e">Try again</a></p></body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
    }
}
