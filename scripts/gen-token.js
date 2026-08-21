/**
 * Admin tool: generate (or rotate) the auth token for an alias.
 *
 *   node scripts/gen-token.js <alias>
 *
 * Prints the plaintext token ONCE (only its hash is stored). Hand it to the user;
 * they enter <alias> + token in the website/app to unlock write capability.
 */
import Database from 'better-sqlite3';
import { randomBytes, createHash } from 'node:crypto';

const alias = (process.argv[2] || '').trim().slice(0, 128);
if (!alias) {
  console.error('Usage: node scripts/gen-token.js <alias>');
  process.exit(1);
}

const db = new Database('./cookbook.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS alias_tokens (
    alias      TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const token = randomBytes(24).toString('base64url');
const hash = createHash('sha256').update(token, 'utf8').digest('hex');
db.prepare('INSERT OR REPLACE INTO alias_tokens (alias, token_hash, created_at) VALUES (?, ?, ?)').run(
  alias,
  hash,
  Date.now()
);
db.close();

console.log(`\nToken for alias "${alias}" — store it now, it cannot be recovered:\n`);
console.log(`  ${token}\n`);
