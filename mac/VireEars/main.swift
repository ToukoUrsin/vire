// Vire Ears: a background helper for the Mac. It reads head motion from the AirPods that are connected to this Mac
// (CMHeadphoneMotionManager, 25 Hz) and hands it to the Vire page over a WebSocket on 127.0.0.1 only.
// Same messages as the iOS shell (CONTRACT.md, "Native bridge"). Nothing is stored and nothing leaves the Mac from here.
import CoreMotion
import Foundation
import Network

let port: UInt16 = 8873
let allowedOrigins = ["https://vire.fly.dev", "http://127.0.0.1", "http://localhost"]
let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("vire-tools/ears.log")

func log(_ s: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
    guard let data = line.data(using: .utf8) else { return }
    if let h = try? FileHandle(forWritingTo: logURL) {
        h.seekToEndOfFile()
        h.write(data)
        try? h.close()
    } else {
        try? data.write(to: logURL)
    }
}

final class Ears: NSObject, CMHeadphoneMotionManagerDelegate {
    private let headphones = CMHeadphoneMotionManager()
    private let motionQueue = OperationQueue()
    private let q = DispatchQueue(label: "fi.heliosone.vire-ears")
    private var listener: NWListener?
    private var clients: [ObjectIdentifier: NWConnection] = [:]
    private var wants = Set<ObjectIdentifier>()
    private var buffer: [[Double]] = []
    private var connected = false
    private var lastError = ""
    private var count = 0
    private var countAt = Date()

    override init() {
        super.init()
        motionQueue.maxConcurrentOperationCount = 1
        headphones.delegate = self
    }

    func run() throws {
        let ws = NWProtocolWebSocket.Options()
        ws.autoReplyPing = true
        ws.setClientRequestHandler(q) { _, headers in
            // a browser always says where the page came from: only Vire's own pages may listen
            let origin = headers.first { $0.name.lowercased() == "origin" }?.value
            if let o = origin, !allowedOrigins.contains(where: { o == $0 || o.hasPrefix($0 + ":") }) {
                log("refused origin \(o)")
                return NWProtocolWebSocket.Response(status: .reject, subprotocol: nil, additionalHeaders: nil)
            }
            return NWProtocolWebSocket.Response(status: .accept, subprotocol: nil, additionalHeaders: nil)
        }
        let params = NWParameters.tcp
        params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        params.allowLocalEndpointReuse = true
        let l = try NWListener(using: params)
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { s in log("listener \(s)") }
        l.start(queue: q)
        listener = l
        q.asyncAfter(deadline: .now() + 5) { [weak self] in self?.tick() }
    }

    private func accept(_ c: NWConnection) {
        let id = ObjectIdentifier(c)
        clients[id] = c
        c.stateUpdateHandler = { [weak self] s in
            switch s {
            case .failed, .cancelled: self?.drop(c)
            default: break
            }
        }
        c.start(queue: q)
        send(hello(), to: c)
        send(caps(), to: c)
        send(status(), to: c)
        receive(c)
        log("client + (\(clients.count))")
    }

    private func drop(_ c: NWConnection) {
        let id = ObjectIdentifier(c)
        guard clients.removeValue(forKey: id) != nil else { return }
        wants.remove(id)
        c.cancel()
        if wants.isEmpty { stopMotion() }
        log("client - (\(clients.count))")
    }

    private func receive(_ c: NWConnection) {
        c.receiveMessage { [weak self] data, ctx, _, err in
            guard let self else { return }
            if err != nil { self.drop(c); return }
            if let meta = ctx?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata {
                if meta.opcode == .close { self.drop(c); return }
                if meta.opcode == .text, let data,
                    let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let cmd = obj["cmd"] as? String
                {
                    self.handle(cmd, from: c)
                }
            }
            self.receive(c)
        }
    }

    private func handle(_ cmd: String, from c: NWConnection) {
        let id = ObjectIdentifier(c)
        switch cmd {
        case "start":
            wants.insert(id)
            startMotion()
            send(caps(), to: c)
            send(status(), to: c)
        case "stop":
            wants.remove(id)
            if wants.isEmpty { stopMotion() }
        case "hello":
            send(hello(), to: c)
            send(caps(), to: c)
            send(status(), to: c)
        default:
            break  // "heart": the Mac has no AirPods heart rate; the page keeps the camera's
        }
    }

