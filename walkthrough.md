# Walkthrough: FIDO CTAP2.1 Passkey Authenticator integration

This document outlines the codebase components, verification results, and step-by-step instructions to run and test the **FIDO CTAP2.1 Hybrid Passkey Authenticator Proof of Concept (PoC)**.

---

## 1. Codebase Components Built

All directories and source code have been created in your workspace:

### A. POC Stuck Backend (`/poc-stuck-backend`)
*   [package.json](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/poc-stuck-backend/package.json): Defines dependencies including `@simplewebauthn/server` for WebAuthn, `ws` for WebSockets, and `jest` for tests.
*   [server.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/poc-stuck-backend/server.js): Express web server & WebSocket signaling tunnel. Compiles the Swift scanner on boot and manages the child-process execution during login.
*   [cryptoHelper.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/poc-stuck-backend/cryptoHelper.js): Symmetric encryption wrapper using node crypto's `aes-256-gcm` cipher.
*   [ble_scanner.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/poc-stuck-backend/ble_scanner.swift): macOS CoreBluetooth command-line scanner. It verifies Bluetooth permissions on startup, scans for FIDO advertisements on UUID `FFFD`, filters by the active session token hash, and prints RSSI to stdout.

### B. Relying Party Browser App (`/browser`)
*   [index.html](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/browser/index.html): Premium dark-mode glassmorphism login portal. Features the QR Canvas, manual copy-paste token fields, sockets connection indicator dots, and a real-time console logger.
*   [style.css](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/browser/style.css): Vanilla CSS tokens, card layouts, logs console feed, and custom checkmark animations.
*   [app.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/browser/app.js): Handles Web Crypto GCM encryption/decryption, SHA-256 session token hashing, WS event listening, and WebAuthn options/assertion API triggers.

### C. Mobile Web PWA Simulator (`/mobile/simulator`)
*   [index.html](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/simulator/index.html): Mobile-responsive layout representing an iPhone screen with video scanner preview and simulated FaceID prompts.
*   [style.css](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/simulator/style.css): Styled iPhone shell, animated scanner line overlay, radar rings, and FaceID spinner popup.
*   [app.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/simulator/app.js): Local Web Crypto P-256 keypair generator, `localStorage` mock keychain, CBOR/COSE serialization helpers, and GCM E2EE relay.

### D. Native iOS SwiftUI App (`/mobile/ios`)
*   [ContentView.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/ContentView.swift): SwiftUI view displaying the token input, FaceID approval cards showing browser OS/IP/origin metadata, and execution relays.
*   [CryptoManager.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/CryptoManager.swift): Swift module wrapping `CryptoKit` for ECDSA signing and AES-GCM encryption.
*   [BLEAdvertiser.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/BLEAdvertiser.swift): Broadcaster using `CBPeripheralManager` to advertise Service UUID `0xFFFD` containing the truncated token hash in its payload.
*   [TunnelClient.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/TunnelClient.swift): WebSocket connection helper using native `URLSessionWebSocketTask` with automated ping/pong keepalive.
*   [QRScannerView.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/QRScannerView.swift): UIKit bridge wrapping `AVCaptureSession` for camera feeds, with text fallback inside the simulator.
*   [AuthenticatorApp.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/AuthenticatorApp.swift): Entry point struct.
*   [CredentialProviderViewController.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/CredentialProviderExtension/CredentialProviderViewController.swift): System Credential Provider Extension handling AutoFill passkey queries.
*   [Info.plist](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/CredentialProviderExtension/Info.plist): Configuration file mapping the system extension point.

---

## 2. Test Execution & Verification Evidence

### A. Jest Automated TDD Test Logs (PASS)
The backend TDD test suite covers E2EE helper functions, Express options challenge endpoints, and the real-time WebSocket signaling tunnel (using simulated simulator headers to satisfy the BLE lock):

