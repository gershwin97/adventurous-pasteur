import Foundation
import CryptoKit

class CryptoManager {
    static let shared = CryptoManager()
    private init() {}

    // Structure for encrypted payloads
    struct EncryptedPayload: Codable {
        let iv: String
        let tag: String
        let ciphertext: String
    }

    // Generate a new P-256 private key and store it securely in the user defaults / keychain
    func generateKeyPair(username: String) -> (privateKeyHex: String, publicKeyHex: String)? {
        let privateKey = P256.Signing.PrivateKey()
        let publicKey = privateKey.publicKey
        
        let privateKeyData = privateKey.rawRepresentation
        let publicKeyData = publicKey.rawRepresentation
        
        // Save raw key data in UserDefaults (in production, use iOS Keychain)
        UserDefaults.standard.set(privateKeyData, forKey: "passkey_private")
        UserDefaults.standard.set(publicKeyData, forKey: "passkey_public")
        UserDefaults.standard.set(username, forKey: "passkey_username")
        
        return (privateKeyData.map { String(format: "%02hhx", $0) }.joined(),
                publicKeyData.map { String(format: "%02hhx", $0) }.joined())
    }

    // Retrieve the public key coordinates for COSE mapping
    func getPublicKeyCoordinates(username: String) -> (x: Data, y: Data)? {
        guard let publicKeyData = UserDefaults.standard.data(forKey: "passkey_public"),
              let publicKey = try? P256.Signing.PublicKey(rawRepresentation: publicKeyData) else {
            return nil
        }
        let x963Representation = publicKey.x963Representation
        // First byte is format indicator (0x04 for uncompressed), next 32 are X, last 32 are Y
        guard x963Representation.count == 65 else { return nil }
        let x = x963Representation.subdata(in: 1..<33)
        let y = x963Representation.subdata(in: 33..<65)
        return (x, y)
    }

    // Sign challenge data using standard ECDSA P-256 SHA-256
    func sign(challengeData: Data, username: String) -> Data? {
        guard let privateKeyData = UserDefaults.standard.data(forKey: "passkey_private"),
              let privateKey = try? P256.Signing.PrivateKey(rawRepresentation: privateKeyData) else {
            return nil
        }
        do {
            let signature = try privateKey.signature(for: challengeData)
            return signature.derRepresentation // Return standard DER representation
        } catch {
            print("[Crypto] Signature generation failed: \(error)")
            return nil
        }
    }

    // Encrypt payload string using AES-256-GCM with the PSK
    func encrypt(plaintext: String, pskHex: String) -> EncryptedPayload? {
        guard let pskData = hexToData(hex: pskHex),
              let plaintextData = plaintext.data(using: .utf8) else {
            return nil
        }
        do {
            let key = SymmetricKey(data: pskData)
            let nonce = AES.GCM.Nonce() // 12-byte random IV
            let sealedBox = try AES.GCM.seal(plaintextData, using: key, nonce: nonce)
            
            let ivHex = nonce.map { String(format: "%02hhx", $0) }.joined()
            let tagHex = sealedBox.tag.map { String(format: "%02hhx", $0) }.joined()
            let ciphertextHex = sealedBox.ciphertext.map { String(format: "%02hhx", $0) }.joined()
            
            return EncryptedPayload(iv: ivHex, tag: tagHex, ciphertext: ciphertextHex)
        } catch {
            print("[Crypto] Encryption failed: \(error)")
            return nil
        }
    }

    // Decrypt payload using AES-256-GCM with the PSK
    func decrypt(payload: EncryptedPayload, pskHex: String) -> String? {
        guard let pskData = hexToData(hex: pskHex),
              let ivData = hexToData(hex: payload.iv),
              let tagData = hexToData(hex: payload.tag),
              let ciphertextData = hexToData(hex: payload.ciphertext) else {
            return nil
        }
        do {
            let key = SymmetricKey(data: pskData)
            let nonce = try AES.GCM.Nonce(data: ivData)
            let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertextData, tag: tagData)
            
            let decryptedData = try AES.GCM.open(sealedBox, using: key)
            return String(data: decryptedData, encoding: .utf8)
        } catch {
            print("[Crypto] Decryption failed: \(error)")
            return nil
        }
    }

    // Helper: Convert Hex String to Data bytes
    private func hexToData(hex: String) -> Data? {
        var data = Data(capacity: hex.count / 2)
        let regex = try! NSRegularExpression(pattern: "[0-9a-fA-F]{2}", options: [])
        let range = NSRange(location: 0, length: hex.utf16.count)
        regex.enumerateMatches(in: hex, options: [], range: range) { match, _, _ in
            let byteString = (hex as NSString).substring(with: match!.range)
            var num = UInt8(byteString, radix: 16)!
            data.append(&num, count: 1)
        }
        guard data.count > 0 else { return nil }
        return data
    }
}
