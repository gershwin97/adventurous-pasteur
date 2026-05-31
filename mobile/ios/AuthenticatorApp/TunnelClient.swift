import Foundation

protocol TunnelClientDelegate: AnyObject {
    func tunnelClientDidConnect()
    func tunnelClientDidDisconnect()
    func tunnelClientDidReceiveMessage(text: String)
    func tunnelClientDidEncounterError(error: Error)
}

class TunnelClient: NSObject {
    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    
    weak var delegate: TunnelClientDelegate?
    private var isConnected = false

    func connect(url: URL, deviceType: String = "ios") {
        disconnect()

        // Append device-type parameters to let server recognize simulation states
        var urlComponents = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let deviceParam = URLQueryItem(name: "device-type", value: deviceType)
        let roleParam = URLQueryItem(name: "role", value: "mobile")
        if urlComponents?.queryItems != nil {
            urlComponents?.queryItems?.append(deviceParam)
            urlComponents?.queryItems?.append(roleParam)
        } else {
            urlComponents?.queryItems = [deviceParam, roleParam]
        }

        guard let requestUrl = urlComponents?.url else { return }

        print("[Tunnel] Connecting to signaling WebSocket: \(requestUrl)")
        urlSession = URLSession(configuration: .default, delegate: nil, delegateQueue: OperationQueue.main)
        webSocketTask = urlSession?.webSocketTask(with: requestUrl)
        webSocketTask?.resume()
        
        listenForMessages()
        ping()
    }

    func disconnect() {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        urlSession = nil
        isConnected = false
    }

    func sendMessage(text: String) {
        guard let task = webSocketTask else { return }
        let message = URLSessionWebSocketTask.Message.string(text)
        task.send(message) { error in
            if let error = error {
                print("[Tunnel] Message delivery failed: \(error)")
                self.delegate?.tunnelClientDidEncounterError(error: error)
            }
        }
    }

    private func listenForMessages() {
        guard let task = webSocketTask else { return }
        task.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    DispatchQueue.main.async {
                        // Check if it is a heartbeat ping/peer status
                        if !self.isConnected {
                            self.isConnected = true
                            self.delegate?.tunnelClientDidConnect()
                        }
                        self.delegate?.tunnelClientDidReceiveMessage(text: text)
                    }
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            self.delegate?.tunnelClientDidReceiveMessage(text: text)
                        }
                    }
                @unknown default:
                    break
                }
                self.listenForMessages() // Keep listening recursively
            case .failure(let error):
                print("[Tunnel] Receive failure: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.delegate?.tunnelClientDidDisconnect()
                    self.delegate?.tunnelClientDidEncounterError(error: error)
                }
            }
        }
    }

    private func ping() {
        guard let task = webSocketTask else { return }
        task.sendPing { [weak self] error in
            if let error = error {
                print("[Tunnel] Ping failed: \(error)")
            } else {
                // Repeat ping every 30 seconds
                DispatchQueue.main.asyncAfter(deadline: .now() + 30.0) {
                    self?.ping()
                }
            }
        }
    }
}