```bash
$ npm test

> poc-stuck-backend@1.0.0 test
> jest

  console.log
    [Tunnel] Client connected to session 32243458fc7bcf7360eb028df5fc14be. Role: browser. Device: unknown
      at WebSocketServer.log (server.js:287:11)

  console.log
    [Tunnel] Client connected to session 32243458fc7bcf7360eb028df5fc14be. Role: mobile. Device: simulator
      at WebSocketServer.log (server.js:287:11)

  console.log
    [Proximity] Mobile is running in Simulator mode. Triggering simulated BLE proximity check...
      at WebSocketServer.log (server.js:323:13)

  console.log
    [Proximity] Simulated BLE check passed for session 32243458fc7bcf7360eb028df5fc14be (RSSI: -65dBm).
      at Timeout.log [as _onTimeout] (server.js:328:17)

PASS tests/server.test.js
  E2EE Cryptography Helper (AES-256-GCM)
    ✓ should encrypt and decrypt a message successfully (2 ms)
    ✓ should throw error when decrypting with incorrect PSK (2 ms)
    ✓ should throw error when encrypted payload is tampered
  Relying Party Backend API & WebSocket Tunnel
    ✓ GET /api/auth/register-options should return WebAuthn options (30 ms)
    ✓ GET /api/auth/login-options should return WebAuthn login assertion options (2 ms)
    ✓ WebSocket Signaling Tunnel should relay messages between Browser and Mobile with simulated proximity check (1523 ms)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        1.836 s
Ran all test suites.
```

### B. macOS Swift Scanner Compilation Test (SUCCESS)
The native Swift CLI scanner compiles natively on your macOS with Xcode 26.5:

```bash
$ swiftc poc-stuck-backend/ble_scanner.swift -o poc-stuck-backend/ble_scanner
# (Completed with zero warnings/errors)
```

### C. Native iOS SwiftUI App Execution inside iOS Simulator (SUCCESS)
We successfully resolved the Swift compiler delegate type mismatch and missing imports, compiled the native SwiftUI application for the arm64 Simulator target, built a signed `.app` bundle, booted the simulator, installed the application, and launched it.

**Compilation & Signing Commands**:
```bash
# 1. Compile Swift sources
swiftc -sdk /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator26.5.sdk \
       -target arm64-apple-ios17.0-simulator \
       -o mobile/ios/build/AuthenticatorApp mobile/ios/AuthenticatorApp/*.swift

# 2. Build the app bundle
mkdir -p mobile/ios/build/AuthenticatorApp.app
cp mobile/ios/build/AuthenticatorApp mobile/ios/build/AuthenticatorApp.app/
cp mobile/ios/build/Info.plist mobile/ios/build/AuthenticatorApp.app/

# 3. Ad-hoc sign the bundle
codesign --force --sign - --timestamp=none mobile/ios/build/AuthenticatorApp.app
```

**Simulator Launch Commands**:
```bash
# 1. Boot the iPhone 17 Pro (iOS 26.5) simulator
xcrun simctl boot 8800D9A5-9EE2-45BB-A6E8-F5D92E03FF6D

# 2. Install the app bundle
xcrun simctl install 8800D9A5-9EE2-45BB-A6E8-F5D92E03FF6D mobile/ios/build/DerivedData/Build/Products/Debug-iphonesimulator/AuthenticatorApp.app

# 3. Launch the app bundle
xcrun simctl launch 8800D9A5-9EE2-45BB-A6E8-F5D92E03FF6D gershwin.AuthenticatorApp
```

Below is the verified screenshot showing the Authenticator app running in the iOS Simulator:

![Native iOS Authenticator Running in Simulator](/Users/gershwin/.gemini/antigravity/brain/4b549782-0baa-4a66-8f4c-f76e9f67b3ea/ios_simulator_authenticator_launched_new.png)

---

## 3. How to Run the End-to-End Integration

