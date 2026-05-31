const crypto = require('crypto');
const WebSocket = require('ws');
const cryptoHelper = require('../cryptoHelper');

// We will test the cryptoHelper first
describe('E2EE Cryptography Helper (AES-256-GCM)', () => {
  const psk = crypto.randomBytes(32).toString('hex'); // 256-bit key hex

  test('should encrypt and decrypt a message successfully', () => {
    const secretMessage = 'fido2-assertion-challenge-options';
    const encrypted = cryptoHelper.encrypt(secretMessage, psk);

    expect(encrypted).toHaveProperty('iv');
    expect(encrypted).toHaveProperty('tag');
    expect(encrypted).toHaveProperty('ciphertext');

    const decrypted = cryptoHelper.decrypt(encrypted, psk);
    expect(decrypted).toBe(secretMessage);
  });

  test('should throw error when decrypting with incorrect PSK', () => {
    const secretMessage = 'sensitive-data';
    const encrypted = cryptoHelper.encrypt(secretMessage, psk);
    const badPsk = crypto.randomBytes(32).toString('hex');

    expect(() => {
      cryptoHelper.decrypt(encrypted, badPsk);
    }).toThrow();
  });

  test('should throw error when encrypted payload is tampered', () => {
    const secretMessage = 'sensitive-data';
    const encrypted = cryptoHelper.encrypt(secretMessage, psk);
    
    // Tamper with the ciphertext
    const tampered = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.substring(0, encrypted.ciphertext.length - 2) + '00'
    };

    expect(() => {
      cryptoHelper.decrypt(tampered, psk);
    }).toThrow();
  });
});

// We will test the HTTP & WebSocket server integration
describe('Relying Party Backend API & WebSocket Tunnel', () => {
  let server;
  let serverPort;
  let wsUrl;
  let httpUrl;

  const fs = require('fs');
  const path = require('path');
  const dbPath = path.join(__dirname, '../db.json');

  beforeAll((done) => {
    // Seed db.json with a mock credential for alice so login-options has a registered passkey
    const mockDb = {
      users: {},
      credentials: {
        alice: {
          credentialID: Buffer.from('mock-credential-id-bytes').toString('base64'),
          publicKey: Buffer.from('mock-public-key-bytes').toString('base64'),
          counter: 0
        }
      }
    };
    fs.writeFileSync(dbPath, JSON.stringify(mockDb, null, 2), 'utf8');

    // Start the server on an ephemeral port
    const app = require('../server');
    server = app.listen(0, () => {
      serverPort = server.address().port;
      httpUrl = `http://localhost:${serverPort}`;
      wsUrl = `ws://localhost:${serverPort}`;
      done();
    });
  });

  afterAll((done) => {
    // Clean up mock db.json
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch (e) {}
    }
    server.close(done);
  });

  test('GET /api/auth/register-options should return WebAuthn options', async () => {
    const res = await fetch(`${httpUrl}/api/auth/register-options?username=alice`);
    expect(res.status).toBe(200);
    const options = await res.json();
    
    expect(options).toHaveProperty('challenge');
    expect(options).toHaveProperty('rp');
    expect(options.rp.name).toBe('FIDO Passkey PoC Portal');
    expect(options).toHaveProperty('user');
    expect(options.user.name).toBe('alice');
  });

  test('GET /api/auth/login-options should return WebAuthn login assertion options', async () => {
    const res = await fetch(`${httpUrl}/api/auth/login-options?username=alice`);
    expect(res.status).toBe(200);
    const options = await res.json();

    expect(options).toHaveProperty('challenge');
    expect(options).toHaveProperty('rpId');
  });

  test('WebSocket Signaling Tunnel should relay messages between Browser and Mobile with simulated proximity check', (done) => {
    const sessionId = crypto.randomBytes(16).toString('hex');
    const browserClient = new WebSocket(`${wsUrl}/tunnel/${sessionId}?role=browser`);
    let mobileClient;

    browserClient.on('open', () => {
      // Connect mobile with device-type=simulator to trigger automated simulated proximity check
      mobileClient = new WebSocket(`${wsUrl}/tunnel/${sessionId}?role=mobile&device-type=simulator`);

      mobileClient.on('open', () => {
        // Log connection
      });

      mobileClient.on('message', (message) => {
        const payload = JSON.parse(message.toString());

        // 2. Receive relayed challenge from browser and respond
        if (payload.event === 'relay' && payload.data === 'hello') {
          mobileClient.send(JSON.stringify({ event: 'relay', data: 'signed' }));
        }
      });
    });

    browserClient.on('message', (message) => {
      const payload = JSON.parse(message.toString());

      // 1. Wait until proximity check is verified
      if (payload.event === 'proximity-verified') {
        // Send a relay message from browser to mobile
        browserClient.send(JSON.stringify({ event: 'relay', data: 'hello' }));
        return;
      }

      // 3. Receive relayed assertion from mobile and complete
      if (payload.event === 'relay' && payload.data === 'signed') {
        browserClient.close();
        mobileClient.close();
        done();
      }
    });
  });
});
