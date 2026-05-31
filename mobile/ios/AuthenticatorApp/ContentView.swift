import SwiftUI
import LocalAuthentication
import CryptoKit

struct ContentView: View {
    // UI Navigation State
    enum Screen {
        case connect, processing, approve, success
    }
    
    @State private var currentScreen: Screen = .connect
    @State private var isShowingScanner = false
    @State private var manualToken = ""
    @State private var errorMessage = ""
    
    // FIDO Session State
    @State private var username = "alice"
    @State private var sessionId = ""
    @State private var psk = ""
    @State private var hostIp = ""
    @State private var port = ""
    @State private var ceremonyType = "login"
    
    // Decrypted FIDO options
    @State private var fidoChallenge = ""
    @State private var fidoRpId = "localhost"
    
    // Log feed for debugging
    @State private var logs: [String] = []

    // Helper classes
    private let tunnelClient = TunnelClient()
    private let cryptoManager = CryptoManager.shared
    private let bleAdvertiser = BLEAdvertiser.shared
    private let coordinator = TunnelCoordinator()

    var body: some View {
        ZStack {
            // Dark elegant background
            Color(red: 13/255, green: 15/255, blue: 20/255)
                .ignoresSafeArea()
            
            VStack {
                switch currentScreen {
                case .connect:
                    connectView
                case .processing:
                    processingView
                case .approve:
                    approveView
                case .success:
                    successView
                }
                
                Spacer()
                
                // Real-time Visual Log Feed
                logConsoleView
            }
            .padding()
        }
        .onAppear {
            coordinator.onConnect = {
                self.tunnelClientDidConnect()
            }
            coordinator.onDisconnect = {
                self.tunnelClientDidDisconnect()
            }
            coordinator.onMessage = { text in
                self.tunnelClientDidReceiveMessage(text: text)
            }
            coordinator.onError = { error in
                self.tunnelClientDidEncounterError(error: error)
            }
            tunnelClient.delegate = coordinator
            log("Authenticator app initialized. Ready.", type: "[System]")
        }
        .sheet(isPresented: $isShowingScanner) {
            QRScannerView(onScanResult: { scannedCode in
                isShowingScanner = false
                parseAndConnect(scannedCode)
            }, onCancel: {
                isShowingScanner = false
            })
        }
    }

    // --- Sub-Views ---

