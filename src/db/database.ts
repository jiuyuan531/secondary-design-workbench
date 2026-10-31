/**
 * SQLite 数据库封装（基于 sql.js，纯 WebAssembly，无需针对 Electron 重新编译原生模块）。
 *
 * sql.js 把整个数据库放在内存里，每次写操作后由 persist() 原子写回磁盘
 * （先写临时文件再改名，避免写到一半断电导致文件损坏）。
 * 本模块只依赖 Node 的 fs/path，不依赖 Electron，便于单元测试。
 */
import fs from "node:fs";
import path from "node:path";
import type { Database, SqlJsStatic } from "sql.js";
import { MIGRATIONS, LATEST_DB_VERSION, type Migration } from "./migrations/index";

export class DbError extends Error {}

export interface MigrationReport {
  fromVersion: number;
  toVersion: number;
  applied: string[];
  backupPath?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class AppDatabase {
  readonly filePath: string;
  private db: Database;
  private SQL: SqlJsStatic;
  lastMigration?: MigrationReport;

  private constructor(SQL: SqlJsStatic, filePath: string, db: Database) {
    this.SQL = SQL;
    this.filePath = filePath;
    this.db = db;
  }

  /** 打开（不存在则创建）数据库文件，并自动执行迁移。 */
  static open(SQL: SqlJsStatic, filePath: string, migrations: Migration[] = MIGRATIONS): AppDatabase {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const exists = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
    let db: Database;
    try {
      db = exists ? new SQL.Database(fs.readFileSync(filePath)) : new SQL.Database();
      db.exec("PRAGMA foreign_keys = ON;");
      // 读一次以确认文件确实是 SQLite 数据库
      db.exec("SELECT count(*) FROM sqlite_master;");
    } catch (e) {
      throw new DbError(`无法打开数据库文件 ${filePath}：文件可能已损坏或不是本程序的数据库。(${(e as Error).message})`);
    }
    const adb = new AppDatabase(SQL, filePath, db);
    adb.lastMigration = adb.migrate(migrations, exists);
    return adb;
  }

  get version(): number {
    const r = this.db.exec("PRAGMA user_version;");
    return Number(r[0]?.values[0]?.[0] ?? 0);
  }

  /** 执行尚未执行的迁移。已有数据的旧库在迁移前自动备份。 */
  migrate(migrations: Migration[], existedBefore: boolean): MigrationReport {
    validateMigrationList(migrations);
    const latest = migrations.length ? migrations[migrations.length - 1].version : 0;
    const from = this.version;
    if (from > latest) {
      throw new DbError(
        `数据库版本（${from}）比当前程序支持的版本（${latest}）更新，可能是用更新版本的程序创建的。请升级程序后再打开，以免数据损坏。`,
      );
    }
    const pending = migrations.filter((m) => m.version > from);
    const report: MigrationReport = { fromVersion: from, toVersion: from, applied: [] };
    if (pending.length === 0) return report;

    if (existedBefore && from > 0) {
      const backupPath = `${this.filePath}.bak-v${from}-${nowIso().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(this.filePath, backupPath);
      report.backupPath = backupPath;
    }

    for (const m of pending) {
      try {
        this.db.exec("BEGIN;");
        this.db.exec(m.sql);
        this.db.exec(`PRAGMA user_version = ${m.version};`);
        this.db.exec("COMMIT;");
      } catch (e) {
        try { this.db.exec("ROLLBACK;"); } catch { /* 忽略 */ }
        throw new DbError(`数据库迁移 ${m.version}（${m.name}）失败：${(e as Error).message}`);
      }
      report.applied.push(`${m.version}: ${m.name}`);
      report.toVersion = m.version;
    }
    this.persist();
    return report;
  }

  /** 把内存中的数据库原子写回磁盘。 */
  persist(): void {
    const data = this.db.export();
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.filePath);
  }

  /** 查询，返回对象数组。 */
  all<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  /** 执行写操作（自动持久化）。多条语句需要原子执行时用 transaction()。 */
  run(sql: string, params: (string | number | null)[] = []): void {
    this.db.run(sql, params);
    this.persist();
  }

  transaction(fn: () => void): void {
    this.db.exec("BEGIN;");
    try {
      fn();
      this.db.exec("COMMIT;");
    } catch (e) {
      this.db.exec("ROLLBACK;");
      throw e;
    }
    this.persist();
  }

  /** 事务内使用的不持久化写操作 */
  runNoPersist(sql: string, params: (string | number | null)[] = []): void {
    this.db.run(sql, params);
  }

  // ---------------- 设置 ----------------
  getAllSettings(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.all<{ key: string; value: string }>("SELECT key, value FROM settings")) {
      try { out[r.key] = JSON.parse(r.value); } catch { /* 跳过损坏的值，按默认值处理 */ }
    }
    return out;
  }

  setSetting(key: string, value: unknown): void {
    this.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), nowIso()],
    );
  }

  // ---------------- 自检 ----------------
  /** 写入一行自检记录并读回，验证数据库可读写（M0 验收）。 */
  selfCheck(note = "读写自检"): { ok: boolean; totalRows: number; lastId: number; at: string } {
    const at = nowIso();
    this.run("INSERT INTO diagnostics_log (created_at, note) VALUES (?, ?)", [at, note]);
    // 从磁盘重新读一遍文件，确认这一行真的写进了文件，而不只是在内存里
    const fresh = new this.SQL.Database(fs.readFileSync(this.filePath));
    try {
      const r = fresh.exec("SELECT count(*), max(id), (SELECT created_at FROM diagnostics_log ORDER BY id DESC LIMIT 1) FROM diagnostics_log");
      const [c, m, lastAt] = r[0].values[0];
      return { ok: lastAt === at, totalRows: Number(c), lastId: Number(m), at };
    } finally {
      fresh.close();
    }
  }

  close(): void {
    this.db.close();
  }
}

export function validateMigrationList(migrations: Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new DbError(`迁移列表有误：第 ${i + 1} 个迁移的版本号应为 ${i + 1}，实际为 ${m.version}`);
    }
  });
}

export { LATEST_DB_VERSION };
