import Foundation
import CoreBluetooth

class BLEAdvertiser: NSObject, CBPeripheralManagerDelegate {
    static let shared = BLEAdvertiser()
    private var peripheralManager: CBPeripheralManager?
    private var fidoService: CBMutableService?
    private var activeTokenHashHex: String?
    private var isAdvertising = false

    private override init() {
        super.init()
        // Initialize CoreBluetooth peripheral manager on main thread
        self.peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
    }

    // Start BLE advertising using token hash
    func startAdvertising(tokenHashHex: String) {
        self.activeTokenHashHex = tokenHashHex
        self.isAdvertising = true
        
        triggerAdvertisingIfPoweredOn()
    }

    func stopAdvertising() {
        self.isAdvertising = false
        if let manager = peripheralManager, manager.isAdvertising {
            manager.stopAdvertising()
            print("[BLE] Stopped advertising FIDO service.")
        }
    }

    private func triggerAdvertisingIfPoweredOn() {
        guard let manager = peripheralManager, manager.state == .poweredOn, isAdvertising, let tokenHashHex = activeTokenHashHex else {
            return
        }
        
        if manager.isAdvertising {
            manager.stopAdvertising()
        }

        // Derive unique 128-bit UUID from token hash to avoid CBAdvertisementDataServiceDataKey iOS limitations
        guard let customUUID = deriveCBUUID(from: tokenHashHex) else {
            print("[BLE] Error: Failed to derive UUID from token hash: \(tokenHashHex)")
            return
        }

        // Configure custom FIDO service with the derived UUID
        let service = CBMutableService(type: customUUID, primary: true)
        self.fidoService = service
        manager.add(service)
        
        // Broadcast custom Service UUID (fully supported on iOS peripherals)
        let advertisementData: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [customUUID]
        ]
        
        manager.startAdvertising(advertisementData)
        print("[BLE] Started advertising custom FIDO service (UUID: \(customUUID.uuidString)) for token: \(tokenHashHex)")
    }

    // CBPeripheralManagerDelegate handlers
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        switch peripheral.state {
        case .poweredOn:
            print("[BLE] Bluetooth hardware is Powered On.")
            triggerAdvertisingIfPoweredOn()
        case .poweredOff:
            print("[BLE] Bluetooth hardware is Powered Off.")
            stopAdvertising()
        case .unauthorized:
            print("[BLE] Bluetooth permissions denied on device.")
        default:
            break
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error = error {
            print("[BLE] Failed to register service: \(error.localizedDescription)")
        } else {
            print("[BLE] Service registered successfully.")
        }
    }

    // Helper: Derive a 128-bit UUID (CBUUID) deterministically from the session token hash hex string (first 32 characters)
    private func deriveCBUUID(from tokenHashHex: String) -> CBUUID? {
        let hex = tokenHashHex.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard hex.count >= 32 else { return nil }
        
        let index0 = hex.index(hex.startIndex, offsetBy: 8)
        let index1 = hex.index(index0, offsetBy: 4)
        let index2 = hex.index(index1, offsetBy: 4)
        let index3 = hex.index(index2, offsetBy: 4)
        let index4 = hex.index(index3, offsetBy: 12)
        
        let part1 = String(hex[..<index0])
        let part2 = String(hex[index0..<index1])
        let part3 = String(hex[index1..<index2])
        let part4 = String(hex[index2..<index3])
        let part5 = String(hex[index3..<index4])
        
        let uuidString = "\(part1)-\(part2)-\(part3)-\(part4)-\(part5)"
        return CBUUID(string: uuidString)
    }
}
