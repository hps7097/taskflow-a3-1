// api-service/db.js
// Retained from Assessment 2 (server/db.js) and revised:
//  - uses Node's built-in node:sqlite instead of better-sqlite3, so there is no native
//    module to compile (better-sqlite3 11 would not build on Node 26)
//  - path can be set with API_DB (tests use temporary files)
//  - WAL mode so reads do not block on writes
//  - upgrades an existing A2 taskflow.db by adding the new task columns

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.API_DB || path.join(__dirname, 'taskflow.db');

function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

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

const db = addTransaction(new DatabaseSync(DB_PATH));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// An A2 database already has a tasks table without the new columns, and
// CREATE TABLE IF NOT EXISTS would skip it, so add them before the indexes are created.
const hasTasks = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get();
if (hasTasks) {
  addColumnIfMissing(db, 'tasks', 'assignee_id', 'INTEGER');
  addColumnIfMissing(db, 'tasks', 'version', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'tasks', 'updated_at', 'TEXT');
}
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

module.exports = db;