    private var connectView: some View {
        VStack(spacing: 24) {
            Spacer().frame(height: 32)
            
            // Logo
            VStack(spacing: 8) {
                Text("🔑")
                    .font(.system(size: 64))
                Text("Passkey Mobile")
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                Text("FIDO / CTAP2.1 Roaming Authenticator")
                    .font(.subheadline)
                    .foregroundColor(.gray)
            }
            
            // Token manual input
            VStack(alignment: .leading, spacing: 8) {
                Text("CONNECT TO SESSION")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.gray)
                
                TextEditor(text: $manualToken)
                    .font(.system(.body, design: .monospaced))
                    .frame(height: 72)
                    .padding(8)
                    .background(Color.white.opacity(0.04))
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), lineWidth: 1))
            }
            .padding()
            .background(Color.white.opacity(0.02))
            .cornerRadius(16)
            
            Button(action: {
                guard !manualToken.isEmpty else {
                    errorMessage = "Please enter session token."
                    return
                }
                parseAndConnect(manualToken)
            }) {
                Text("Connect via Token")
                    .fontWeight(.bold)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.green)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            
            Text("OR")
                .font(.caption)
                .foregroundColor(.gray)
                .fontWeight(.bold)
            
            Button(action: {
                isShowingScanner = true
            }) {
                Text("Scan QR Code via Camera")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.white.opacity(0.05))
                    .foregroundColor(.white)
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), lineWidth: 1))
            }
            
            if !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundColor(.red)
            }
        }
    }

    private var processingView: some View {
        VStack(spacing: 32) {
            Spacer().frame(height: 64)
            
            ProgressView()
                .scaleEffect(1.5)
                .progressViewStyle(CircularProgressViewStyle(tint: .green))
            
            VStack(spacing: 8) {
                Text("Connecting to Browser...")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                Text("Performing BLE proximity scanning...")
                    .font(.subheadline)
                    .foregroundColor(.gray)
            }
        }
    }

    private var approveView: some View {
        VStack(spacing: 24) {
            Spacer().frame(height: 32)
            
            Text("🛡️")
                .font(.system(size: 64))
            
            VStack(spacing: 8) {
                Text("Approve Login?")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                Text("A computer is requesting access to your registered credentials")
                    .font(.subheadline)
                    .foregroundColor(.gray)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            
            // Relayed Metadata Details Card
            VStack(spacing: 12) {
                HStack {
                    Text("User Account:")
                        .foregroundColor(.gray)
                    Spacer()
                    Text(username)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                }
                Divider().background(Color.white.opacity(0.08))
                HStack {
                    Text("Request Origin:")
                        .foregroundColor(.gray)
                    Spacer()
                    Text(fidoRpId)
                        .fontWeight(.semibold)
                        .foregroundColor(.green)
                }
                Divider().background(Color.white.opacity(0.08))
                HStack {
                    Text("Browser OS:")
                        .foregroundColor(.gray)
                    Spacer()
                    Text("macOS (Safari)")
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                }
                Divider().background(Color.white.opacity(0.08))
                HStack {
                    Text("Host IP:")
                        .foregroundColor(.gray)
                    Spacer()
                    Text(hostIp)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                }
            }
            .padding()
            .background(Color.white.opacity(0.02))
            .cornerRadius(16)
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.08), lineWidth: 1))
            
            HStack(spacing: 12) {
                Button(action: {
                    log("Auth request denied by user.", type: "[Auth]")
                    sendPayloadOverTunnel(event: "relay", text: "{\"error\":\"Authentication denied by user\"}")
                    reset()
                }) {
                    Text("Deny Request")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.white.opacity(0.05))
                        .foregroundColor(.white)
                        .cornerRadius(12)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), lineWidth: 1))
                }
                
                Button(action: triggerFaceIDAuthentication) {
                    Text("Approve FaceID")
                        .fontWeight(.bold)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }
            }
        }
    }

    private var successView: some View {
        VStack(spacing: 24) {
            Spacer().frame(height: 64)
            
            ZStack {
                Circle()
                    .fill(Color.green)
                    .frame(width: 80, height: 80)
                Text("✓")
                    .font(.system(size: 40, weight: .bold))
                    .foregroundColor(.white)
            }
            
            VStack(spacing: 8) {
                Text("Authentication Complete")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                Text("The browser is now logged in. You can close this screen.")
                    .font(.subheadline)
                    .foregroundColor(.gray)
            }
            
            Button(action: reset) {
                Text("Done")
                    .fontWeight(.semibold)
                    .frame(width: 120)
                    .padding()
                    .background(Color.white.opacity(0.05))
                    .foregroundColor(.white)
                    .cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), lineWidth: 1))
            }
        }
    }

    private var logConsoleView: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Console Log Feed")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.gray)
                Spacer()
                Circle()
                    .fill(Color.green)
                    .frame(width: 6, height: 6)
            }
            
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(logs.reversed(), id: \.self) { logLine in
                        Text(logLine)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(.white.opacity(0.8))
                    }
                }
            }
            .frame(height: 100)
        }
        .padding()
        .background(Color.black.opacity(0.4))
        .cornerRadius(12)
    }

    // --- Parser & WS Initiator ---

    private func parseAndConnect(_ data: String) {
        let trimmedData = data.trimmingCharacters(in: .whitespacesAndNewlines)
        
        if trimmedData.hasPrefix("{") {
            // Format 1: Raw JSON string from QR Code
            guard let dataObj = trimmedData.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: dataObj) as? [String: String] else {
                errorMessage = "Failed to parse JSON session token."
                return
            }
            
            sessionId = json["sessionId"] ?? ""
            psk = json["psk"] ?? ""
            ceremonyType = json["type"] ?? "login"
            username = json["username"] ?? "alice"
            
            guard let tunnelStr = json["tunnelUrl"],
                  let url = URL(string: tunnelStr) else {
                errorMessage = "Invalid websocket URL."
                return
            }
            
            hostIp = url.host ?? "localhost"
            port = url.port != nil ? String(url.port!) : "3000"
            
            errorMessage = ""
            
            // Establish WebSocket client
            currentScreen = .processing
            #if targetEnvironment(simulator)
            tunnelClient.connect(url: url, deviceType: "simulator")
            #else
            tunnelClient.connect(url: url, deviceType: "ios")
            #endif
        } else {
            // Format 2: Colon-separated Bypass Token (SessionID:PSK:HostIP:Port)
            let parts = trimmedData.components(separatedBy: ":")
            guard parts.count >= 4 else {
                errorMessage = "Invalid token format. Expected JSON or SessionID:PSK:HostIP:Port."
                return
            }
            
            sessionId = parts[0]
            psk = parts[1]
            hostIp = parts[2]
            port = parts[3]
            
            // Default ceremony properties for fallback
            ceremonyType = "login"
            username = "alice"
            
            let tunnelUrlStr = "ws://\(hostIp):\(port)/tunnel/\(sessionId)"
            guard let url = URL(string: tunnelUrlStr) else {
                errorMessage = "Failed to build websocket URL."
                return
            }
            
            errorMessage = ""
            
            // Establish WebSocket client
            currentScreen = .processing
            #if targetEnvironment(simulator)
            tunnelClient.connect(url: url, deviceType: "simulator")
            #else
            tunnelClient.connect(url: url, deviceType: "ios")
            #endif
        }
    }

    // --- Tunnel Client Delegate ---

    func tunnelClientDidConnect() {
        log("WebSocket connected. Starting BLE Advertising...", type: "[Tunnel]")
        
        // Calculate SHA-256 session token hash to advertise over BLE
        let tokenHashInput = sessionId + psk
        let tokenHashData = Data(tokenHashInput.utf8)
        let hash = SHA256.hash(data: tokenHashData)
        let hashHex = hash.map { String(format: "%02hhx", $0) }.joined()
        
        // Start physical BLE Advertiser
        #if !targetEnvironment(simulator)
        bleAdvertiser.startAdvertising(tokenHashHex: hashHex)
        #else
        log("BLE Advertiser bypassed (Simulator Build).", type: "[BLE]")
        #endif
    }

    func tunnelClientDidDisconnect() {
        log("WebSocket disconnected.", type: "[Tunnel]")
        bleAdvertiser.stopAdvertising()
        currentScreen = .connect
    }

    func tunnelClientDidReceiveMessage(text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        
        // Check for relayed errors from the browser portal
        if let errMsg = json["error"] as? String {
            log("Error: \(errMsg)", type: "[Error]")
            errorMessage = errMsg
            currentScreen = .connect
            return
        }
        
        // Check for proximity-verified event
        if let event = json["event"] as? String, event == "proximity-verified" {
            log("BLE proximity verified by browser. Tunnel unlocked.", type: "[Proximity]")
        }

        // Check for encrypted WebAuthn options
        if json["ciphertext"] != nil,
           let iv = json["iv"] as? String,
           let tag = json["tag"] as? String,
           let ciphertext = json["ciphertext"] as? String {
            
            log("Received encrypted WebAuthn payload. Decrypting...", type: "[Crypto]")
            let payload = CryptoManager.EncryptedPayload(iv: iv, tag: tag, ciphertext: ciphertext)
            
            if let decrypted = cryptoManager.decrypt(payload: payload, pskHex: psk),
               let decData = decrypted.data(using: .utf8),
               let options = try? JSONSerialization.jsonObject(with: decData) as? [String: Any] {
                
                log("Decryption successful. Loading options.", type: "[Crypto]")
                fidoChallenge = options["challenge"] as? String ?? ""
                fidoRpId = options["rpId"] as? String ?? (options["rp"] as? [String: Any])?["id"] as? String ?? "localhost"
                
                // Dynamically detect ceremony type
                if options["user"] != nil && options["rp"] != nil {
                    ceremonyType = "registration"
                    if let userObj = options["user"] as? [String: Any],
                       let userNameStr = userObj["name"] as? String {
                        username = userNameStr
                    }
                } else {
                    ceremonyType = "login"
                }
                
                currentScreen = .approve
            } else {
                log("Decryption failed. Invalid PSK.", type: "[Crypto]")
            }
        }
    }

    func tunnelClientDidEncounterError(error: Error) {
        log("Error: \(error.localizedDescription)", type: "[Error]")
    }

    // --- FaceID Authorization Mock ---

    private func triggerFaceIDAuthentication() {
        let context = LAContext()
        var error: NSError?
        
        log("Triggering LocalAuthentication FaceID prompt...", type: "[Bio]")
        
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
            context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Confirm passkey signature") { success, authenticationError in
                DispatchQueue.main.async {
                    if success {
                        self.log("FaceID authorized.", type: "[Bio]")
                        self.executeSignatureAndRespond()
                    } else {
                        self.log("FaceID verification failed.", type: "[Bio]")
                    }
                }
            }
        } else {
            // Fallback for Simulator without FaceID enrolled
            log("Biometric hardware absent (Simulator). Simulating FaceID delay...", type: "[Bio]")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                self.log("Simulated FaceID authorized.", type: "[Bio]")
                self.executeSignatureAndRespond()
            }
        }
    }

    private func executeSignatureAndRespond() {
        log("Signing challenge using Private Key...", type: "[Crypto]")
        
        var keyIdHex = ""
        if ceremonyType == "registration" {
            // Generate a fresh key pair for registration
            if let keys = cryptoManager.generateKeyPair(username: username) {
                keyIdHex = String(keys.publicKeyHex.prefix(16)).lowercased()
            } else {
                keyIdHex = "mock-keyid-hex"
            }
        } else {
            // Load existing public key to derive the credential ID (keyIdHex)
            if let publicKeyData = UserDefaults.standard.data(forKey: "passkey_public") {
                let publicKeyHex = publicKeyData.map { String(format: "%02hhx", $0) }.joined()
                keyIdHex = String(publicKeyHex.prefix(16)).lowercased()
            } else {
                // Fallback if no key exists
                keyIdHex = "mock-keyid-hex"
            }
        }
        
        let keyId = Data(keyIdHex.utf8)
        let keyIdB64Url = base64UrlEncode(keyId)

        // Mock WebAuthn assertion signature
        let clientDataJSONObj: [String: Any] = [
            "type": ceremonyType == "registration" ? "webauthn.create" : "webauthn.get",
            "challenge": fidoChallenge,
            "origin": "http://\(hostIp):\(port)",
            "crossOrigin": false
        ]
        
        guard let clientDataJSONData = try? JSONSerialization.data(withJSONObject: clientDataJSONObj),
              let clientDataJSONStr = String(data: clientDataJSONData, encoding: .utf8) else {
            return
        }
        let clientDataJSONB64Url = base64UrlEncode(clientDataJSONData)
        
        var responseObj: [String: Any] = [:]
        
        if ceremonyType == "registration" {
            // Construct mock registration response
            // SimpleWebAuthn requires credentialID and public key bytes inside attestationObject
            let mockCoords = cryptoManager.getPublicKeyCoordinates(username: username) ?? (x: Data(repeating: 0, count: 32), y: Data(repeating: 0, count: 32))
            let cosePublicKey = serializeToCose(x: mockCoords.x, y: mockCoords.y)
            let authData = buildAuthData(rpID: fidoRpId, keyId: Data(keyIdHex.utf8), coseKey: cosePublicKey)
            let attestationObj = buildAttestationObject(authData: authData)
            
            responseObj = [
                "id": keyIdB64Url,
                "rawId": keyIdB64Url,
                "type": "public-key",
                "response": [
                    "clientDataJSON": clientDataJSONB64Url,
                    "attestationObject": attestationObj,
                    "transports": ["hybrid"]
                ]
            ]
        } else {
            // Construct mock assertion response
            let authData = buildAuthDataForAssertion(rpID: fidoRpId)
            
            // Build signature input = authData + SHA-256(clientDataJSON)
            let clientDataHash = SHA256.hash(data: clientDataJSONData)
            var signatureInput = Data()
            signatureInput.append(authData)
            signatureInput.append(Data(clientDataHash))
            
            let signature = cryptoManager.sign(challengeData: signatureInput, username: username) ?? Data(repeating: 0, count: 64)
            
            responseObj = [
                "id": keyIdB64Url,
                "rawId": keyIdB64Url,
                "type": "public-key",
                "response": [
                    "clientDataJSON": clientDataJSONB64Url,
                    "authenticatorData": base64UrlEncode(authData),
                    "signature": base64UrlEncode(signature),
                    "userHandle": base64UrlEncode(username.data(using: .utf8)!)
                ]
            ]
        }
        
        guard let finalResponseData = try? JSONSerialization.data(withJSONObject: responseObj),
              let finalResponseStr = String(data: finalResponseData, encoding: .utf8) else {
            return
        }
        
        // Encrypt final payload
        if let encryptedPayload = cryptoManager.encrypt(plaintext: finalResponseStr, pskHex: psk),
           let payloadData = try? JSONEncoder().encode(encryptedPayload),
           let payloadStr = String(data: payloadData, encoding: .utf8) {
            
            log("Sending encrypted signature response to browser...", type: "[Tunnel]")
            tunnelClient.sendMessage(text: payloadStr)
            
            currentScreen = .success
        }
    }

    // --- Cryptographic and CBOR formatting utilities ---

    private func serializeToCose(x: Data, y: Data) -> Data {
        var cose = Data()
        cose.append(0xa5) // map of 5 items
        
        cose.append(contentsOf: [0x01, 0x02]) // 1 (kty) -> 2 (EC2)
        cose.append(contentsOf: [0x03, 0x26]) // 3 (alg) -> -7 (ES256)
        cose.append(contentsOf: [0x20, 0x01]) // -1 (crv) -> 1 (P-256)
        
        cose.append(0x21) // -2 (X)
        cose.append(0x58) // byte string
        cose.append(0x20) // 32 bytes length
        cose.append(x)
        
        cose.append(0x22) // -3 (Y)
        cose.append(0x58) // byte string
        cose.append(0x20) // 32 bytes length
        cose.append(y)
        
        return cose
    }

    private func buildAuthData(rpID: String, keyId: Data, coseKey: Data) -> Data {
        var authData = Data()
        
        // rpIdHash
        let rpIdData = Data(rpID.utf8)
        let hash = SHA256.hash(data: rpIdData)
        authData.append(Data(hash))
        
        // flags
        authData.append(0x45) // UP + UV + AT
        
        // counter
        authData.append(contentsOf: [0, 0, 0, 1])
        
        // aaguid (16 bytes zeros)
        authData.append(Data(repeating: 0, count: 16))
        
        // credIdLen (2 bytes)
        var count = UInt16(keyId.count).bigEndian
        authData.append(Data(bytes: &count, count: 2))
        
        // credId
        authData.append(keyId)
        
        // public key
        authData.append(coseKey)
        
        return authData
    }

    private func buildAttestationObject(authData: Data) -> String {
        var attObj = Data()
        attObj.append(0xa3) // map of 3 items
        
        // "fmt" -> "none"
        attObj.append(0x63)
        attObj.append(Data("fmt".utf8))
        attObj.append(0x64)
        attObj.append(Data("none".utf8))
        
        // "attStmt" -> {}
        attObj.append(0x67)
        attObj.append(Data("attStmt".utf8))
        attObj.append(0xa0)
        
        // "authData" -> authData bytes
        attObj.append(0x68)
        attObj.append(Data("authData".utf8))
        
        let len = authData.count
        if len < 24 {
            attObj.append(UInt8(0x40 + len))
        } else if len < 256 {
            attObj.append(contentsOf: [0x58, UInt8(len)])
        } else {
            attObj.append(0x59)
            var bigLen = UInt16(len).bigEndian
            attObj.append(Data(bytes: &bigLen, count: 2))
        }
        
        attObj.append(authData)
        return base64UrlEncode(attObj)
    }

    private func buildAuthDataForAssertion(rpID: String) -> Data {
        var authData = Data()
        let rpIdData = Data(rpID.utf8)
        let hash = SHA256.hash(data: rpIdData)
        authData.append(Data(hash))
        authData.append(0x05) // UP + UV
        authData.append(contentsOf: [0, 0, 0, 2]) // counter 2
        return authData
    }

    // --- Base64url and Log helpers ---

    private func base64UrlEncode(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func sendPayloadOverTunnel(event: String, text: String) {
        if let enc = cryptoManager.encrypt(plaintext: text, pskHex: psk),
           let json = try? JSONEncoder().encode(enc),
           let jsonStr = String(data: json, encoding: .utf8) {
            tunnelClient.sendMessage(text: jsonStr)
        }
    }

    private func reset() {
        tunnelClient.disconnect()
        bleAdvertiser.stopAdvertising()
        sessionId = ""
        psk = ""
        manualToken = ""
        errorMessage = ""
        currentScreen = .connect
    }

    private func log(_ message: String, type: String = "[System]") {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        logs.append("[\(timestamp)] \(type) \(message)")
    }
}

class TunnelCoordinator: TunnelClientDelegate {
    var onConnect: (() -> Void)?
    var onDisconnect: (() -> Void)?
    var onMessage: ((String) -> Void)?
    var onError: ((Error) -> Void)?
    
    func tunnelClientDidConnect() {
        onConnect?()
    }
    
    func tunnelClientDidDisconnect() {
        onDisconnect?()
    }
    
    func tunnelClientDidReceiveMessage(text: String) {
        onMessage?(text)
    }
    
    func tunnelClientDidEncounterError(error: Error) {
        onError?(error)
    }
}
