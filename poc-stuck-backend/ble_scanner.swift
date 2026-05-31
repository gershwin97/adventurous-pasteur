import Foundation
import CoreBluetooth

// Helper: Derive a 128-bit UUID (CBUUID) deterministically from the session token hash hex string (first 32 characters)
func deriveCBUUID(from tokenHashHex: String) -> CBUUID? {
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

class BLEScanner: NSObject, CBCentralManagerDelegate {
    var centralManager: CBCentralManager!
    let targetHash: String
    let targetUUID: CBUUID

    init(targetHash: String) {
        self.targetHash = targetHash.lowercased()
        if let uuid = deriveCBUUID(from: targetHash) {
            self.targetUUID = uuid
        } else {
            // Fallback just in case
            self.targetUUID = CBUUID(string: "FFFD")
        }
        super.init()
        self.centralManager = CBCentralManager(delegate: self, queue: nil, options: [CBCentralManagerOptionShowPowerAlertKey: false])
    }

    func startTimeout() {
        // Exit with code 1 after 10 seconds if no matching advertisement is found
        DispatchQueue.main.asyncAfter(deadline: .now() + 10.0) {
            let timeoutJson = "{\"error\": \"Scan timed out without finding matching device\"}"
            print(timeoutJson)
            fflush(stdout)
            exit(1)
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            // Check authorization state
            if #available(macOS 10.15, *) {
                let auth = CBCentralManager.authorization
                if auth == .denied || auth == .restricted {
                    let errJson = "{\"error\": \"Bluetooth permission denied on host machine\"}"
                    print(errJson)
                    fflush(stdout)
                    exit(2)
                }
            }
            // Start scanning for our target custom UUID
            centralManager.scanForPeripherals(withServices: [targetUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        case .poweredOff:
            let errJson = "{\"error\": \"Bluetooth is powered off on host machine\"}"
            print(errJson)
            fflush(stdout)
            exit(3)
        case .unauthorized:
            let errJson = "{\"error\": \"Bluetooth permission denied on host machine\"}"
            print(errJson)
            fflush(stdout)
            exit(2)
        case .unsupported:
            let errJson = "{\"error\": \"Bluetooth is not supported on this machine\"}"
            print(errJson)
            fflush(stdout)
            exit(4)
        default:
            break
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        // Since we are scanning exclusively for targetUUID, any discovery is our matching device
        let successJson = "{\"hash\": \"\(targetHash)\", \"rssi\": \(RSSI.intValue)}"
        print(successJson)
        fflush(stdout)
    }
}

// Check command line arguments
let arguments = CommandLine.arguments
guard arguments.count > 1 else {
    let errJson = "{\"error\": \"Missing target session token hash argument\"}"
    print(errJson)
    fflush(stdout)
    exit(5)
}

let target = arguments[1]
let scanner = BLEScanner(targetHash: target)
scanner.startTimeout()

// Run the main run loop
RunLoop.main.run()
