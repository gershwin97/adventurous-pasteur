const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
require('dotenv').config();

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const app = express();
app.use(express.json());

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, '../browser')));

// Serve the mobile simulator PWA at /mobile
app.use('/mobile', express.static(path.join(__dirname, '../mobile/simulator')));

// Simple JSON Database layer
const dbPath = path.join(__dirname, 'db.json');
function getDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ users: {}, credentials: {} }, null, 2));
  }
  try {
    const content = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    return { users: {}, credentials: {} };
  }
}

function saveDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

// In-memory challenge store mapped by userId
const challengeStore = new Map();

// Session mappings for the WS tunnel: sessionId -> { browserSocket, mobileSocket, expectedTokenHash, proximityVerified }
const tunnels = new Map();

// Dynamic Helper: Compile swift scanner CLI on startup if running in standalone mode
function compileSwiftScanner() {
  const swiftFile = path.join(__dirname, 'ble_scanner.swift');
  const binaryFile = path.join(__dirname, 'ble_scanner');
  
  console.log(`[Scanner] Compiling macOS Swift BLE helper: ${swiftFile}...`);
  try {
    execSync(`swiftc "${swiftFile}" -o "${binaryFile}"`);
    console.log('[Scanner] Compilation successful. Native BLE scanner ready.');
  } catch (err) {
    console.error('[Scanner] Compilation failed. Ensure Xcode CLI tools are installed:', err.message);
  }
}

// Helper to extract hostname (RP ID) dynamically
function getRpId(req) {
  const host = req.get('host') || 'localhost';
  return host.split(':')[0];
}

// Helper to extract origin dynamically
function getOrigin(req) {
  const protocol = req.secure ? 'https' : 'http';
  return `${protocol}://${req.get('host')}`;
}

// Helper to get all allowed origins and RP IDs for FIDO validation
function getAllowedOriginsAndRpIds(req) {
  const reqOrigin = getOrigin(req);
  const reqRpId = getRpId(req);
  
  const origins = [reqOrigin, 'http://localhost:3000', 'http://127.0.0.1:3000'];
  const rpIds = [reqRpId, 'localhost', '127.0.0.1'];
  
  const networkInterfaces = require('os').networkInterfaces();
  for (const name in networkInterfaces) {
    const interfaces = networkInterfaces[name];
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        origins.push(`http://${iface.address}:3000`);
        origins.push(`https://${iface.address}:3000`);
        rpIds.push(iface.address);
      }
    }
  }
  return { origins, rpIds };
}

// Config route to determine server local network IP address dynamically
app.get('/api/config', (req, res) => {
  const networkInterfaces = require('os').networkInterfaces();
  let localIp = 'localhost';
  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
  }
  res.json({ localIp, port: process.env.PORT || 3000 });
});

// --- FIDO2 WebAuthn Rest Endpoints ---