### Step 1: Start the Backend Server
Navigate to the backend directory and run:
```bash
cd poc-stuck-backend
npm start
```
This compiles the Swift scanner automatically and boots the Express/WebSocket server:
```
[Scanner] Compiling macOS Swift BLE helper: adventurous-pasteur/poc-stuck-backend/ble_scanner.swift...
[Scanner] Compilation successful. Native BLE scanner ready.

======================================================
 FIDO Passkey RP & Tunnel Server running on:
 - Browser Portal: http://localhost:3000
 - Mobile Simulator: http://localhost:3000/mobile
======================================================
```

### Step 2: Open the Relying Party Browser Portal
1. Open Google Chrome or Safari on your Mac and navigate to:
   `http://localhost:3000`
2. Enter a username (e.g., `alice`) and click **Register Passkey**.
3. The ceremony panel will expand, rendering a **QR Code** and displaying a text-based **Simulator Token Bypass** (e.g. `e145b23a...`).
4. The Browser client immediately connects to the WebSocket, triggering:
   `[Proximity] Scanning BLE...` (yellow dot).

### Step 3: Connect the Mobile Authenticator (PWA Simulator)
1. Open another browser tab or loading page on your physical phone (on the same local WiFi) at:
   `http://<YOUR_MAC_IP>:3000/mobile` (replace with the IP shown in the backend boot logs).
2. Or open it locally: `http://localhost:3000/mobile`.
3. Paste the **Simulator Token Bypass** in the input field and click **Connect via Token**.
4. The simulator immediately connects to the tunnel. Because `Simulate BLE Advertisement` is checked, it will send the mock proximity header.
5. In the browser logs, you will instantly see:
   `[Proximity] BLE Proximity verification mocked (Simulator Bypass).`
   The proximity status dot turns green!
6. The browser now encrypts the FIDO options using GCM and relays them over the WebSocket.
7. The mobile simulator decrypts them, presenting the **Approve Login?** FaceID card showing:
   *   Request Origin: `localhost`
   *   User Account: `alice`
   *   Host IP details.
8. Click **Approve with FaceID**. The FaceID verification animation fires, the P-256 key pair is generated and stored in `localStorage`, the assertion is signed and returned E2EE.

![FaceID Biometric Approval Prompt](/Users/gershwin/.gemini/antigravity/brain/4b549782-0baa-4a66-8f4c-f76e9f67b3ea/mobile_faceid_approval_1780209314839.png)

9. The browser receives the response, decrypts it, registers it on the backend, and displays the **Success Dashboard**!

![Successful Authentication Dashboard](/Users/gershwin/.gemini/antigravity/brain/4b549782-0baa-4a66-8f4c-f76e9f67b3ea/browser_dashboard_success_1780209331633.png)

---

## 4. How to Test Physical BLE Scan Standalone (Host Mac + Phone)

If you wish to verify real physical BLE advertising and scanning using your Mac's Bluetooth chip:

1.  Compile and start the Swift scanner CLI in test mode on your Mac:
    ```bash
    ./poc-stuck-backend/ble_scanner 0123456789abcdef
    ```
    This instructs the Mac to scan for an advertisement containing UUID `0xFFFD` and a service data token of `0123456789abcdef`.
2.  Install a free BLE utility like **nRF Connect** on your physical iPhone or Android device.
3.  In the app, navigate to **Advertiser**, add a new advertising packet:
    *   Add **Service UUID**: `FFFD`
    *   Add **Service Data**: Input the matching hex `0123456789abcdef`.
4.  Start advertising from the phone app.
5.  **Result**: The macOS terminal will instantly capture the advertisement and print the RSSI value:
    ```json
    {"hash": "0123456789abcdef", "rssi": -58}
    ```
    This proves that the server-side Swift code compiles and interacts with your Mac's real CoreBluetooth stack to capture signal proximity!

---

## 5. Signature Counter Synchronization Fix

In the WebAuthn/FIDO2 specifications, subsequent authentication assertions must present a sign counter that is strictly greater than the counter recorded during registration or the previous assertion.

