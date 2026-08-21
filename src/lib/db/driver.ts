/**
 * Minimal SQLite driver abstraction shared by the server and the standalone app.
 *
 * The cookbook data layer (CookbookDatabase) talks only to this interface, so the
 * same query logic runs on better-sqlite3 (Node server) and on sql.js (synchronous
 * WASM, in the app's WebView) — one implementation, no drift. The surface mirrors
 * the subset of better-sqlite3 that the data layer actually uses (verified: prepare
 * + run/get/all with positional `?` params, exec, transaction, pragma, close — no
 * iterate/pluck/raw/named-params/lastInsertRowid).
 */
export interface SqlRunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult;
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface SqlDriver {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  /** Wrap `fn` so its statements run in a single transaction (commit/rollback). */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  pragma(source: string): void;
  close(): void;
}
