import Foundation
import CoreBluetooth

class BLEAdvertiser: NSObject, CBPeripheralManagerDelegate {
    static let shared = BLEAdvertiser()
    private var peripheralManager: CBPeripheralManager?
    private var fidoService: CBMutableService?
    
    private let fidoServiceUUID = CBUUID(string: "FFFD")
    private var activeServiceData: Data?
    
    private var isAdvertising = false

    private override init() {
        super.init()
        // Initialize CoreBluetooth peripheral manager on main thread
        self.peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
    }

    // Convert hex SessionTokenHash to bytes and start BLE advertising
    func startAdvertising(tokenHashHex: String) {
        guard let data = hexToData(hex: tokenHashHex) else { return }
        self.activeServiceData = data
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
        guard let manager = peripheralManager, manager.state == .poweredOn, isAdvertising, let serviceData = activeServiceData else {
            return
        }
        
        if manager.isAdvertising {
            manager.stopAdvertising()
        }

        // Configure standard FIDO service
        let service = CBMutableService(type: fidoServiceUUID, primary: true)
        self.fidoService = service
        manager.add(service)
        
        // Broadcast Service UUID and include session hash in Service Data
        let advertisementData: [String: Any] = [
            CBAdvertisementDataServiceUUIDsKey: [fidoServiceUUID],
            CBAdvertisementDataServiceDataKey: [fidoServiceUUID: serviceData]
        ]
        
        manager.startAdvertising(advertisementData)
        print("[BLE] Started advertising FIDO service (UUID: FFFD) with token: \(serviceData.map { String(format: "%02hhx", $0) }.joined())")
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
