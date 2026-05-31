// Relying Party Front-End Logic
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const authPanel = document.getElementById('auth-panel');
  const ceremonyPanel = document.getElementById('ceremony-panel');
  const dashboardPanel = document.getElementById('dashboard-panel');
  
  const usernameInput = document.getElementById('username');
  const btnRegister = document.getElementById('btn-register');
  const btnLogin = document.getElementById('btn-login');
  const btnCancel = document.getElementById('btn-cancel');
  const btnLogout = document.getElementById('btn-logout');
  const btnCopyToken = document.getElementById('btn-copy-token');
  
  const bypassTokenCode = document.getElementById('bypass-token');
  const consoleLogs = document.getElementById('console-logs');
  const authError = document.getElementById('auth-error');
  const userDisplay = document.getElementById('user-display');
  const rpDisplay = document.getElementById('rp-display');
  
  const statusBrowser = document.getElementById('status-browser');
  const statusMobile = document.getElementById('status-mobile');
  const statusProximity = document.getElementById('status-proximity');
  const proximityText = document.getElementById('proximity-text');

  // State Variables
  let activeSessionId = null;
  let activePsk = null;
  let activeTokenHash = null;
  let ws = null;
  let serverConfig = null; // Fetched from backend: { localIp, port }
  let ceremonyType = null; // 'registration' or 'login'
  let pendingFidoOptions = null; // Saved options to encrypt and send after BLE check

  // Check for Secure Context / Crypto API Availability
  const secureWarning = document.getElementById('secure-context-warning');
  const isSecureContext = window.crypto && window.crypto.subtle;
  if (!isSecureContext) {
    if (secureWarning) {
      secureWarning.classList.remove('hidden');
      
      // Dynamically set current URL/port suggestions
      const port = window.location.port || '3000';
      const bypassCode = document.getElementById('current-origin-bypass');
      if (bypassCode) {
        bypassCode.textContent = `http://${window.location.hostname}:${port}`;
      }
      const suggestedLink = document.getElementById('suggested-link');
      if (suggestedLink) {
        suggestedLink.href = `http://127.0.0.1:${port}`;
        suggestedLink.textContent = `http://127.0.0.1:${port}`;
      }
    }
    
    // Disable action buttons
    btnRegister.disabled = true;
    btnLogin.disabled = true;
    btnRegister.style.opacity = '0.5';
    btnRegister.style.cursor = 'not-allowed';
    btnLogin.style.opacity = '0.5';
    btnLogin.style.cursor = 'not-allowed';
  }

  // 1. Fetch server config on load
  const ipSelect = document.getElementById('ip-select');

  fetch('/api/config')
    .then(res => res.json())
    .then(config => {
      serverConfig = config;
      populateIpSelect(config);
      
      // Dynamically update the LAN IP suggestion in the warning banner
      const detectedLanIp = document.getElementById('detected-lan-ip');
      if (detectedLanIp && config.ipAddresses && config.ipAddresses.length > 0) {
        const enIp = config.ipAddresses.find(ip => ip.name.startsWith('en')) || config.ipAddresses[0];
        detectedLanIp.textContent = enIp.address;
      }
    })
    .catch(err => {
      showError('Failed to fetch server IP configuration. Is backend running?');
    });

  function populateIpSelect(config) {
    ipSelect.innerHTML = '';
    
    // Add dynamically detected IPs from the server
    if (config.ipAddresses && config.ipAddresses.length > 0) {
      config.ipAddresses.forEach(ip => {
        const option = document.createElement('option');
        option.value = ip.address;
        option.textContent = `${ip.address} (${ip.name})`;
        ipSelect.appendChild(option);
      });
    }
    
    // Add localhost fallback
    const localhostOption = document.createElement('option');
    localhostOption.value = '127.0.0.1';
    localhostOption.textContent = '127.0.0.1 (localhost)';
    ipSelect.appendChild(localhostOption);
    
    // Determine default selected IP based on the browser's URL address
    const currentHost = window.location.hostname;
    let foundDefault = false;
    for (let i = 0; i < ipSelect.options.length; i++) {
      if (ipSelect.options[i].value === currentHost) {
        ipSelect.selectedIndex = i;
        foundDefault = true;
        break;
      }
    }
    
    // Fallback: If current host is localhost/127.0.0.1 and we have a Wi-Fi or Ethernet IP, select it
    if (!foundDefault && (currentHost === 'localhost' || currentHost === '127.0.0.1')) {
      const enIndex = config.ipAddresses.findIndex(ip => ip.name.startsWith('en'));
      if (enIndex !== -1) {
        ipSelect.selectedIndex = enIndex;
      } else if (config.ipAddresses.length > 0) {
        ipSelect.selectedIndex = 0;
      }
    }

    logConsole('Config', `Server connection IP selected: ${ipSelect.value}:${config.port}`, 'system');
  }

  function renderQrAndToken(username) {
    const hostIp = ipSelect.value || window.location.hostname;
    const port = serverConfig ? serverConfig.port : window.location.port;
    
    // 1. Generate Bypass Session Token (SessionID:PSK:HostIP:Port:Username:CeremonyType)
    const bypassToken = `${activeSessionId}:${activePsk}:${hostIp}:${port}:${username}:${ceremonyType}`;
    bypassTokenCode.textContent = bypassToken;

    // 2. Render QR Code (Contains tunnel URL & PSK)
    const tunnelUrl = `ws://${hostIp}:${port}/tunnel/${activeSessionId}`;
    const qrPayload = JSON.stringify({
      sessionId: activeSessionId,
      psk: activePsk,
      tunnelUrl: tunnelUrl,
      username: username,
      type: ceremonyType
    });

    const canvas = document.getElementById('qr-canvas');
    QRCode.toCanvas(canvas, qrPayload, { width: 220, margin: 1 }, (err) => {
      if (err) {
        console.error(err);
        logConsole('QR', 'Error generating QR code canvas', 'error');
      } else {
        document.getElementById('qr-loading').style.display = 'none';
      }
    });
  }

  // --- Event Listeners ---

  btnRegister.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (!username) return showError('Please enter a username');
    hideError();
    ceremonyType = 'registration';
    
    logConsole('Auth', `Requesting registration options for: ${username}...`, 'system');
    try {
      const res = await fetch(`/api/auth/register-options?username=${encodeURIComponent(username)}`);
      if (!res.ok) throw new Error(await res.text());
      pendingFidoOptions = await res.json();
      
      startCeremony(username);
    } catch (err) {
      showError(`Error: ${err.message}`);
    }
  });

  btnLogin.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (!username) return showError('Please enter a username');
    hideError();
    ceremonyType = 'login';

    logConsole('Auth', `Requesting login options for: ${username}...`, 'system');
    try {
      const res = await fetch(`/api/auth/login-options?username=${encodeURIComponent(username)}`);
      if (!res.ok) throw new Error(await res.text());
      pendingFidoOptions = await res.json();

      startCeremony(username);
    } catch (err) {
      showError(`Error: ${err.message}`);
    }
  });

  btnCancel.addEventListener('click', () => {
    logConsole('Ceremony', 'Ceremony cancelled by user.', 'warning');
    cancelCeremony();
  });

  btnLogout.addEventListener('click', () => {
    logConsole('Auth', 'Logged out.', 'system');
    showPanel(authPanel);
    usernameInput.value = '';
  });

  btnCopyToken.addEventListener('click', () => {
    navigator.clipboard.writeText(bypassTokenCode.textContent);
    const originalText = btnCopyToken.textContent;
    btnCopyToken.textContent = 'Copied!';
    setTimeout(() => {
      btnCopyToken.textContent = originalText;
    }, 1500);
  });

  // --- Ceremony Flow & WebSockets ---

  async function startCeremony(username) {
    showPanel(ceremonyPanel);
    document.getElementById('ceremony-title').textContent = ceremonyType === 'registration' ? 'Registering Passkey' : 'Logging In';
    document.getElementById('qr-loading').style.display = 'flex';
    clearLogs();

    // Reset status dots
    setStatusDot(statusBrowser, 'yellow');
    setStatusDot(statusMobile, 'red');
    setStatusDot(statusProximity, 'red');
    proximityText.textContent = 'BLE Proximity';

    // 1. Generate ephemeral session keys
    activeSessionId = generateRandomHex(16);
    activePsk = generateRandomHex(32);
    activeTokenHash = await calculateTokenHash(activeSessionId, activePsk);

    // Derive 4-digit numeric verification code synchronously from activePsk
    const verificationCode = String(parseInt(activePsk.substring(0, 8), 16) % 10000).padStart(4, '0');
    const verificationCodeEl = document.getElementById('verification-code');
    if (verificationCodeEl) {
      verificationCodeEl.textContent = verificationCode;
    }

    // 2. Generate Bypass Session Token and QR Code dynamically based on selected IP
    renderQrAndToken(username);

    // Regenerate QR/token dynamically if user switches IP
    ipSelect.onchange = () => {
      renderQrAndToken(username);
      logConsole('Config', `Regenerated QR code targeting IP: ${ipSelect.value}`, 'system');
    };

    logConsole('Crypto', `Session initialized. SessionID: ${activeSessionId.substring(0,8)}...`, 'crypto');
    logConsole('Crypto', `Pre-Shared Key (PSK) generated client-side.`, 'crypto');

    // 4. Establish WebSocket to signaling server
    const localWsUrl = `ws://${window.location.host}/tunnel/${activeSessionId}?role=browser`;
    ws = new WebSocket(localWsUrl);

    ws.onopen = () => {
      setStatusDot(statusBrowser, 'green');
      logConsole('Tunnel', 'WebSocket connected to local signaling server.', 'system');
      
      // Start proximity scanning by sending hash
      ws.send(JSON.stringify({
        event: 'start-proximity',
        tokenHash: activeTokenHash
      }));
      setStatusDot(statusProximity, 'yellow');
      proximityText.textContent = 'Scanning BLE...';
      logConsole('Proximity', 'Swift BLE Scanner spawned on backend. Scanning CoreBluetooth...', 'system');
    };

    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      // Proximity Verified
      if (msg.event === 'proximity-verified') {
        setStatusDot(statusProximity, 'green');
        proximityText.textContent = msg.simulated ? 'Proximity Mocked' : `Proximity Verified (${msg.rssi} dBm)`;
        logConsole('Proximity', msg.simulated ? 'BLE Proximity verification mocked (Simulator Bypass).' : `BLE Proximity verified! RSSI: ${msg.rssi} dBm. Device is nearby.`, 'success');
      }

      // Proximity Error/Timeout
      if (msg.event === 'proximity-error') {
        setStatusDot(statusProximity, 'red');
        proximityText.textContent = 'BLE Error';
        logConsole('Proximity', `Error: ${msg.error}`, 'error');
      }

      if (msg.event === 'proximity-timeout') {
        setStatusDot(statusProximity, 'red');
        proximityText.textContent = 'BLE Timeout';
        logConsole('Proximity', 'BLE scanning timed out after 10s. Authenticator not found.', 'error');
      }

      // Peer connection status
      if (msg.event === 'peer-status') {
        setStatusDot(statusMobile, msg.mobileConnected ? 'green' : 'red');
        if (msg.mobileConnected) {
          logConsole('Tunnel', 'Mobile client connected to WebSocket tunnel.', 'system');
          // Encrypt and send FIDO options immediately so mobile can show approval screen
          encryptAndSendFidoOptions(username);
        } else {
          logConsole('Tunnel', 'Mobile client disconnected.', 'warning');
        }
      }

      // Relay payload (Response from Authenticator)
      if (msg.event === 'relay' || msg.ciphertext) {
        logConsole('Crypto', 'Received encrypted response from authenticator. Decrypting...', 'crypto');
        try {
          const decryptedJson = await decryptMessage(msg, activePsk);
          const responsePayload = JSON.parse(decryptedJson);
          
          logConsole('Crypto', 'Decryption successful. Submitting signature to Relying Party server...', 'success');
          
          if (ceremonyType === 'registration') {
            submitRegistration(username, responsePayload);
          } else {
            submitAssertion(username, responsePayload);
          }
        } catch (err) {
          logConsole('Crypto', `Decryption / processing error: ${err.message}`, 'error');
        }
      }
    };

    ws.onclose = () => {
      setStatusDot(statusBrowser, 'red');
      logConsole('Tunnel', 'WebSocket connection closed.', 'warning');
    };
  }

  async function encryptAndSendFidoOptions(username) {
    logConsole('Crypto', `Encrypting WebAuthn options using AES-256-GCM...`, 'crypto');
    try {
      const payloadOptions = {
        ...pendingFidoOptions,
        username: username
      };
      const payloadString = JSON.stringify(payloadOptions);
      const encrypted = await encryptMessage(payloadString, activePsk);
      
      logConsole('Tunnel', 'Sending encrypted payload to Authenticator over WebSocket...', 'system');
      ws.send(JSON.stringify({
        event: 'relay',
        ...encrypted
      }));
    } catch (err) {
      logConsole('Crypto', `Encryption error: ${err.message}`, 'error');
    }
  }

  async function submitRegistration(username, credential) {
    try {
      const res = await fetch('/api/auth/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, credential })
      });
      
      const result = await res.json();
      if (result.verified) {
        logConsole('Auth', 'Passkey verified and registered successfully on Server!', 'success');
        setTimeout(() => completeCeremony(username), 1000);
      } else {
        throw new Error(result.error || 'Server rejected passkey credentials');
      }
    } catch (err) {
      logConsole('Auth', `Registration validation failed: ${err.message}`, 'error');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'relay', error: err.message }));
      }
    }
  }

  async function submitAssertion(username, assertion) {
    try {
      const res = await fetch('/api/auth/verify-assertion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, assertion })
      });

      const result = await res.json();
      if (result.verified) {
        logConsole('Auth', 'Passkey signature verified successfully! Authenticated.', 'success');
        setTimeout(() => completeCeremony(username), 1000);
      } else {
        throw new Error(result.error || 'Server signature verification failed');
      }
    } catch (err) {
      logConsole('Auth', `Login validation failed: ${err.message}`, 'error');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'relay', error: err.message }));
      }
    }
  }

  function completeCeremony(username) {
    cancelWebSocket();
    userDisplay.textContent = username;
    rpDisplay.textContent = window.location.hostname;
    showPanel(dashboardPanel);
  }

  function cancelCeremony() {
    cancelWebSocket();
    showPanel(authPanel);
  }

  function cancelWebSocket() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  // --- Helper Cryptography Functions (Web Crypto API) ---

  async function getCryptoKey(pskHex) {
    const rawKey = new Uint8Array(pskHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
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

  async function calculateTokenHash(sessionId, psk) {
    const encoder = new TextEncoder();
    const data = encoder.encode(sessionId + psk);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function generateRandomHex(bytesCount) {
    const buffer = crypto.getRandomValues(new Uint8Array(bytesCount));
    return bufToHex(buffer);
  }

  function bufToHex(buffer) {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function hexToBuf(hexString) {
    return new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  }

  // --- UI Helpers ---

  function showPanel(panel) {
    authPanel.classList.add('hidden');
    ceremonyPanel.classList.add('hidden');
    dashboardPanel.classList.add('hidden');
    panel.classList.remove('hidden');
  }

  function showError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  function hideError() {
    authError.classList.add('hidden');
  }

  function setStatusDot(dotElement, colorClass) {
    dotElement.className = 'status-dot';
    dotElement.classList.add(colorClass);
  }

  function clearLogs() {
    consoleLogs.innerHTML = '';
  }

  function logConsole(source, msg, type = 'system') {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    line.innerHTML = `[${timestamp}] <strong>${source}</strong>: ${msg}`;
    
    consoleLogs.appendChild(line);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }
});
