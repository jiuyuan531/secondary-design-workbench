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
  {
    version: 2,
    name: "项目看板：项目、卷册、任务、待确认问题及来源",
    sql: `
      CREATE TABLE projects (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        voltage_level TEXT,
        project_type  TEXT NOT NULL,
        status        TEXT NOT NULL,
        folder_path   TEXT,
        start_date    TEXT,
        due_date      TEXT,
        notes         TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE TABLE volumes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        drawing_no  TEXT,
        revision    TEXT,
        status      TEXT NOT NULL,
        due_date    TEXT,
        notes       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_volumes_project ON volumes(project_id);
      CREATE TABLE tasks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        volume_id   INTEGER REFERENCES volumes(id) ON DELETE SET NULL,
        content     TEXT NOT NULL,
        status      TEXT NOT NULL,
        priority    TEXT NOT NULL,
        due_date    TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_tasks_project ON tasks(project_id);
      CREATE TABLE issues (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        volume_id      INTEGER REFERENCES volumes(id) ON DELETE SET NULL,
        description    TEXT NOT NULL,
        info_nature    TEXT NOT NULL,
        has_conflict   INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL,
        confirmed_by   TEXT,
        confirmed_date TEXT,
        conclusion     TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_issues_project ON issues(project_id);
      -- 问题的来源：一条问题可有多个来源，矛盾时分别记下两边说法
      CREATE TABLE issue_sources (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        reference   TEXT NOT NULL DEFAULT '',  -- 文件名、页码或图号
        statement   TEXT NOT NULL DEFAULT ''   -- 这个来源的说法
      );
      CREATE INDEX idx_issue_sources_issue ON issue_sources(issue_id);
    `,
  },
];

export const LATEST_DB_VERSION = MIGRATIONS.length
  ? MIGRATIONS[MIGRATIONS.length - 1].version
  : 0;
