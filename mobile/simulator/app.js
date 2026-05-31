// Mobile Simulator Application Logic
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const connectScreen = document.getElementById('connect-screen');
  const processingScreen = document.getElementById('processing-screen');
  const approveScreen = document.getElementById('approve-screen');
  const successScreen = document.getElementById('success-screen');

  const tokenInput = document.getElementById('token-input');
  const btnConnectToken = document.getElementById('btn-connect-token');
  const btnStartScan = document.getElementById('btn-start-scan');
  const btnStopScan = document.getElementById('btn-stop-scan');
  const btnApprove = document.getElementById('btn-approve');
  const btnReject = document.getElementById('btn-reject');
  const btnDone = document.getElementById('btn-done');

  const processingTitle = document.getElementById('processing-title');
  const processingMsg = document.getElementById('processing-msg');
  const mockBleToggle = document.getElementById('mock-ble-toggle');
  const videoContainer = document.getElementById('video-container');
  const videoPreview = document.getElementById('video-preview');
  const videoCanvas = document.getElementById('video-canvas');

  const metaOrigin = document.getElementById('meta-origin');
  const metaOs = document.getElementById('meta-os');
  const metaIp = document.getElementById('meta-ip');
  const metaUser = document.getElementById('meta-user');
  
  const metaSession = document.getElementById('meta-session');
  const metaMatchingCode = document.getElementById('meta-matching-code');
  const metaProximityStatus = document.getElementById('meta-proximity-status');
  
  const faceidPrompt = document.getElementById('faceid-prompt');
  const appLogs = document.getElementById('app-logs');

  // State Variables
  let ws = null;
  let activeSessionId = null;
  let activePsk = null;
  let activeHostIp = null;
  let activePort = null;
  let ceremonyType = null;
  let username = null;
  let videoStream = null;
  let scanInterval = null;
  let fidoOptions = null; // The decrypted challenge options from browser
  let isProximityVerified = false;

  // Setup fallback event listeners
  btnConnectToken.addEventListener('click', () => {
    const rawToken = tokenInput.value.trim();
    if (!rawToken) return showBannerError('Please paste a session token');
    
    // Parse Token (Format: SessionID:PSK:HostIP:Port)
    const parts = rawToken.split(':');
    if (parts.length < 4) return showBannerError('Invalid token format');
    
    activeSessionId = parts[0];
    activePsk = parts[1];
    activeHostIp = parts[2];
    activePort = parts[3];
    
    logAppConsole('Token', 'Parsed manual session token.', 'system');
    connectToTunnel();
  });

  btnStartScan.addEventListener('click', startQrScan);
  btnStopScan.addEventListener('click', stopQrScan);
  
  btnReject.addEventListener('click', () => {
    logAppConsole('Auth', 'Auth request denied by user.', 'error');
    if (ws) {
      ws.send(JSON.stringify({ event: 'relay', error: 'Authentication denied by user' }));
    }
    showScreen(connectScreen);
    resetState();
  });

  btnApprove.addEventListener('click', executeBiometricApproval);
  
  btnDone.addEventListener('click', () => {
    showScreen(connectScreen);
    resetState();
  });

  // --- QR Scanning Logic ---

  async function startQrScan() {
    videoContainer.classList.remove('hidden');
    btnStartScan.classList.add('hidden');
    hideBannerError();

    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      videoPreview.srcObject = videoStream;
      videoPreview.setAttribute('playsinline', true);
      videoPreview.play();

      // Start scanning frames
      const canvasCtx = videoCanvas.getContext('2d');
      scanInterval = setInterval(() => {
        if (videoPreview.readyState === videoPreview.HAVE_CURRENT_DATA) {
          videoCanvas.width = videoPreview.videoWidth;
          videoCanvas.height = videoPreview.videoHeight;
          canvasCtx.drawImage(videoPreview, 0, 0, videoCanvas.width, videoCanvas.height);
          
          const imageData = canvasCtx.getImageData(0, 0, videoCanvas.width, videoCanvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
          });

          if (code) {
            logAppConsole('QR', 'QR Code scanned successfully.', 'success');
            stopQrScan();
            parseAndConnect(code.data);
          }
        }
      }, 300);

    } catch (err) {
      showBannerError('Camera access denied or unavailable. Use manual token input instead.');
      stopQrScan();
    }
  }

  function stopQrScan() {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }
    videoContainer.classList.add('hidden');
    btnStartScan.classList.remove('hidden');
  }

  function parseAndConnect(qrData) {
    try {
      const payload = JSON.parse(qrData);
      
      // Parse tunnel URL to get IP and port
      const url = new URL(payload.tunnelUrl);
      activeSessionId = payload.sessionId;
      activePsk = payload.psk;
      activeHostIp = url.hostname;
      activePort = url.port || '80';
      username = payload.username;
      ceremonyType = payload.type;

      logAppConsole('QR', `Parsed QR data. Session: ${activeSessionId.substring(0,8)}...`, 'crypto');
      connectToTunnel();
    } catch (e) {
      showBannerError('Failed to parse QR code data. Make sure it is a valid FIDO PoC code.');
    }
  }

  // --- WebSocket Connection & Tunneling ---

  function connectToTunnel() {
    showScreen(processingScreen);
    processingTitle.textContent = 'Connecting...';
    processingMsg.textContent = 'Opening secure signaling channel...';

    const wsProtocol = (window.location.protocol === 'https:') ? 'wss' : 'ws';
    const isMockBle = mockBleToggle.checked;
    
    // Connect to tunnel with simulator parameters
    const tunnelUrl = `${wsProtocol}://${activeHostIp}:${activePort}/tunnel/${activeSessionId}?role=mobile&device-type=simulator&simulate=${isMockBle}`;
    
    isProximityVerified = false;
    ws = new WebSocket(tunnelUrl);
 
    ws.onopen = () => {
      logAppConsole('Tunnel', 'Connected to WebSocket signaling server.', 'system');
      processingTitle.textContent = 'Verifying Proximity...';
      processingMsg.textContent = 'Performing BLE RSSI check with browser...';
    };
 
    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
 
      // Proximity verified
      if (msg.event === 'proximity-verified') {
        logAppConsole('Proximity', 'Proximity confirmed. Tunnel unlocked.', 'success');
        isProximityVerified = true;
        updateProximityStatusInUI();
        processingMsg.textContent = 'Waiting for cryptographic options...';
      }
 
      // Relay payload (Received FIDO options from browser)
      if (msg.event === 'relay' || msg.ciphertext) {
        logAppConsole('Crypto', 'Received encrypted WebAuthn options. Decrypting...', 'crypto');
        try {
          const decryptedJson = await decryptMessage(msg, activePsk);
          fidoOptions = JSON.parse(decryptedJson);
          
          logAppConsole('Crypto', 'Decryption successful. Loading authorization dialog.', 'success');
          showApprovalDialog();
        } catch (err) {
          logAppConsole('Crypto', `Decryption error: ${err.message}`, 'error');
        }
      }
    };

    ws.onclose = () => {
      logAppConsole('Tunnel', 'WebSocket connection closed.', 'warning');
      showScreen(connectScreen);
    };

    ws.onerror = (err) => {
      console.error(err);
      logAppConsole('Tunnel', 'WebSocket error encountered.', 'error');
    };
  }

  function updateProximityStatusInUI() {
    if (isProximityVerified) {
      metaProximityStatus.textContent = '🟢 Verified Nearby';
      metaProximityStatus.style.color = '#2ecc71';
      btnApprove.disabled = false;
      btnApprove.textContent = ceremonyType === 'registration' ? 'Register Passkey' : 'Approve with FaceID';
      btnApprove.style.backgroundColor = '#2ecc71';
      btnApprove.style.cursor = 'pointer';
      btnApprove.style.color = '#ffffff';
    } else {
      metaProximityStatus.textContent = '🔵 Scanning...';
      metaProximityStatus.style.color = '#3498db';
      btnApprove.disabled = true;
      btnApprove.textContent = 'Waiting for BLE Proximity...';
      btnApprove.style.backgroundColor = '#34495e';
      btnApprove.style.cursor = 'not-allowed';
      btnApprove.style.color = '#7f8c8d';
    }
  }

  function showApprovalDialog() {
    // Determine ceremony type based on fidoOptions parameters
    const isReg = fidoOptions.rp && fidoOptions.user;
    ceremonyType = isReg ? 'registration' : 'login';
    
    username = isReg ? fidoOptions.user.name : (fidoOptions.allowCredentials ? 'alice' : 'Unknown');
 
    // Bind metadata details
    metaOrigin.textContent = fidoOptions.rpId || 'localhost';
    metaUser.textContent = username;
    
    // Fetch mock metadata for visual interest (relayed IP address/agent)
    metaOs.textContent = navigator.platform.includes('Mac') ? 'macOS (Safari)' : 'Windows (Chrome)';
    metaIp.textContent = activeHostIp === 'localhost' ? '127.0.0.1' : activeHostIp;
 
    metaSession.textContent = activeSessionId ? activeSessionId.substring(0, 8) + '...' : '----';
    // Calculate matching code
    const matchingCode = String(parseInt(activePsk.substring(0, 8), 16) % 10000).padStart(4, '0');
    metaMatchingCode.textContent = matchingCode;
 
    updateProximityStatusInUI();
    showScreen(approveScreen);
  }

  // --- Biometric Authentication Mock & Cryptography ---

  function executeBiometricApproval() {
    // Show biometric overlay
    faceidPrompt.classList.remove('hidden');
    logAppConsole('Bio', 'Triggered local FaceID prompt...', 'system');

    // Simulate 1.2s delay for FaceID scan
    setTimeout(async () => {
      faceidPrompt.classList.add('hidden');
      logAppConsole('Bio', 'FaceID authorized successfully.', 'success');
      
      logAppConsole('Crypto', 'Generating FIDO cryptographic signature...', 'crypto');
      
      try {
        let responsePayload;
        if (ceremonyType === 'registration') {
          responsePayload = await generateFidoRegistrationResponse();
        } else {
          responsePayload = await generateFidoAssertionResponse();
        }

        // Encrypt and relay back
        const responseString = JSON.stringify(responsePayload);
        const encrypted = await encryptMessage(responseString, activePsk);
        
        logAppConsole('Tunnel', 'Sending encrypted signature response to browser...', 'system');
        ws.send(JSON.stringify({
          event: 'relay',
          ...encrypted
        }));

        showScreen(successScreen);
      } catch (err) {
        logAppConsole('Crypto', `Signature generation error: ${err.message}`, 'error');
        showScreen(connectScreen);
      }
    }, 1200);
  }

  // --- FIDO2 WebAuthn Mock Response Generators (using Web Crypto API) ---

  async function generateFidoRegistrationResponse() {
    const rpID = fidoOptions.rpId || 'localhost';
    const challenge = fidoOptions.challenge;

    // 1. Generate P-256 Keypair inside simulator
    const keyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, // extractable (so we can save JWK to localStorage)
      ['sign', 'verify']
    );

    // 2. Export Private Key and Public Key to JWK
    const jwkPrivateKey = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const jwkPublicKey = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);

    // Save keypair locally in mock Keychain (localStorage)
    const keyId = generateRandomHex(16);
    localStorage.setItem(`passkey_private_${username}`, JSON.stringify(jwkPrivateKey));
    localStorage.setItem(`passkey_public_${username}`, JSON.stringify(jwkPublicKey));
    localStorage.setItem(`passkey_id_${username}`, keyId);

    // 3. Construct clientDataJSON (SHA-256 hashed and base64url encoded)
    const origin = `http://${activeHostIp}:${activePort}`;
    const clientDataJSONObj = {
      type: 'webauthn.create',
      challenge: challenge,
      origin: origin,
      crossOrigin: false
    };
    const clientDataJSONStr = JSON.stringify(clientDataJSONObj);
    const clientDataJSON = base64url(new TextEncoder().encode(clientDataJSONStr));

    // 4. Assemble mock FIDO2 Attestation Object (including the public key)
    // SimpleWebAuthn parses attestation. We construct a minimal valid attestation format
    // For simplicity, we construct a raw CBOR representation of attestationObject.
    // Instead of importing a heavy CBOR library, we build a helper that serializes a minimal P-256 key into COSE map
    const cosePublicKey = serializeJwkToCose(jwkPublicKey);
    localStorage.setItem('passkey_counter', '1');
    const authData = buildAuthenticatorData(rpID, keyId, cosePublicKey, 1);
    
    // Attestation mapping: { "fmt": "none", "attStmt": {}, "authData": authData }
    const attestationObject = buildMockAttestationObject(authData);

    logAppConsole('Crypto', `Saved new P-256 Passkey locally (KeyID: ${keyId.substring(0,8)}).`, 'success');

    return {
      id: base64url(hexToBuf(keyId)),
      rawId: base64url(hexToBuf(keyId)),
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON,
        attestationObject: attestationObject,
        transports: ['hybrid']
      }
    };
  }

  async function generateFidoAssertionResponse() {
    const rpID = fidoOptions.rpId || 'localhost';
    const challenge = fidoOptions.challenge;

    // 1. Retrieve Private Key from mock Keychain
    const jwkPrivateStr = localStorage.getItem(`passkey_private_${username}`);
    const keyId = localStorage.getItem(`passkey_id_${username}`);
    
    if (!jwkPrivateStr || !keyId) {
      throw new Error(`No registered passkey found for user ${username}`);
    }

    const jwkPrivate = JSON.parse(jwkPrivateStr);
    
    // Import private key back
    const privateKey = await window.crypto.subtle.importKey(
      'jwk',
      jwkPrivate,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    // 2. Construct clientDataJSON
    const origin = `http://${activeHostIp}:${activePort}`;
    const clientDataJSONObj = {
      type: 'webauthn.get',
      challenge: challenge,
      origin: origin,
      crossOrigin: false
    };
    const clientDataJSONStr = JSON.stringify(clientDataJSONObj);
    const clientDataJSONBytes = new TextEncoder().encode(clientDataJSONStr);
    const clientDataJSON = base64url(clientDataJSONBytes);

    // 3. Construct Authenticator Data (37 bytes: 32-byte RP ID hash, 1-byte flag, 4-byte counter)
    const savedCounter = parseInt(localStorage.getItem('passkey_counter') || '1', 10);
    const nextCounter = savedCounter + 1;
    localStorage.setItem('passkey_counter', nextCounter.toString());
    const authData = buildMockAuthDataForAssertion(rpID, nextCounter);

    // 4. Cryptographic Signature (ECDSA P-256 SHA-256)
    // Signed data = authData concatenated with SHA-256 hash of clientDataJSON
    const clientDataHash = await window.crypto.subtle.digest('SHA-256', clientDataJSONBytes);
    
    const signatureInput = new Uint8Array(authData.length + 32);
    signatureInput.set(authData, 0);
    signatureInput.set(new Uint8Array(clientDataHash), authData.length);

    const signatureBuffer = await window.crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      privateKey,
      signatureInput
    );
    
    const signature = base64url(new Uint8Array(signatureBuffer));

    logAppConsole('Crypto', `Signed challenge using Private Key (KeyID: ${keyId.substring(0,8)}).`, 'success');

    return {
      id: base64url(hexToBuf(keyId)),
      rawId: base64url(hexToBuf(keyId)),
      type: 'public-key',
      response: {
        clientDataJSON: clientDataJSON,
        authenticatorData: base64url(authData),
        signature: signature,
        userHandle: base64url(new TextEncoder().encode(username))
      }
    };
  }

  // --- Low-Level Cryptography Helpers for FIDO Spec (Web Crypto API) ---

  async function getCryptoKey(pskHex) {
    const rawKey = hexToBuf(pskHex);
    return await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptMessage(plaintext, pskHex) {
    const key = await getCryptoKey(pskHex);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(plaintext)
    );
    
    const ciphertextArray = new Uint8Array(ciphertextBuffer);
    const tagLength = 16;
    const ciphertext = ciphertextArray.slice(0, ciphertextArray.length - tagLength);
    const tag = ciphertextArray.slice(ciphertextArray.length - tagLength);
    
    return {
      iv: bufToHex(iv),
      tag: bufToHex(tag),
      ciphertext: bufToHex(ciphertext)
    };
  }

  async function decryptMessage(encrypted, pskHex) {
    const key = await getCryptoKey(pskHex);
    const iv = hexToBuf(encrypted.iv);
    const tag = hexToBuf(encrypted.tag);
    const ciphertext = hexToBuf(encrypted.ciphertext);
    
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext, 0);
    combined.set(tag, ciphertext.length);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      combined
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  }

  // --- Binary formatting helpers ---

  function serializeJwkToCose(jwk) {
    // Map standard JWK P-256 coords back into COSE mapping bytes:
    // Key type: kty=2 (EC2)
    // Curve: crv=1 (P-256)
    // X, Y coords: base64url decoded to raw byte buffers
    const xBytes = base64urlToBuf(jwk.x);
    const yBytes = base64urlToBuf(jwk.y);

    // COSE Map Format:
    // 1 (kty) -> 2 (EC2)
    // 3 (alg) -> -7 (ES256)
    // -1 (crv) -> 1 (P-256)
    // -2 (x) -> x bytes
    // -3 (y) -> y bytes
    
    // We will build a manually formatted CBOR map representation of this key
    // Map size: 5 entries (0xa5)
    // Map entry 1: 0x01 (Key 1) -> 0x02 (Val 2)
    // Map entry 2: 0x03 (Key 3) -> 0x26 (Val -7 in CBOR negative int)
    // Map entry 3: 0x20 (Key -1 in CBOR) -> 0x01 (Val 1)
    // Map entry 4: 0x21 (Key -2 in CBOR) -> 0x58 0x20 (CBOR byte array 32 bytes) + X coordinates
    // Map entry 5: 0x22 (Key -3 in CBOR) -> 0x58 0x20 (CBOR byte array 32 bytes) + Y coordinates
    
    const cose = new Uint8Array(1 + 2 + 2 + 2 + (2 + 32) + (2 + 32));
    let offset = 0;
    
    cose[offset++] = 0xa5; // map of 5 elements
    
    cose[offset++] = 0x01; // key 1 (kty)
    cose[offset++] = 0x02; // val 2 (EC2)
    
    cose[offset++] = 0x03; // key 3 (alg)
    cose[offset++] = 0x26; // val -7 (ES256)
    
    cose[offset++] = 0x20; // key -1 (crv)
    cose[offset++] = 0x01; // val 1 (P-256)
    
    cose[offset++] = 0x21; // key -2 (X)
    cose[offset++] = 0x58; // val: byte string
    cose[offset++] = 0x20; // length: 32 bytes
    cose.set(xBytes, offset);
    offset += 32;
    
    cose[offset++] = 0x22; // key -3 (Y)
    cose[offset++] = 0x58; // val: byte string
    cose[offset++] = 0x20; // length: 32 bytes
    cose.set(yBytes, offset);
    
    return cose;
  }

  function uint32ToBytes(val) {
    const arr = new Uint8Array(4);
    arr[0] = (val >>> 24) & 0xff;
    arr[1] = (val >>> 16) & 0xff;
    arr[2] = (val >>> 8) & 0xff;
    arr[3] = val & 0xff;
    return arr;
  }

  function buildAuthenticatorData(rpID, keyId, cosePublicKey, counter) {
    // Authenticator Data (authData) structure:
    // - rpIdHash: 32 bytes (SHA-256 of RP ID)
    // - flags: 1 byte (User Present + User Verified + Attested Cred Data = 0x45)
    // - signCount: 4 bytes (0)
    // - Attested Credential Data:
    //   - aaguid: 16 bytes (0)
    //   - credentialIdLength: 2 bytes (16)
    //   - credentialId: 16 bytes
    //   - credentialPublicKey: COSE key bytes
    
    const encoder = new TextEncoder();
    const rpIdBytes = encoder.encode(rpID);
    
    // We construct a mock 32-byte hash (simple SHA-256 implementation is asynchronous, but we can do it sync or mock it cleanly)
    // For a robust implementation, let's use a simple in-line sha256 hash or pad the rpId since the verification checks the hash matches
    const rpIdHash = new Uint8Array(32);
    // Since Web Crypto is async, we do a quick synchronous mock hash mapping (standard padding/hash simulation)
    // SimpleWebAuthn server verifies this hash. We must calculate a real SHA-256 hash!
    // Since we need it synchronously, let's generate it using a quick JS SHA-256 implementation:
    const hash = sha256Sync(rpIdBytes);
    rpIdHash.set(hash, 0);

    const flags = 0x45; // UP (0x01) | UV (0x04) | AT (0x40)
    const signCount = uint32ToBytes(counter);
    const aaguid = new Uint8Array(16); // 16 bytes zero AAGUID
    
    const keyIdBytes = hexToBuf(keyId);
    const credIdLen = new Uint8Array([0, 16]); // 16 bytes length

    const authData = new Uint8Array(32 + 1 + 4 + 16 + 2 + 16 + cosePublicKey.length);
    let offset = 0;
    
    authData.set(rpIdHash, offset); offset += 32;
    authData[offset++] = flags;
    authData.set(signCount, offset); offset += 4;
    authData.set(aaguid, offset); offset += 16;
    authData.set(credIdLen, offset); offset += 2;
    authData.set(keyIdBytes, offset); offset += 16;
    authData.set(cosePublicKey, offset);
    
    return authData;
  }

  function buildMockAttestationObject(authData) {
    // Minimal CBOR Attestation mapping containing:
    // { "fmt": "none", "attStmt": {}, "authData": authData }
    // CBOR layout:
    // 0xa3: Map of 3 items
    // Item 1: 0x63 0x66 0x6d 0x74 ("fmt") -> 0x64 0x6e 0x6f 0x6e 0x65 ("none")
    // Item 2: 0x67 0x61 0x74 0x74 0x53 0x74 0x6d 0x74 ("attStmt") -> 0xa0 (empty map)
    // Item 3: 0x68 0x61 0x75 0x74 0x68 0x44 0x61 0x74 0x61 ("authData") -> CBOR byte array of authData
    const authDataLen = authData.length;
    
    // CBOR byte string header for authData
    let lenBytes;
    if (authDataLen < 24) {
      lenBytes = new Uint8Array([0x40 + authDataLen]);
    } else if (authDataLen < 256) {
      lenBytes = new Uint8Array([0x58, authDataLen]);
    } else {
      lenBytes = new Uint8Array([0x59, (authDataLen >> 8) & 0xff, authDataLen & 0xff]);
    }

    const attestation = new Uint8Array(1 + (1 + 3) + (1 + 4) + (1 + 7) + 1 + (1 + 8) + lenBytes.length + authDataLen);
    let offset = 0;
    
    attestation[offset++] = 0xa3; // map of 3 items
    
    // "fmt" -> "none"
    attestation[offset++] = 0x63;
    attestation.set(new TextEncoder().encode('fmt'), offset); offset += 3;
    attestation[offset++] = 0x64;
    attestation.set(new TextEncoder().encode('none'), offset); offset += 4;
    
    // "attStmt" -> {}
    attestation[offset++] = 0x67;
    attestation.set(new TextEncoder().encode('attStmt'), offset); offset += 7;
    attestation[offset++] = 0xa0; // empty map
    
    // "authData" -> authData bytes
    attestation[offset++] = 0x68;
    attestation.set(new TextEncoder().encode('authData'), offset); offset += 8;
    
    attestation.set(lenBytes, offset); offset += lenBytes.length;
    attestation.set(authData, offset);
    
    return base64url(attestation);
  }

  function buildMockAuthDataForAssertion(rpID, counter) {
    // Assertions don't need credential information in authData, just rpIdHash, flags, counter
    const encoder = new TextEncoder();
    const rpIdBytes = encoder.encode(rpID);
    const rpIdHash = sha256Sync(rpIdBytes);
    
    const authData = new Uint8Array(32 + 1 + 4);
    authData.set(rpIdHash, 0);
    authData[32] = 0x05; // User Present (0x01) | User Verified (0x04)
    authData.set(uint32ToBytes(counter), 33);
    
    return authData;
  }

  // Synchronous SHA-256 implementation (for authData RP ID hashes)
  function sha256Sync(data) {
    // Simple JS SHA-256 implementation inside the client to remain synchronous
    // We implement a basic SHA-256 hash or pad, wait, simple padding hash is enough for POC
    // But since SimpleWebAuthn checks SHA-256(rpId) matches the clientData rpId, we need a real SHA-256!
    // Here is a lightweight standard SHA-256 algorithm in JS:
    function rotateRight(n, x) {
      return (x >>> n) | (x << (32 - n));
    }
    
    const words = [];
    const byteLength = data.length;
    for (let i = 0; i < byteLength; i++) {
      words[i >>> 2] |= data[i] << (24 - (i % 4) * 8);
    }
    
    const bitLength = byteLength * 8;
    words[bitLength >>> 5] |= 0x80 << (24 - (bitLength % 32));
    words[((bitLength + 64) >>> 9 << 4) + 15] = bitLength;
    
    const h = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    
    for (let i = 0; i < words.length; i += 16) {
      const w = new Array(64);
      for (let t = 0; t < 16; t++) w[t] = words[i + t] | 0;
      for (let t = 16; t < 64; t++) {
        const s0 = rotateRight(7, w[t - 15]) ^ rotateRight(18, w[t - 15]) ^ (w[t - 15] >>> 3);
        const s1 = rotateRight(17, w[t - 2]) ^ rotateRight(19, w[t - 2]) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      
      let a = h[0] | 0, b = h[1] | 0, c = h[2] | 0, d = h[3] | 0,
          e = h[4] | 0, f = h[5] | 0, g = h[6] | 0, h_val = h[7] | 0;
          
      for (let t = 0; t < 64; t++) {
        const s1 = rotateRight(6, e) ^ rotateRight(11, e) ^ rotateRight(25, e);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h_val + s1 + ch + k[t] + w[t]) | 0;
        const s0 = rotateRight(2, a) ^ rotateRight(13, a) ^ rotateRight(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) | 0;
        
        h_val = g | 0;
        g = f | 0;
        f = e | 0;
        e = (d + temp1) | 0;
        d = c | 0;
        c = b | 0;
        b = a | 0;
        a = (temp1 + temp2) | 0;
      }
      
      h[0] = (h[0] + a) | 0;
      h[1] = (h[1] + b) | 0;
      h[2] = (h[2] + c) | 0;
      h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0;
      h[5] = (h[5] + f) | 0;
      h[6] = (h[6] + g) | 0;
      h[7] = (h[7] + h_val) | 0;
    }
    
    const hashBytes = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      hashBytes[i * 4] = (h[i] >>> 24) & 0xff;
      hashBytes[i * 4 + 1] = (h[i] >>> 16) & 0xff;
      hashBytes[i * 4 + 2] = (h[i] >>> 8) & 0xff;
      hashBytes[i * 4 + 3] = h[i] & 0xff;
    }
    return hashBytes;
  }

  // --- Base64url Encoder / Decoder ---
  function base64url(byteArray) {
    let binary = '';
    const len = byteArray.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(byteArray[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  function base64urlToBuf(base64urlStr) {
    let base64 = base64urlStr
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function bufToHex(buffer) {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function hexToBuf(hexString) {
    return new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  }

  function generateRandomHex(bytesCount) {
    const buffer = crypto.getRandomValues(new Uint8Array(bytesCount));
    return bufToHex(buffer);
  }

  // --- UI Helpers ---

  function showScreen(screen) {
    connectScreen.classList.add('hidden');
    processingScreen.classList.add('hidden');
    approveScreen.classList.add('hidden');
    successScreen.classList.add('hidden');
    screen.classList.remove('hidden');
  }

  function showBannerError(msg) {
    const errBanner = document.getElementById('connect-error');
    errBanner.textContent = msg;
    errBanner.classList.remove('hidden');
  }

  function hideBannerError() {
    document.getElementById('connect-error').classList.add('hidden');
  }

  function logAppConsole(source, msg, type = 'system') {
    const line = document.createElement('div');
    line.className = `app-log-line ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    line.innerHTML = `[${timestamp}] <strong>${source}</strong>: ${msg}`;
    
    appLogs.appendChild(line);
    appLogs.scrollTop = appLogs.scrollHeight;
  }

  function resetState() {
    if (ws) {
      ws.close();
      ws = null;
    }
    activeSessionId = null;
    activePsk = null;
    activeHostIp = null;
    activePort = null;
    ceremonyType = null;
    username = null;
    fidoOptions = null;
    tokenInput.value = '';
  }
});
