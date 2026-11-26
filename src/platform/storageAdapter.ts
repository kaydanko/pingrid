/**
 * Storage abstraction. Native builds use SQLite via tauri-plugin-sql; the
 * web build uses IndexedDB, falling back to localStorage when IDB is
 * unavailable (private mode in some browsers).
 */
import { isTauri } from './env';
import type { Resource } from '../types';

export interface StorageAdapter {
  readonly kind: 'sqlite' | 'indexeddb' | 'localstorage';
  loadResources(): Promise<Resource[]>;
  saveResources(list: Resource[]): Promise<void>;
  getKV<T>(key: string): Promise<T | undefined>;
  setKV<T>(key: string, value: T): Promise<void>;
  clear(): Promise<void>;
}

/* ---------------------------- SQLite (Tauri) ---------------------------- */

type SqlDb = {
  select<T>(q: string, b?: unknown[]): Promise<T>;
  execute(q: string, b?: unknown[]): Promise<unknown>;
};

class SqliteStorage implements StorageAdapter {
  readonly kind = 'sqlite' as const;
  /**
   * tauri-plugin-sql runs every call on a pooled connection, so a
   * BEGIN/COMMIT pair split across calls can land on different connections
   * and leave a transaction open that SQLite rolls back on exit. Every write
   * here is therefore one self-committing statement, and writes are queued
   * so they never interleave.
   */
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private db: SqlDb) {}

  private write<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  static async open(): Promise<SqliteStorage> {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    // Migrations are registered in src-tauri/src/lib.rs; repeat the DDL here
    // defensively so a DB opened by an older build is never missing tables.
    const db = (await Database.load('sqlite:pingrid.db')) as unknown as SqlDb;
    await db.execute(
      'CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)',
    );
    await db.execute('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    return new SqliteStorage(db);
  }

  async loadResources(): Promise<Resource[]> {
    const rows = await this.db.select<{ data: string }[]>('SELECT data FROM resources ORDER BY position ASC');
    return rows.flatMap((r) => {
      try {
        return [JSON.parse(r.data) as Resource];
      } catch {
        return [];
      }
    });
  }

  saveResources(list: Resource[]): Promise<void> {
    return this.write(async () => {
      if (!list.length) {
        await this.db.execute('DELETE FROM resources');
        return;
      }
      // 1. Upsert every row in one statement (3 bound params per row; SQLite
      //    allows 32766, so ~10k resources).
      const values = list.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
      await this.db.execute(
        `INSERT INTO resources (id, position, data) VALUES ${values}
         ON CONFLICT(id) DO UPDATE SET position = excluded.position, data = excluded.data`,
        list.flatMap((r, i) => [r.id, i, JSON.stringify(r)]),
      );
      // 2. Then drop rows that are gone. A crash between 1 and 2 leaves an
      //    extra row, never a missing one.
      const ids = list.map((_, i) => `$${i + 1}`).join(', ');
      await this.db.execute(`DELETE FROM resources WHERE id NOT IN (${ids})`, list.map((r) => r.id));
    });
  }

  async getKV<T>(key: string): Promise<T | undefined> {
    const rows = await this.db.select<{ value: string }[]>('SELECT value FROM kv WHERE key = $1', [key]);
    if (!rows.length) return undefined;
    try {
      return JSON.parse(rows[0].value) as T;
    } catch {
      return undefined;
    }
  }

  setKV<T>(key: string, value: T): Promise<void> {
    return this.write(async () => {
      await this.db.execute(
        'INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, JSON.stringify(value)],
      );
    });
  }

  clear(): Promise<void> {
    return this.write(async () => {
      await this.db.execute('DELETE FROM resources');
      await this.db.execute('DELETE FROM kv');
    });
  }
}

/* ------------------------------ IndexedDB ------------------------------ */

const IDB_NAME = 'pingrid';
const STORE = 'kv';
const RES_KEY = '__resources';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

class IndexedDbStorage implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  private constructor(private db: IDBDatabase) {}

  static open(): Promise<IndexedDbStorage> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(new IndexedDbStorage(r.result));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async loadResources() {
    return ((await req(this.store('readonly').get(RES_KEY))) as Resource[] | undefined) ?? [];
  }
  async saveResources(list: Resource[]) {
    await req(this.store('readwrite').put(structuredClone(list), RES_KEY));
  }
  async getKV<T>(key: string) {
    return (await req(this.store('readonly').get(key))) as T | undefined;
  }
  async setKV<T>(key: string, value: T) {
    await req(this.store('readwrite').put(structuredClone(value), key));
  }
  async clear() {
    await req(this.store('readwrite').clear());
  }
}

/* ----------------------------- localStorage ----------------------------- */

class LocalStorageStorage implements StorageAdapter {
  readonly kind = 'localstorage' as const;
  private k = (key: string) => `pingrid:${key}`;
  async loadResources() {
    return (await this.getKV<Resource[]>(RES_KEY)) ?? [];
  }
  async saveResources(list: Resource[]) {
    await this.setKV(RES_KEY, list);
  }
  async getKV<T>(key: string) {
    const raw = localStorage.getItem(this.k(key));
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  async setKV<T>(key: string, value: T) {
    localStorage.setItem(this.k(key), JSON.stringify(value));
  }
  async clear() {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('pingrid:'))
      .forEach((k) => localStorage.removeItem(k));
  }
}

let instance: Promise<StorageAdapter> | null = null;

export function getStorage(): Promise<StorageAdapter> {
  if (!instance) {
    instance = (async (): Promise<StorageAdapter> => {
      if (isTauri) return SqliteStorage.open();
      if (typeof indexedDB !== 'undefined') {
        try {
          return await IndexedDbStorage.open();
        } catch (e) {
          console.warn('[pingrid] IndexedDB unavailable, using localStorage', e);
        }
      }
      return new LocalStorageStorage();
    })();
  }
  return instance;
}