    // MARK: AirPods head motion

    private func startMotion() {
        guard headphones.isDeviceMotionAvailable else {
            lastError = "no head motion on this Mac"
            return
        }
        guard !headphones.isDeviceMotionActive else { return }
        lastError = ""
        log("motion start, permission \(CMHeadphoneMotionManager.authorizationStatus().rawValue)")
        headphones.startDeviceMotionUpdates(to: motionQueue) { [weak self] motion, error in
            guard let self else { return }
            if let error {
                let text = error.localizedDescription
                self.q.async {
                    if self.lastError != text {
                        self.lastError = text
                        log("motion error \(text)")
                        self.send(self.status())
                    }
                }
                return
            }
            guard let m = motion else { return }
            let now = Date().timeIntervalSince1970 * 1000
            var age = (ProcessInfo.processInfo.systemUptime - m.timestamp) * 1000
            if age < 0 || age > 300 { age = 0 }
            let deg = 180 / Double.pi
            let sample: [Double] = [
                (now - age).rounded(),
                m.attitude.pitch * deg, m.attitude.yaw * deg, m.attitude.roll * deg,
                m.userAcceleration.x, m.userAcceleration.y, m.userAcceleration.z,
                m.rotationRate.x * deg, m.rotationRate.y * deg, m.rotationRate.z * deg,
            ].map { ($0 * 1000).rounded() / 1000 }
            self.q.async {
                self.count += 1
                self.buffer.append(sample)
                if !self.connected {
                    self.connected = true
                    self.send(self.caps())
                    self.send(self.status())
                }
                if self.buffer.count >= 3 {
                    let batch = self.buffer
                    self.buffer.removeAll(keepingCapacity: true)
                    self.send(["k": "head", "s": batch])
                }
            }
        }
    }

    private func stopMotion() {
        if headphones.isDeviceMotionActive {
            headphones.stopDeviceMotionUpdates()
            log("motion stop")
        }
    }

    func headphoneMotionManagerDidConnect(_ manager: CMHeadphoneMotionManager) {
        q.async {
            self.connected = true
            self.send(self.caps())
            self.send(self.status())
            log("airpods connected")
        }
    }

    func headphoneMotionManagerDidDisconnect(_ manager: CMHeadphoneMotionManager) {
        q.async {
            self.connected = false
            self.send(self.caps())
            self.send(self.status())
            log("airpods disconnected")
        }
    }

    private func tick() {
        let dt = Date().timeIntervalSince(countAt)
        if count > 0 { log(String(format: "%.1f samples a second, %d clients", Double(count) / dt, clients.count)) }
        count = 0
        countAt = Date()
        q.asyncAfter(deadline: .now() + 10) { [weak self] in self?.tick() }
    }

    // MARK: to the page

    private func permission() -> String {
        switch CMHeadphoneMotionManager.authorizationStatus() {
        case .authorized: return "allowed"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default: return "not asked"
        }
    }

    private func hello() -> [String: Any] {
        ["k": "hello", "shell": "mac", "v": 1, "available": headphones.isDeviceMotionAvailable, "permission": permission()]
    }

    private func caps() -> [String: Any] {
        ["k": "caps", "airpodsMotion": connected, "airpodsHr": false]
    }

    private func status() -> [String: Any] {
        var s: [String: Any] = ["k": "status", "airpods": connected ? "connected" : "disconnected", "hr": "off", "permission": permission()]
        if !lastError.isEmpty { s["error"] = lastError }
        return s
    }

    private func send(_ object: [String: Any], to one: NWConnection? = nil) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let ctx = NWConnection.ContentContext(identifier: "text", metadata: [meta])
        let to = one.map { [$0] } ?? Array(clients.values)
        for c in to { c.send(content: data, contentContext: ctx, isComplete: true, completion: .idempotent) }
    }
}

let ears = Ears()
do {
    try ears.run()
    log("Vire Ears up on 127.0.0.1:\(port)")
} catch {
    log("could not listen: \(error)")
    exit(1)
}
dispatchMain()
