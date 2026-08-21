/**
 * Server SqlDriver backed by better-sqlite3 (synchronous native SQLite).
 * Nearly a pass-through: better-sqlite3 already exposes exactly this API shape,
 * so wrapping it costs nothing and keeps the shared data layer driver-agnostic.
 */
import Database from 'better-sqlite3';
import type { SqlDriver, SqlStatement } from './driver';

export class BetterSqlite3Driver implements SqlDriver {
  readonly raw: Database.Database;

  constructor(path: string = './cookbook.db') {
    this.raw = new Database(path);
  }

  prepare(sql: string): SqlStatement {
    const st = this.raw.prepare(sql);
    return {
      run: (...params) => st.run(...(params as any[])),
      get: (...params) => st.get(...(params as any[])),
      all: (...params) => st.all(...(params as any[]))
    };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return this.raw.transaction(fn as any) as unknown as (...args: A) => R;
  }

  pragma(source: string): void {
    this.raw.pragma(source);
  }

  close(): void {
    this.raw.close();
  }
}
