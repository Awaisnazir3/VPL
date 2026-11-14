const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const RAW_KEY = process.env.CIPHER_KEY || 'vpl_crm_voip_encryption_key_2026';
// Create a 32-byte key using sha256
const ENCRYPTION_KEY = crypto.createHash('sha256').update(RAW_KEY).digest();
const IV_LENGTH = 16;

function encryptPassword(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptPassword(text) {
  if (!text || !text.includes(':')) return '';
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function hashPassword(plain) {
  return await bcrypt.hash(plain, 10);
}

async function comparePassword(plain, hash) {
  return await bcrypt.compare(plain, hash);
}

module.exports = {
  encryptPassword,
  decryptPassword,
  hashPassword,
  comparePassword
};

