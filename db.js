const path = require('path');
const dbPath = path.join(__dirname, 'gear_inventory.db');

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
} catch (err) {
  // If better-sqlite3 C++ bindings failed to compile in the container,
  // gracefully fall back to Node v22's built-in native SQLite engine (zero compilation required).
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(dbPath);
  if (!db.transaction) {
    db.transaction = (fn) => {
      return (...args) => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          return result;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      };
    };
  }
}

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS gear_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_item_name TEXT NOT NULL,
    upgrade_level TEXT DEFAULT '+0',
    wiki_url TEXT NOT NULL,
    added_by_user_id TEXT NOT NULL,
    added_by_username TEXT NOT NULL,
    requested_by_user_id TEXT DEFAULT NULL,
    requested_by_username TEXT DEFAULT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migrate existing table if columns don't exist yet
try {
  db.exec(`ALTER TABLE gear_items ADD COLUMN requested_by_user_id TEXT DEFAULT NULL`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE gear_items ADD COLUMN requested_by_username TEXT DEFAULT NULL`);
} catch (e) {}

const addGear = db.prepare(`
  INSERT INTO gear_items (base_item_name, upgrade_level, wiki_url, added_by_user_id, added_by_username)
  VALUES (?, ?, ?, ?, ?)
`);

const getAllGear = db.prepare(`
  SELECT * FROM gear_items ORDER BY id ASC
`);

const removeGearStmt = db.prepare(`
  DELETE FROM gear_items WHERE id = ?
`);

const getGearById = db.prepare(`
  SELECT * FROM gear_items WHERE id = ?
`);

const claimGear = db.prepare(`
  UPDATE gear_items 
  SET requested_by_user_id = ?, requested_by_username = ? 
  WHERE id = ? AND (requested_by_user_id IS NULL OR requested_by_user_id = '')
`);

const withdrawGear = db.prepare(`
  UPDATE gear_items 
  SET requested_by_user_id = NULL, requested_by_username = NULL 
  WHERE id = ? AND requested_by_user_id = ?
`);

/**
 * Compact the IDs in gear_items to remain contiguous (1, 2, 3...)
 * after any item is deleted.
 */
function compactInventoryIds() {
  const compactTransaction = db.transaction(() => {
    // Read all remaining items ordered by id
    const items = db.prepare(`SELECT * FROM gear_items ORDER BY id ASC`).all();
    // Clear the table
    db.prepare(`DELETE FROM gear_items`).run();
    // Re-insert each with contiguous 1-based IDs
    const insertStmt = db.prepare(`
      INSERT INTO gear_items (id, base_item_name, upgrade_level, wiki_url, added_by_user_id, added_by_username, requested_by_user_id, requested_by_username, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    items.forEach((item, index) => {
      insertStmt.run(
        index + 1,
        item.base_item_name,
        item.upgrade_level,
        item.wiki_url,
        item.added_by_user_id,
        item.added_by_username,
        item.requested_by_user_id,
        item.requested_by_username,
        item.timestamp
      );
    });

    // Reset sqlite autoincrement sequence counter
    try {
      db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'gear_items'`).run();
      if (items.length > 0) {
        db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('gear_items', ?)`).run(items.length);
      }
    } catch (e) {
      // Ignored if sqlite_sequence is unavailable
    }
  });

  compactTransaction();
}

function removeGearById(id) {
  const result = removeGearStmt.run(id);
  if (result.changes > 0) {
    compactInventoryIds();
  }
  return result;
}

module.exports = {
  addGear: (baseName, upgrade, wikiUrl, userId, username) => 
    addGear.run(baseName, upgrade, wikiUrl, userId, username),
  getAllGear: () => getAllGear.all(),
  removeGearById,
  compactInventoryIds,
  getGearById: (id) => getGearById.get(id),
  claimGear: (id, userId, username) => claimGear.run(userId, username, id),
  withdrawGear: (id, userId) => withdrawGear.run(id, userId)
};