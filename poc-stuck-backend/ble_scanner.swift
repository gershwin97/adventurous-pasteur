import Foundation
import CoreBluetooth

class BLEScanner: NSObject, CBCentralManagerDelegate {
    var centralManager: CBCentralManager!
    let targetHash: String
    let targetServiceUUID = CBUUID(string: "FFFD")

    init(targetHash: String) {
        self.targetHash = targetHash.lowercased()
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
            // Start scanning
            centralManager.scanForPeripherals(withServices: [targetServiceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
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
        // Extract service data for FFFD
        if let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data],
           let data = serviceData[targetServiceUUID] {
            let tokenHex = data.map { String(format: "%02hhx", $0) }.joined()
            // Check if the advertised hash matches the beginning of our target hash (hybrid advertisements are truncated)
            if targetHash.hasPrefix(tokenHex) || tokenHex.hasPrefix(targetHash) {
                let successJson = "{\"hash\": \"\(tokenHex)\", \"rssi\": \(RSSI.intValue)}"
                print(successJson)
                fflush(stdout)
                exit(0)
            }
        }
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
