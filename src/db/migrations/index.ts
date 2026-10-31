/**
 * 数据库表结构迁移（AGENTS.md 第 5 节）。
 *
 * 规则：
 * - 每个迁移有唯一递增的 version，从 1 开始，不能跳号。
 * - 已发布的迁移不再修改；要改表结构就新增一个迁移。
 * - 当前数据库版本记录在 SQLite 的 PRAGMA user_version 里。
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "初始化：设置表、元信息表、自检记录表",
    sql: `
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,           -- JSON 编码的值
        updated_at TEXT NOT NULL
      );
      CREATE TABLE app_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      -- 数据库读写自检（M0 验收用）：每点一次“读写自检”写一行
      CREATE TABLE diagnostics_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        note       TEXT NOT NULL
      );
    `,
  },
];

export const LATEST_DB_VERSION = MIGRATIONS.length
  ? MIGRATIONS[MIGRATIONS.length - 1].version
  : 0;
