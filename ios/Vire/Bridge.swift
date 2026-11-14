import AVFoundation
import CoreMotion
import Foundation
import WebKit

/// JS -> native: window.webkit.messageHandlers.vire.postMessage({cmd})
/// native -> JS: window.__vireNative(msg). Message shapes are in CONTRACT.md ("Native bridge").
final class Bridge: NSObject, WKScriptMessageHandler, CMHeadphoneMotionManagerDelegate {
    weak var webView: WKWebView?

    private let headphones = CMHeadphoneMotionManager()
    private let motionQueue = OperationQueue()
    private var headBuffer: [[Double]] = []
    private var airpodsConnected = false
    private let heart = HeartSession()
    /** the page asked for head motion and has not asked to stop */
    private var wantMotion = false
    /** uptime of the last sample, written on the motion queue */
    private var lastSample: TimeInterval = 0
    private var lastError: String?
    private var starts = 0
    private var samples = 0
    private var watchdog: Timer?

    override init() {
        super.init()
        motionQueue.maxConcurrentOperationCount = 1
        headphones.delegate = self
        heart.onRate = { [weak self] bpm, date in
            self?.send(["k": "hr", "t": (date.timeIntervalSince1970 * 1000).rounded(), "bpm": (bpm * 10).rounded() / 10])
            self?.sendCaps()
        }
        // the same heart rate as Health stored it, with what measured it ("hrs": the page's older code ignores it)
        heart.onSample = { [weak self] bpm, date, name, model, n in
            NSLog("[vire] heart sample %.1f from %@ (%@) n=%d", bpm, name, model, n)
            self?.send([
                "k": "hrs", "t": (date.timeIntervalSince1970 * 1000).rounded(), "bpm": (bpm * 10).rounded() / 10,
                "src": name, "model": model, "n": n,
            ])
        }
        heart.onState = { [weak self] _ in self?.sendStatus() }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "start":
            startMotion()
            sendCaps()
            sendStatus()
        case "stop":
            stopMotion()
        case "heart":
            if (body["on"] as? Bool) == true { heart.start() } else { heart.stop() }
        case "reload":
            webView?.load(URLRequest(url: Config.startURL))
        case "setUrl":
            if let s = body["url"] as? String, let url = URL(string: s) {
                UserDefaults.standard.set(s, forKey: Config.urlKey)
                webView?.load(URLRequest(url: url))
            }
        default:
            break
        }
    }

    // MARK: AirPods head motion

    private func permission() -> String {
        switch CMHeadphoneMotionManager.authorizationStatus() {
        case .authorized: return "allowed"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not asked"
        @unknown default: return "unknown"
        }
    }

    /** where the phone is sending sound right now: tells whether the AirPods are on this iPhone at all */
    private func route() -> String {
        let outs = AVAudioSession.sharedInstance().currentRoute.outputs
        return outs.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ")
    }

    private func startMotion() {
        wantMotion = true
        headphones.delegate = self
        beginUpdates()
        DispatchQueue.main.async { [weak self] in
            guard let self, self.watchdog == nil else { return }
            self.watchdog = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in self?.check() }
        }
    }

    private func beginUpdates() {
        if headphones.isDeviceMotionActive { headphones.stopDeviceMotionUpdates() }
        starts += 1
        NSLog("[vire] motion start #%d available=%d permission=%@ route=%@", starts, headphones.isDeviceMotionAvailable ? 1 : 0, permission(), route())
        headphones.startDeviceMotionUpdates(to: motionQueue) { [weak self] motion, error in
            guard let self else { return }
            if let error {
                let ns = error as NSError
                let text = "\(ns.domain) \(ns.code): \(ns.localizedDescription)"
                if text != self.lastError {
                    self.lastError = text
                    NSLog("[vire] motion error %@", text)
                    self.sendStatus()
                }
            }
            guard let m = motion else { return }
            self.lastSample = ProcessInfo.processInfo.systemUptime
            self.samples += 1
            if self.samples == 1 || self.samples % 250 == 0 { NSLog("[vire] motion samples %d", self.samples) }
            if self.lastError != nil { self.lastError = nil }
            let now = Date().timeIntervalSince1970 * 1000
            var age = (ProcessInfo.processInfo.systemUptime - m.timestamp) * 1000
            if age < 0 || age > 300 { age = 0 }
            let deg = 180 / Double.pi
            let sample: [Double] = [
                (now - age).rounded(),
                m.attitude.pitch * deg, m.attitude.yaw * deg, m.attitude.roll * deg,
                m.userAcceleration.x, m.userAcceleration.y, m.userAcceleration.z,
                // rotation rate, deg/s: the raw material for the ear model (the AirPods feeling a smile)
                m.rotationRate.x * deg, m.rotationRate.y * deg, m.rotationRate.z * deg,
            ].map { ($0 * 1000).rounded() / 1000 }
            self.headBuffer.append(sample)
            if !self.airpodsConnected {
                self.airpodsConnected = true
                self.sendCaps()
                self.sendStatus()
            }
            if self.headBuffer.count >= 3 {
                let batch = self.headBuffer
                self.headBuffer.removeAll(keepingCapacity: true)
                self.send(["k": "head", "s": batch])
            }
        }
    }

    /** every 2.5 s while the page wants motion: say where things stand, and start again if nothing is arriving */
    private func check() {
        guard wantMotion else { return }
        let quiet = ProcessInfo.processInfo.systemUptime - lastSample > 3
        if quiet {
            if airpodsConnected {
                airpodsConnected = false
                sendCaps()
            }
            // not while the iPhone is still asking for permission: a restart could take the question away
            if CMHeadphoneMotionManager.authorizationStatus() == .authorized { beginUpdates() }
        }
        sendStatus()
    }

    private func stopMotion() {
        wantMotion = false
        if headphones.isDeviceMotionActive { headphones.stopDeviceMotionUpdates() }
    }

    func headphoneMotionManagerDidConnect(_ manager: CMHeadphoneMotionManager) {
        airpodsConnected = true
        sendCaps()
        sendStatus()
    }

    func headphoneMotionManagerDidDisconnect(_ manager: CMHeadphoneMotionManager) {
        airpodsConnected = false
        sendCaps()
        sendStatus()
    }

    // MARK: to the page

    private func sendCaps() {
        send(["k": "caps", "airpodsMotion": airpodsConnected, "airpodsHr": heart.gotSample])
    }

    private func sendStatus() {
        var status: [String: Any] = [
            "k": "status", "airpods": airpodsConnected ? "connected" : "disconnected", "hr": heart.state.rawValue,
            "permission": permission(), "available": headphones.isDeviceMotionAvailable, "active": headphones.isDeviceMotionActive,
            "route": route(), "starts": starts, "samples": samples,
        ]
        if let lastError { status["error"] = lastError }
        send(status)
    }

    private func send(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
            let json = String(data: data, encoding: .utf8)
        else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.__vireNative&&window.__vireNative(\(json))", completionHandler: nil)
        }
    }
}