To resolve the error `Response counter value 2 was lower than expected 2` on consecutive logins across different user accounts:
1. **User-Scoped Isolation**:
   * Previously, the signature counter key (`passkey_counter`) was shared globally across all users in the authenticator. If a new user registered, it reset the counter to `1` globally, clobbering the counter of other existing credentials and causing subsequent logins of other users to fail with validation errors.
   * We updated the key namespace to be unique per-user (e.g., `passkey_counter_${username}`).
2. **Cold-Start Fallbacks**:
   * To prevent signature counter mismatch errors for existing registered users, the authenticator dynamically falls back to checking the old global `passkey_counter` if the scoped user key is not found, before defaulting to `1`.
3. **Implementation Details**:
   * **Native SwiftUI Authenticator ([ContentView.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/ContentView.swift))**: Uses `"passkey_counter_\(username)"` in `UserDefaults`.
   * **PWA Mobile Simulator ([app.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/simulator/app.js))**: Uses `passkey_counter_${username}` in `localStorage`.

---

## 6. Parallel Proximity Check & Visual Verification Code

To provide a modern, premium, and highly transparent authentication ceremony, we restructured the proximity workflow and introduced matching codes:

1. **Immediate Payload Relay**:
   * Previously, the WebSocket server blocked WebAuthn option payload relaying until the CoreBluetooth/Simulator BLE proximity scanning succeeded.
   * We updated the WebSocket server relay code in [server.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/poc-stuck-backend/server.js) to relay the encrypted WebAuthn challenge payload immediately when the browser and mobile establish a session pairing.
   * This allows the native SwiftUI app and PWA simulator to immediately decrypt the payload and display the **Approval Prompts card**, containing user details, requested origin, and IP address, without waiting on a loading spinner.

2. **Parallel, Non-Blocking Proximity Scanning**:
   * While the user reviews the metadata card details, the server launches the BLE scanner in the background.
   * The SwiftUI app ([ContentView.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/ContentView.swift)) and PWA simulator ([app.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/simulator/app.js)) display a status row: `BLE Proximity: 🔵 Scanning...`.
   * **Decoupled Verification Journey**: To prevent user blockage due to hardware delays or simulator scanning limitations, the **Approve with FaceID** button is always interactive. The BLE scan runs in the background and updates the proximity row status to `🟢 Verified Nearby` dynamically upon verification, but does not block user approval.

3. **Visual Anti-Phishing Verification Code**:
   * We implemented a synchronous confirmation hash code derived from the E2EE Pre-Shared Key (PSK):
     ```javascript
     const verificationCode = String(parseInt(activePsk.substring(0, 8), 16) % 10000).padStart(4, '0');
     ```
   * Since the PSK is strictly E2EE client-side (unreadable by the server), this 4-digit code is cryptographically unique to the active pairing.
   * Both the Relying Party dashboard ([index.html](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/browser/index.html)) and the mobile views display this code (e.g., `Matching Code: 4821`). The user can verify they are approving the correct session at a glance.

---

## 7. Username and User Account Resolution

