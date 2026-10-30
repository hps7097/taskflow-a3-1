// identity-service/db.js
// Opens the identity database, applies the schema and seeds the three test accounts.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite'); // built into Node, nothing to compile

const DB_PATH = process.env.IDENTITY_DB || path.join(__dirname, 'identity.db');

const SEED_USERS = [
  { username: 'maya', display_name: 'Maya Manager', role: 'manager', password: 'manager123' },
  { username: 'sam', display_name: 'Sam Member', role: 'member', password: 'member123' },
  { username: 'priya', display_name: 'Priya Member', role: 'member', password: 'member123' },
];

// node:sqlite has no transaction() helper (better-sqlite3 did), so add one with the same shape:
// db.transaction(fn) returns a function that runs fn inside BEGIN ... COMMIT, or ROLLBACK on error.
function addTransaction(db) {
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return db;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function open() {
  const db = addTransaction(new DatabaseSync(DB_PATH));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count === 0) {
    const insert = db.prepare(
      'INSERT INTO users (username, display_name, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)'
    );
    const seed = db.transaction(() => {
      for (const u of SEED_USERS) {
        const salt = crypto.randomBytes(16).toString('hex');
        insert.run(u.username, u.display_name, u.role, salt, hashPassword(u.password, salt));
      }
    });
    seed();
  }
  return db;
}

module.exports = { open, hashPassword, DB_PATH };
