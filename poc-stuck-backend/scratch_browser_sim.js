const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');

const PORT = 3000;
const username = 'alice';

// Helper to generate random hex
function generateRandomHex(bytesCount) {
  return crypto.randomBytes(bytesCount).toString('hex');
}

// Helper to encrypt using AES-256-GCM
function encrypt(plaintext, pskHex) {
  const pskData = Buffer.from(pskHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', pskData, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return {
    iv: iv.toString('hex'),
    tag: tag,
    ciphertext: ciphertext
  };
}

// Helper to decrypt using AES-256-GCM
function decrypt(payload, pskHex) {
  const pskData = Buffer.from(pskHex, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const ciphertext = Buffer.from(payload.ciphertext, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', pskData, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Main execution
async function run() {
  const sessionId = generateRandomHex(16);
  const psk = generateRandomHex(32);
  const tokenHashInput = sessionId + psk;
  const tokenHash = crypto.createHash('sha256').update(tokenHashInput).digest('hex');

  const bypassToken = `${sessionId}:${psk}:127.0.0.1:${PORT}`;
  console.log(`\n==================================================`);
  console.log(`LIVE SESSION TOKEN FOR COPY-PASTING:`);
  console.log(`${bypassToken}`);
  console.log(`==================================================\n`);

  setTimeout(async () => {
    // 1. Fetch FIDO options from local backend
    console.log(`[Simulated Browser] Fetching registration options from backend...`);
    http.get(`http://localhost:${PORT}/api/auth/register-options?username=${username}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let options;
        try {
          options = JSON.parse(data);
        } catch (e) {
          console.error('[Simulated Browser] Failed to parse backend configuration. Retrying...', data);
          process.exit(1);
        }
        console.log(`[Simulated Browser] Received registration challenge: ${options.challenge}`);

        // 2. Connect WebSocket
        const wsUrl = `ws://localhost:${PORT}/tunnel/${sessionId}?role=browser`;
        console.log(`[Simulated Browser] Connecting WebSocket to signaling server: ${wsUrl}`);
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
          console.log(`[Simulated Browser] Connected. Initiating BLE scanning proxy...`);
          ws.send(JSON.stringify({
            event: 'start-proximity',
            tokenHash: tokenHash
          }));
        });

        ws.on('message', async (message) => {
          const payload = JSON.parse(message.toString());
          
          if (payload.event === 'peer-status') {
            console.log(`[Simulated Browser] Mobile authenticator connected status: ${payload.mobileConnected}`);
          }

          if (payload.event === 'proximity-verified') {
            console.log(`[Simulated Browser] Proximity check succeeded!`);
            
            // Encrypt and relay options
            console.log(`[Simulated Browser] Encrypting FIDO options and relaying to Mobile...`);
            const encryptedPayload = encrypt(JSON.stringify(options), psk);
            ws.send(JSON.stringify({
              event: 'relay',
              ...encryptedPayload
            }));
          }

          if (payload.ciphertext) {
            console.log(`[Simulated Browser] Received encrypted credential response from authenticator. Decrypting...`);
            try {
              const decrypted = decrypt(payload, psk);
              const credential = JSON.parse(decrypted);
              console.log(`[Simulated Browser] Decryption successful! credentialId: ${credential.id}`);

              // Submit registration verification
              console.log(`[Simulated Browser] Sending credential to backend for FIDO2 verification...`);
              const postData = JSON.stringify({ username, credential });
              const req = http.request({
                hostname: 'localhost',
                port: PORT,
                path: '/api/auth/verify-registration',
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': postData.length
                }
              }, (resVerify) => {
                let dataVerify = '';
                resVerify.on('data', chunk => dataVerify += chunk);
                resVerify.on('end', () => {
                  const result = JSON.parse(dataVerify);
                  if (result.verified) {
                    console.log(`\n🎉 🎉 🎉 🎉 [SUCCESS] PASSKEY REGISTERED SUCCESSFULLY FOR USER '${username}'! 🎉 🎉 🎉 🎉\n`);
                  } else {
                    console.error(`[ERROR] Verification rejected by server: ${result.error}`);
                  }
                  ws.close();
                  process.exit(0);
                });
              });

              req.write(postData);
              req.end();
            } catch (err) {
              console.error(`[Simulated Browser] Decryption/verification failed: ${err.message}`);
            }
          }
        });
      });
    });
  }, 1000);
}

run();