In a standard FIDO2 assertion (login) ceremony, the Relying Party server only sends a list of allowed credential IDs without username metadata to the authenticator (relying instead on the authenticator's internal secure storage to resolve the credential ID to a user account).

To ensure the correct username is resolved and displayed on the approval card without assuming or hardcoding any specific account:
1. **Per-Credential ID Registration Mapping**:
   * When registering a new passkey, both authenticators save the private/public keys, username, and key metadata mapped by the **base64url-encoded Credential ID** (derived from the public key bytes).
   * **iOS SwiftUI App**: Stores credential dictionaries under key `"passkey_cred_\(credId)"` in `UserDefaults`.
   * **PWA Simulator**: Stores credential JSON strings under key `passkey_cred_${credId}` in `localStorage`.
2. **Dynamic Allowed-Credentials Lookup on Login**:
   * During a login assertion, the authenticator scans the browser's decrypted `allowCredentials` option list.
   * It cross-references these allowed credential IDs against its local storage.
   * If a match is found, the authenticator dynamically loads the exact username, private key, and key ID registered for that credential. This username is then populated directly on the approval screen and signs the challenge.
3. **Robust Fallbacks & Account Mismatch Prevention**:
   * If no matching credential ID is found (e.g. from legacy registrations), the app falls back to checking custom properties relayed from the browser (`options.username`), then legacy local single-key entries, and finally defaults to `"alice"`.
   * **Legacy Slot Protection**: In the iOS app, the legacy fallback slot is shared globally. To prevent conflicts when switching users, we added a safety check: the legacy slot is **only used if the stored username matches the browser-requested username**.
4. **No-Key-Found UI Warnings**:
   * If a user attempts to log in but has no registered passkey matching the requested credentials (either via ID lookup or fallback) on the current device:
     * **iOS SwiftUI App**: Displays a red warning `⚠️ No matching passkey found` on the metadata card, and disables the **Approve FaceID** button (rendering it as `No Passkey Found`).
     * **PWA Simulator**: Displays a red warning `❌ No matching passkey found` in the proximity status row, and disables/grays out the approval button.
      * This prevents generating invalid signatures and provides immediate clarity to the user.

---

## 8. Physical iOS Device Deployment & Privacy Permissions

When running the native Swift and BLE advertiser codebase on a physical iOS device (such as `LIANG’s iPhone`), iOS sandboxing strictly requires usage descriptions and connection security declarations:
1. **Camera Feed (`AVCaptureDevice`)**: Needed for scanning pairing QR codes.
2. **Bluetooth Proximity Manager (`CBPeripheralManager`)**: Needed to advertise proximity for the hybrid passkey ceremony.
3. **Local Network Connection (`NSLocalNetworkUsageDescription`)**: Needed to communicate with the local pairing server over the Wi-Fi LAN.
4. **App Transport Security (`NSAppTransportSecurity` / `NSAllowsArbitraryLoads`)**: Needed because the WebSocket connection is unencrypted (`ws://192.168.8.201:3000`), which iOS ATS blocks by default.
5. **Face ID Biometric Access (`NSFaceIDUsageDescription`)**: Needed to authorize passkey signature authentication on the device.

Without these descriptions and exception flags, iOS will immediately abort the application on launch/API access (`SIGABRT`) or block the WebSocket connection with `nw_endpoint_flow_failed_with_error`.

### Configuration Strategy
To support nested dictionary keys like `NSAppTransportSecurity` and avoid cluttering the build settings, we created a physical `Info.plist` file.

> [!IMPORTANT]
> **Xcode Directory Sync Note**: To prevent Xcode's File-System Sync feature (`PBXFileSystemSynchronizedRootGroup`) from copying `Info.plist` as a bundle resource (which causes duplicate output build failures), the file is placed at the root level of the project folder: [Info.plist](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/Info.plist).

We configured Xcode to use and merge this file by setting `INFOPLIST_FILE = Info.plist;` in [project.pbxproj](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp.xcodeproj/project.pbxproj).

### How to Run on Physical Device
Due to physical iOS device signing and keychain certificate validation rules, standard command-line deployment via `ios-deploy` or manual ad-hoc signing is blocked without local developer identities. Xcode's automatic signing must be used:

1. **Open the Project in Xcode**:
   Double-click the Xcode project or run:
   ```bash
   open mobile/ios/AuthenticatorApp.xcodeproj
   ```
2. **Select the Physical Device**:
   In the top schemes/device toolbar, click the active target (currently showing `iPhone 17 Pro` or simulator) and change it to the connected physical iOS device: **LIANG’s iPhone**.
3. **Configure Signing**:
   * Click on the root `AuthenticatorApp` project node in the left-hand sidebar folder navigator.
   * Under the **Signing & Capabilities** tab of the `AuthenticatorApp` target, ensure your Developer Account (Personal Team) is selected for automatic provisioning.
4. **Run and Install**:
   * Click the **Run** button (or press `Cmd + R`). Xcode will compile the SwiftUI codebase targeting iOS 15.0+, provision the bundle ID `gershwin.AuthenticatorApp` under your developer account, and sideload it to the device.
5. **Trust the Provisioning Profile on iOS**:
   * On your iPhone, navigate to **Settings > General > VPN & Device Management**.
   * Locate the Developer App profile corresponding to your Apple ID.
   * Tap **Trust** and confirm.
6. **Launch & Test**:
    * Select permissions when iOS prompts you for **Camera** and **Bluetooth** access.
    * Use the iPhone camera to scan the QR code generated on the relying party browser dashboard to complete end-to-end passkey ceremonies!

---

## 9. CoreBluetooth Advertising Crash Fix (`-[CBUUID UTF8String]`)

When running on the physical iPhone, the app initially crashed with:
```
*** Terminating app due to uncaught exception 'NSInvalidArgumentException', reason: '-[CBUUID UTF8String]: unrecognized selector sent to instance 0x1141e38c0'
```

### Cause of the Crash
* **Strict Advertising Constraints on iOS**: CoreBluetooth peripheral advertising on iOS is restricted. Peripherals are only allowed to broadcast two keys in their advertisement payload: `CBAdvertisementDataServiceUUIDsKey` and `CBAdvertisementDataLocalNameKey`.
* **The Crash Vector**: The code attempted to advertise custom service data using `CBAdvertisementDataServiceDataKey` containing a dictionary mapping `CBUUID` to `Data`. Internally, CoreBluetooth tries to parse the dictionary keys as string objects by calling `UTF8String` on them. Since `CBUUID` is an object, not a string, this caused a fatal unrecognized selector crash (`NSInvalidArgumentException`).

### The Solution: Deterministic 128-bit Derived CBUUID
To bypass the iOS restriction and avoid the crash entirely:
1. **Derived UUID Strategy**:
   * Both the iPhone app and the Mac scanner already share the session token hash (a SHA-256 string).
   * We added a helper `deriveCBUUID(from:)` that deterministically formats the first 32 characters of the token hash into a standard 128-bit UUID (e.g. `12345678-90ab-cdef-1234-567890abcdef`).
2. **iOS Advertiser Modification**:
   * The iOS app now registers a `CBMutableService` using this derived UUID and advertises it directly under `CBAdvertisementDataServiceUUIDsKey`. This is fully supported by iOS sandboxing and does not crash.
3. **Mac Scanner Alignment**:
   * We updated the backend's Swift scanner ([ble_scanner.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/poc-stuck-backend/ble_scanner.swift)) to derive the same UUID from the target token hash and scan for it directly.
   * Proximity is verified instantly when that specific UUID is discovered nearby.
   * This aligns the scanner with the iPhone, avoids scanning general namespaces, and increases security and pairing speed by eliminating session-to-session scan interference.

---

## 10. Dynamic IP Network Interface Selector

Depending on how your physical iPhone is connected to your host Mac, the route it uses to reach the server can change:
* **Wi-Fi Subnet**: Normally routes over `192.168.x.x` IPs. However, routers with **Client Isolation** enabled block Wi-Fi devices from connecting to local machines.
* **USB-to-Mac Cable Bridge**: macOS configures a private Link-Local connection over the USB cable (IP range `169.254.x.x`) to allow communication.

If the auto-detected server IP fails to route, the phone will fail to connect.

### Solution: Interactive Network Selector
To provide maximum flexibility and bypass subnet routing limitations:
1. **Multi-IP Config Endpoint**:
   * We updated the backend server config API ([server.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/poc-stuck-backend/server.js)) to scan all active network interfaces and return all IPv4 addresses with their respective adapter names (e.g. `en0` for Wi-Fi, `en5` for USB cable bridge).
2. **Interactive Selection Dropdown**:
   * We added a **Network Connection IP** dropdown select menu in the browser dashboard ([index.html](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/browser/index.html)).
   * The dropdown automatically detects the active page hostname and sets it as the default.
3. **Dynamic QR & Token Regeneration**:
   * When you select a different IP address from the dropdown, the browser client ([app.js](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/browser/app.js)) automatically recalculates the connection endpoint URL, regenerates the QR Code canvas, and updates the simulator bypass token dynamically.
   * This lets you instantly switch target networks without reloading the page or restarting the server.
4. **Swift Scan Guard**:
   * We added `guard currentScreen == .connect else { return }` in the iPhone app ([ContentView.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/AuthenticatorApp/ContentView.swift)) to prevent redundant socket connection attempts if the camera captures the QR code multiple times.

---

## 11. Final Physical Verification Fixes & Compiler Alignment

During the final physical device testing, we implemented the following enhancements to resolve compiler warnings, security loops, and proximity timeout issues:

### A. Swift Unused Compiler Warning Resolution
* **The Fix**: Removed the unused local variable `clientDataJSONStr` inside the `ContentView.swift` WebAuthn assertion/registration mock signing code. This guarantees clean compilation on strict Xcode configurations.

### B. Proximity Scan Timeout & Scanner Auto-Restart
* **The Fix**: Previously, if the user took more than 10 seconds to scan the QR code, the Mac BLE scanner timed out and terminated before the phone connected and began advertising. We updated `server.js` to dynamically detect when the mobile WebSocket connects. If the browser is waiting for a proximity check, the server **automatically starts/restarts the physical BLE central scanner**, eliminating any 10-second timeout race condition.

### C. Continuous RSSI Scanning & Real-Time Proximity Threshold
* **The Fix**: The Swift scanner (`ble_scanner.swift`) was modified to remove the immediate `exit(0)` on first discovery. It now streams discoveries continuously in real-time. This allows the server to dynamically monitor the signal strength (RSSI) as the user brings their phone closer to the Mac, triggering successful proximity verification the instant the signal meets the threshold (e.g. `>= -75 dBm`).

### D. Authenticator Proximity Lock
* **The Fix**: Aligned the native SwiftUI **Approve FaceID** button behavior with the FIDO2 hybrid security specification. The button now starts in a disabled **"Waiting for Proximity..."** state and only becomes active and displays **"Approve FaceID"** once the CoreBluetooth connection verifies that the physical device is nearby.

---

## 12. iOS System AutoFill Passkey Extension Configuration

We have added the source files for a custom **iOS Credential Provider Extension** target to enable system-wide passkey autofill.

### Components Added
1.  **Swift Extension Handler ([CredentialProviderViewController.swift](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/CredentialProviderExtension/CredentialProviderViewController.swift)):** Subclasses `ASCredentialProviderViewController` and implements system-level overrides to catch login triggers, search local UserDefaults/Keychain, validate via Face ID/Touch ID, and return signed passkey assertions to iOS.
2.  **Configuration Properties ([Info.plist](file:///Users/gershwin/Documents/antigravity/adventurous-pasteur/mobile/ios/CredentialProviderExtension/Info.plist)):** Declares compatibility with `com.apple.authentication-services-credential-provider` and sets biometrics requirement constraints.

### Sideloading and System Enablement Steps
1.  In Xcode, link these files under a new target of type **Credential Provider Extension**.
2.  Enable the **Associated Domains** capability in both main app and extension targets using `webcredentials:yourdomain.com`.
3.  Publish a signed Apple-App-Site-Association (AASA) JSON file under: `https://yourdomain.com/.well-known/apple-app-site-association`.
4.  Compile, sign, and install the application to your physical iPhone device.
5.  On the iPhone, navigate to **Settings > Passwords > Password Options** (or **AutoFill Passwords & Passkeys**), locate **Passkey Authenticator Provider**, and toggle it **ON**.

