const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let dbInstance = null;

function getDatabase() {
  if (dbInstance) return dbInstance;

  const dbDir = path.dirname(config.DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new DatabaseSync(config.DB_PATH);

  // Enable WAL mode for high concurrency read/write
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');
  dbInstance.exec('PRAGMA foreign_keys = ON;');

  // Check if tables exist, if not run migrations and seed
  initSchema(dbInstance);

  return dbInstance;
}

function initSchema(db) {
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'").get();
  
  if (!tableCheck) {
    const migrationPath = path.resolve(__dirname, '..', 'migrations.sql');
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      db.exec(sql);
      console.log('Database schema migrated successfully.');
    }

    const seedPath = path.resolve(__dirname, '..', 'seed.sql');
    if (fs.existsSync(seedPath)) {
      const seedSql = fs.readFileSync(seedPath, 'utf8');
      db.exec(seedSql);
      console.log('Database seeded with demo data.');
    }
  }
}

// Transaction helper using BEGIN IMMEDIATE to prevent write race conditions
function withTransaction(callback) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rbError) {
      // rollback error ignore
    }
    throw error;
  }
}

module.exports = {
  getDatabase,
  withTransaction
};
