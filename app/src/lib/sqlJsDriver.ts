/**
 * SqlDriver backed by sql.js (synchronous SQLite compiled to WASM).
 *
 * This is what lets the app run the SAME data layer (CookbookDatabase from the
 * shared core) as the server — the server uses better-sqlite3, the app uses this.
 * sql.js is in-memory; persistence is handled by localDb.ts via export()/bytes.
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
// Vite serves the wasm as a hashed asset from the app origin (works in the
// Capacitor WebView too, since the app is served over http://localhost there).
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { SqlDriver, SqlStatement } from '@core/db/driver';

/**
 * Normalise bind params for sql.js:
 *  - better-sqlite3 accepts positional args OR a single array → flatten to array
 *  - SQLite has no `undefined`; sql.js rejects it, so map undefined → null
 *    (better-sqlite3 is lenient here, so the shared core relies on this).
 */
function bindArray(params: unknown[]): unknown[] {
  const arr = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return arr.map((v) => (v === undefined ? null : v));
}

export class SqlJsDriver implements SqlDriver {
  constructor(private readonly db: SqlJsDatabase) {}

  prepare(sql: string): SqlStatement {
    const db = this.db;
    return {
      run: (...params) => {
        db.run(sql, bindArray(params) as any);
        return { changes: db.getRowsModified() };
      },
      get: (...params) => {
        const st = db.prepare(sql);
        try {
          st.bind(bindArray(params) as any);
          return st.step() ? st.getAsObject() : undefined;
        } finally {
          st.free();
        }
      },
      all: (...params) => {
        const st = db.prepare(sql);
        try {
          st.bind(bindArray(params) as any);
          const out: any[] = [];
          while (st.step()) out.push(st.getAsObject());
          return out;
        } finally {
          st.free();
        }
      }
    };
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const db = this.db;
    return (...args: A): R => {
      db.run('BEGIN');
      try {
        const result = fn(...args);
        db.run('COMMIT');
        return result;
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    };
  }

  pragma(source: string): void {
    // No WAL in an in-memory DB; ignore journal_mode. Apply the rest (e.g.
    // foreign_keys = ON) best-effort as a real PRAGMA statement.
    if (/journal_mode/i.test(source)) return;
    try {
      this.db.run(`PRAGMA ${source}`);
    } catch {
      /* best effort */
    }
  }

  /** Serialize the whole database to bytes for persistence. */
  export(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }
}

export async function createSqlJsDriver(initialBytes?: Uint8Array): Promise<SqlJsDriver> {
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const db = new SQL.Database(initialBytes);
  return new SqlJsDriver(db);
}
