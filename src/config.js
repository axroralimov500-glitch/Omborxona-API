const fs = require('node:fs');
const path = require('node:path');

// Simple .env parser to avoid external dependencies
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ecommerce.db'),
  JWT_SECRET: process.env.JWT_SECRET || 'super-secret-jwt-key-2026-production-ready',
  TOKEN_EXPIRY_HOURS: parseInt(process.env.TOKEN_EXPIRY_HOURS || '24', 10),
  PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET || 'mock-pay-secret-key-xyz-12345',
  ORDER_RESERVATION_TTL_MINUTES: parseInt(process.env.ORDER_RESERVATION_TTL_MINUTES || '15', 10),
  CLEANUP_INTERVAL_SECONDS: parseInt(process.env.CLEANUP_INTERVAL_SECONDS || '30', 10),
};
