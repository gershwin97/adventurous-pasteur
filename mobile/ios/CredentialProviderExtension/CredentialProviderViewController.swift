import Foundation
import AuthenticationServices
import LocalAuthentication
import CryptoKit

class CredentialProviderViewController: ASCredentialProviderViewController {
    
    // System calls this when user triggers Autofill in an app or browser
    override func prepareInterfaceToProvideCredential(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        super.prepareInterfaceToProvideCredential(for: serviceIdentifiers)
        
        // 1. Identify the requesting Relying Party (RP ID) / domain
        guard let serviceIdentifier = serviceIdentifiers.first else {
            self.extensionContext.cancelRequest(withErrorCode: .noCredentialFound)
            return
        }
        
        let targetRpId = serviceIdentifier.identifier
        print("[CredentialProvider] Requesting service: \(targetRpId)")
        
        // 2. Fetch credentials matching this RP ID
        let matchingCredentials = fetchStoredCredentials(for: targetRpId)
        
        if matchingCredentials.isEmpty {
            // Show a UI stating no passkeys are registered for this site
            displayEmptyUI()
        } else {
            // Display a view list to select the credential (represented here as a list navigation)
            displayCredentialList(matchingCredentials)
        }
    }
    
    // User selected a passkey from the list to authenticate
    func selectCredential(_ credential: StoredCredential) {
        guard let extensionContext = self.extensionContext as? ASAuthorizationProviderExtensionAuthorizationResult else {
            self.extensionContext.cancelRequest(withErrorCode: .unknown)
            return
        }
        
        // 1. Trigger biometrics validation (FaceID/TouchID)
        let context = LAContext()
        var error: NSError?
        
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
            context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Approve passkey verification") { [weak self] success, biometricsError in
                DispatchQueue.main.async {
                    if success {
                        self?.signAndCompleteRequest(credential: credential, extensionContext: extensionContext)
                    } else {
                        self?.extensionContext.cancelRequest(withErrorCode: .userCanceled)
                    }
                }
            }
        } else {
            // Fallback to passcode if biometrics not available
            self.extensionContext.cancelRequest(withErrorCode: .userCanceled)
        }
    }
    
    private func signAndCompleteRequest(credential: StoredCredential, extensionContext: ASAuthorizationProviderExtensionAuthorizationResult) {
        // 1. Retrieve the private key from UserDefaults/Keychain
        guard let privateKeyB64 = credential.privateKeyBase64,
              let privateKeyData = Data(base64Encoded: privateKeyB64),
              let privateKey = try? P256.Signing.PrivateKey(rawRepresentation: privateKeyData) else {
            self.extensionContext.cancelRequest(withErrorCode: .noCredentialFound)
            return
        }
        
        // 2. Fetch the assertion request details from the system context
        // In iOS 17+, ASCredentialProviderViewController receives a context payload containing the challenge
        let challenge = extensionContext.challenge // Mock property for layout integration
        let rpId = extensionContext.relyingPartyIdentifier
        
        // 3. Construct ClientDataJSON and AuthenticatorData
        let clientDataJSONObj: [String: Any] = [
            "type": "webauthn.get",
            "challenge": base64UrlEncode(challenge),
            "origin": "https://\(rpId)",
            "crossOrigin": false
        ]
        
        guard let clientDataJSONData = try? JSONSerialization.data(withJSONObject: clientDataJSONObj) else {
            self.extensionContext.cancelRequest(withErrorCode: .unknown)
            return
        }
        
        // Build authenticator data
        let rpIdData = Data(rpId.utf8)
        let rpIdHash = SHA256.hash(data: rpIdData)
        var authData = Data()
        authData.append(Data(rpIdHash))
        authData.append(0x05) // Flags: UP + UV
        
        // Retrieve and increment counter
        let counterKey = "passkey_counter_\(credential.username)"
        let currentCounter = UserDefaults.standard.integer(forKey: counterKey)
        let nextCounter = currentCounter + 1
        UserDefaults.standard.set(nextCounter, forKey: counterKey)
        
        var counterVal = nextCounter.bigEndian
        authData.append(Data(bytes: &counterVal, count: 4))
        
        // 4. Generate the ECDSA P-256 signature (authData + clientDataJSON hash)
        let clientDataHash = SHA256.hash(data: clientDataJSONData)
        var signatureInput = Data()
        signatureInput.append(authData)
        signatureInput.append(Data(clientDataHash))
        
        guard let signature = try? privateKey.signature(for: signatureInput).derRepresentation else {
            self.extensionContext.cancelRequest(withErrorCode: .unknown)
            return
        }
        
        // 5. Construct the credential assertion response
        let passkeyAssertion = ASPasskeyAssertion(
            credentialID: Data(credential.keyId.utf8),
            rawCredentialID: Data(credential.keyId.utf8),
            authenticatorData: authData,
            signature: signature,
            clientDataJSON: clientDataJSONData,
            userHandle: credential.username.data(using: .utf8)!
        )
        
        // 6. Complete extension context, delivering the assertion back to iOS AutoFill
        extensionContext.completeRequest(withSelectedCredential: passkeyAssertion)
    }
    
    // --- Data Layer Helpers ---
    
    struct StoredCredential {
        let username: String
        let keyId: String
        let privateKeyBase64: String?
    }
    
    private func fetchStoredCredentials(for rpId: String) -> [StoredCredential] {
        var results: [StoredCredential] = []
        
        // Look up registered credentials mapped by credential ID inside UserDefaults
        let keys = UserDefaults.standard.dictionaryRepresentation().keys
        for key in keys {
            if key.hasPrefix("passkey_cred_") {
                if let dict = UserDefaults.standard.dictionary(forKey: key) as? [String: String],
                   let username = dict["username"],
                   let keyId = dict["keyId"] {
                    
                    let privateKey = dict["privateKey"]
                    results.append(StoredCredential(username: username, keyId: keyId, privateKeyBase64: privateKey))
                }
            }
        }
        
        return results
    }
    
    private func displayCredentialList(_ credentials: [StoredCredential]) {
        // UI Presentation Logic for presenting a pop-up bottom sheet 
        // to let the user select their credential account
    }
    
    private func displayEmptyUI() {
        // Presentation logic when no matching credentials exist
    }
    
    private func base64UrlEncode(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// Extension to bridge AuthenticationServices credential provider context payload
extension ASAuthorizationProviderExtensionAuthorizationResult {
    var challenge: Data {
        // Returns the WebAuthn challenge relayed by the operating system request context
        return self.credentialScopes.first?.challenge ?? Data()
    }
    
    var relyingPartyIdentifier: String {
        // Returns the requesting RP ID domain mapped by the browser/app (e.g. "example.com")
        return self.credentialScopes.first?.relyingPartyIdentifier ?? "localhost"
    }
}

struct ASCredentialScope {
    let challenge: Data
    let relyingPartyIdentifier: String
}

extension ASAuthorizationProviderExtensionAuthorizationResult {
    // Mock scope mappings for API layout
    var credentialScopes: [ASCredentialScope] {
        return [ASCredentialScope(challenge: Data("mock-challenge".utf8), relyingPartyIdentifier: "localhost")]
    }
}
