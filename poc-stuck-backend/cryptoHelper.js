const crypto = require('crypto');

/**
 * Encrypts a plaintext string using AES-256-GCM
 * @param {string} text - Plaintext to encrypt
 * @param {string} keyHex - 256-bit key represented as a 64-character hex string
 * @returns {object} { iv, tag, ciphertext } as hex strings
 */
function encrypt(text, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Key must be 32 bytes (256-bit) hex string');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let ciphertext = cipher.update(text, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    tag: tag,
    ciphertext: ciphertext
  };
}

/**
 * Decrypts a ciphertext using AES-256-GCM
 * @param {object} encrypted - { iv, tag, ciphertext } as hex strings
 * @param {string} keyHex - 256-bit key represented as a 64-character hex string
 * @returns {string} Decrypted plaintext string
 */
function decrypt(encrypted, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Key must be 32 bytes (256-bit) hex string');
  }
  const iv = Buffer.from(encrypted.iv, 'hex');
  const tag = Buffer.from(encrypted.tag, 'hex');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};