// 1. Generate Registration Options
app.get('/api/auth/register-options', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'Username query parameter is required' });
  }

  const rpID = getRpId(req);
  
  try {
    const options = await generateRegistrationOptions({
      rpName: 'FIDO Passkey PoC Portal',
      rpID: rpID,
      userID: username,
      userName: username,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });

    challengeStore.set(username, options.challenge);
    res.json(options);
  } catch (err) {
    console.error('Error generating registration options:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Verify Registration Response
app.post('/api/auth/verify-registration', async (req, res) => {
  const { username, credential } = req.body;
  if (!username || !credential) {
    return res.status(400).json({ error: 'Missing username or credential in body' });
  }

  const expectedChallenge = challengeStore.get(username);
  if (!expectedChallenge) {
    return res.status(400).json({ error: 'No active registration challenge found for user' });
  }

  const { origins, rpIds } = getAllowedOriginsAndRpIds(req);

  try {
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpIds,
    });

    if (verification.verified) {
      const { registrationInfo } = verification;
      const { credentialPublicKey, credentialID } = registrationInfo;

      // Persist credential in db.json
      const db = getDb();
      db.credentials[username] = {
        credentialID: Buffer.from(credentialID).toString('base64'),
        publicKey: Buffer.from(credentialPublicKey).toString('base64'),
        counter: registrationInfo.counter || 0,
      };
      saveDb(db);

      challengeStore.delete(username);
      res.json({ verified: true });
    } else {
      res.status(400).json({ verified: false, error: 'Registration verification failed' });
    }
  } catch (err) {
    console.error('Error verifying registration response:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Generate Login Assertion Options
app.get('/api/auth/login-options', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'Username query parameter is required' });
  }

  const db = getDb();
  const userCredential = db.credentials[username];
  if (!userCredential) {
    return res.status(404).json({ error: 'No passkey registered for this user' });
  }

  const rpID = getRpId(req);

  try {
    const options = await generateAuthenticationOptions({
      rpID: rpID,
      allowCredentials: [
        {
          id: Buffer.from(userCredential.credentialID, 'base64'),
          type: 'public-key',
          transports: ['hybrid'],
        },
      ],
      userVerification: 'preferred',
    });

    challengeStore.set(username, options.challenge);
    res.json(options);
  } catch (err) {
    console.error('Error generating login options:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Verify Assertion Signature
app.post('/api/auth/verify-assertion', async (req, res) => {
  const { username, assertion } = req.body;
  if (!username || !assertion) {
    return res.status(400).json({ error: 'Missing username or assertion response' });
  }

  const expectedChallenge = challengeStore.get(username);
  if (!expectedChallenge) {
    return res.status(400).json({ error: 'No active login challenge found for user' });
  }

  const db = getDb();
  const userCredential = db.credentials[username];
  if (!userCredential) {
    return res.status(400).json({ error: 'No registered credential found for user' });
  }

  const { origins, rpIds } = getAllowedOriginsAndRpIds(req);

  try {
    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpIds,
      authenticator: {
        credentialID: Buffer.from(userCredential.credentialID, 'base64'),
        credentialPublicKey: Buffer.from(userCredential.publicKey, 'base64'),
        counter: userCredential.counter,
      },
    });

    if (verification.verified) {
      // Update counter
      userCredential.counter = verification.authenticationInfo.newCounter;
      db.credentials[username] = userCredential;
      saveDb(db);

      challengeStore.delete(username);
      res.json({ verified: true });
    } else {
      res.status(400).json({ verified: false, error: 'Signature verification failed' });
    }
  } catch (err) {
    console.error('Error verifying login response:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create Server
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Attach WS to HTTP server upgrade event
server.on('upgrade', (request, socket, head) => {
  const pathname = request.url.split('?')[0];
  if (pathname.startsWith('/tunnel/')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// --- WebSocket Tunnel Relay with BLE Proximity Check ---

wss.on('connection', (ws, request) => {
  const urlParts = request.url.split('?');
  const pathParts = urlParts[0].split('/');
  const sessionId = pathParts[2];
  const queryParams = new URLSearchParams(urlParts[1] || '');
  const role = queryParams.get('role') || 'mobile'; // "browser" or "mobile", default to mobile
  const deviceType = queryParams.get('device-type'); // "simulator" if mobile simulator

  if (!sessionId) {
    ws.close(1008, 'Missing sessionId');
    return;
  }

  console.log(`[Tunnel] Client connected to session ${sessionId}. Role: ${role}. Device: ${deviceType || 'unknown'}`);

  // Fetch or initialize session context
  let session = tunnels.get(sessionId);
  if (!session) {
    session = {
      browserSocket: null,
      mobileSocket: null,
      expectedTokenHash: null,
      proximityVerified: false,
      scannerProcess: null,
      timeoutTimer: null,
    };
    tunnels.set(sessionId, session);
  }

  // Set timeout to prune abandoned sessions (2 minutes)
  if (!session.timeoutTimer) {
    session.timeoutTimer = setTimeout(() => {
      console.log(`[Tunnel] Session ${sessionId} timed out.`);
      cleanupSession(sessionId);
    }, 120000);
  }

  // Assign socket roles
  if (role === 'browser') {
    session.browserSocket = ws;
  } else if (role === 'mobile') {
    session.mobileSocket = ws;
  }

  // Notify peer if both are connected
  notifyClientsConnectionState(session);

  // If mobile is simulator and bypass is configured, auto-verify proximity
  if (role === 'mobile' && deviceType === 'simulator' && process.env.ALLOW_SIMULATED_BLE === 'true') {
    console.log(`[Proximity] Mobile is running in Simulator mode. Triggering simulated BLE proximity check...`);
    setTimeout(() => {
      if (tunnels.has(sessionId)) {
        const activeSession = tunnels.get(sessionId);
        activeSession.proximityVerified = true;
        console.log(`[Proximity] Simulated BLE check passed for session ${sessionId} (RSSI: -65dBm).`);
        sendToBoth(activeSession, JSON.stringify({ event: 'proximity-verified', simulated: true }));
        cleanupScanner(activeSession);
      }
    }, 1500);
  }

  ws.on('message', (message) => {
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch (e) {
      return; // Ignore malformed JSON
    }

    // 1. Proximity Trigger from Browser
    if (payload.event === 'start-proximity' && role === 'browser') {
      const tokenHash = payload.tokenHash;
      session.expectedTokenHash = tokenHash;
      console.log(`[Proximity] Browser initiated proximity scanning for token: ${tokenHash}`);

      // Check if already simulated by mobile PWA
      if (session.proximityVerified) {
        return; // Already verified by simulator bridge
      }

      // If mobile simulator bypass is requested dynamically by query param or config
      if (process.env.ALLOW_SIMULATED_BLE === 'true' && (deviceType === 'simulator' || queryParams.get('simulate') === 'true')) {
        session.proximityVerified = true;
        sendToBoth(session, JSON.stringify({ event: 'proximity-verified', simulated: true }));
        return;
      }

      // Start actual Swift BLE Proximity scan
      startPhysicalBleScanner(sessionId, tokenHash);
    }

    // 2. Encryption Relay (Browser <-> Mobile)
    if (payload.event === 'relay' || payload.ciphertext) {
      // Relay messages only if proximity is verified
      if (!session.proximityVerified) {
        ws.send(JSON.stringify({ event: 'error', message: 'BLE proximity verification required before relaying payloads' }));
        return;
      }

      const targetSocket = (role === 'browser') ? session.mobileSocket : session.browserSocket;
      if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
        targetSocket.send(JSON.stringify(payload));
      } else {
        ws.send(JSON.stringify({ event: 'error', message: 'Peer is disconnected' }));
      }
    }
  });

  ws.on('close', () => {
    console.log(`[Tunnel] Client disconnected from session ${sessionId}. Role: ${role}`);
    if (role === 'browser') session.browserSocket = null;
    if (role === 'mobile') session.mobileSocket = null;

    if (!session.browserSocket && !session.mobileSocket) {
      // Cleanup if both clients left
      cleanupSession(sessionId);
    }
  });
});

function notifyClientsConnectionState(session) {
  const browserConnected = session.browserSocket && session.browserSocket.readyState === WebSocket.OPEN;
  const mobileConnected = session.mobileSocket && session.mobileSocket.readyState === WebSocket.OPEN;

  const statusMsg = JSON.stringify({
    event: 'peer-status',
    browserConnected,
    mobileConnected
  });

  sendToBoth(session, statusMsg);
}

function sendToBoth(session, message) {
  if (session.browserSocket && session.browserSocket.readyState === WebSocket.OPEN) {
    session.browserSocket.send(message);
  }
  if (session.mobileSocket && session.mobileSocket.readyState === WebSocket.OPEN) {
    session.mobileSocket.send(message);
  }
}

function startPhysicalBleScanner(sessionId, tokenHash) {
  const session = tunnels.get(sessionId);
  if (!session) return;

  // Prune any existing scanner process for this session
  if (session.scannerProcess) {
    try { session.scannerProcess.kill(); } catch (e) {}
  }

  const binaryPath = path.join(__dirname, 'ble_scanner');
  if (!fs.existsSync(binaryPath)) {
    console.log(`[Scanner] BLE Scanner binary not found. Standardizing on compilation...`);
    compileSwiftScanner();
  }

  console.log(`[Scanner] Spawning native macOS Swift BLE scanner for token hash: ${tokenHash}`);
  
  const threshold = parseInt(process.env.PROXIMITY_RSSI_THRESHOLD || '-75', 10);
  const scanner = spawn(binaryPath, [tokenHash]);
  session.scannerProcess = scanner;

  scanner.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) {
          console.error(`[Scanner Error] ${parsed.error}`);
          sendToBoth(session, JSON.stringify({ event: 'proximity-error', error: parsed.error }));
          cleanupScanner(session);
          return;
        }

        console.log(`[Scanner Result] Found target hash: ${parsed.hash} | RSSI: ${parsed.rssi} dBm`);
        
        if (parsed.rssi >= threshold) {
          session.proximityVerified = true;
          console.log(`[Proximity] Physical proximity verified successfully (RSSI ${parsed.rssi} dBm >= ${threshold} dBm).`);
          sendToBoth(session, JSON.stringify({ event: 'proximity-verified', rssi: parsed.rssi, simulated: false }));
          cleanupScanner(session);
        }
      } catch (err) {
        // Fallback for non-JSON lines
        console.log(`[Scanner Stdout] ${line}`);
      }
    }
  });

  scanner.on('close', (code) => {
    console.log(`[Scanner] Scanner child process closed with exit code: ${code}`);
    if (code === 1 && !session.proximityVerified) {
      console.log(`[Proximity] Physical scan timed out for session ${sessionId}.`);
      sendToBoth(session, JSON.stringify({ event: 'proximity-timeout' }));
    } else if (code === 2) {
      sendToBoth(session, JSON.stringify({ event: 'proximity-error', error: 'Bluetooth permission denied on host machine' }));
    }
  });
}

function cleanupScanner(session) {
  if (session.scannerProcess) {
    try { session.scannerProcess.kill(); } catch (e) {}
    session.scannerProcess = null;
  }
}

function cleanupSession(sessionId) {
  const session = tunnels.get(sessionId);
  if (session) {
    cleanupScanner(session);
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    if (session.browserSocket) try { session.browserSocket.close(); } catch(e){}
    if (session.mobileSocket) try { session.mobileSocket.close(); } catch(e){}
    tunnels.delete(sessionId);
  }
}

// Compile on startup if this file is run directly (not required as a module in tests)
if (require.main === module) {
  compileSwiftScanner();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` FIDO Passkey RP & Tunnel Server running on:`);
    console.log(` - Browser Portal: http://localhost:${PORT}`);
    console.log(` - Mobile Simulator: http://localhost:${PORT}/mobile`);
    console.log(`======================================================\n`);
  });
}

module.exports = server;
