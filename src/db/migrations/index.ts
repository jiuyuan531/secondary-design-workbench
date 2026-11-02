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
  {
    version: 3,
    name: "题库与复习：题目、复习记录（分表）、作答历史",
    sql: `
      CREATE TABLE questions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        uid             TEXT NOT NULL UNIQUE,           -- 导入导出时识别同一道题
        qtype           TEXT NOT NULL,                  -- single / multi / judge / order
        stem            TEXT NOT NULL,
        options         TEXT NOT NULL DEFAULT '[]',     -- JSON 字符串数组
        answer          TEXT NOT NULL,                  -- JSON，按题型不同
        explanation     TEXT NOT NULL DEFAULT '',
        tags            TEXT NOT NULL DEFAULT '[]',     -- JSON 字符串数组
        review_status   TEXT NOT NULL,                  -- draft / reviewed
        source          TEXT NOT NULL,                  -- manual / ai / note / builtin / import
        content_version INTEGER NOT NULL DEFAULT 1,     -- 题干、选项、答案、解析或审核状态变化时 +1
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      -- 复习记录：每道题的每个内容版本一行；active = 0 的是旧版本的历史，不参与排期
      CREATE TABLE review_records (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        content_version INTEGER NOT NULL,
        active          INTEGER NOT NULL DEFAULT 1,
        repetitions     INTEGER NOT NULL DEFAULT 0,
        interval_days   INTEGER NOT NULL DEFAULT 0,
        ease            REAL NOT NULL DEFAULT 2.5,
        due_date        TEXT NOT NULL,
        last_reviewed   TEXT NOT NULL,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX idx_review_records_q ON review_records(question_id, active);
      CREATE INDEX idx_review_records_due ON review_records(active, due_date);
      -- 每次作答一行
      CREATE TABLE review_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id       INTEGER NOT NULL REFERENCES review_records(id) ON DELETE CASCADE,
        question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        content_version INTEGER NOT NULL,
        review_date     TEXT NOT NULL,                  -- 本地日期 YYYY-MM-DD
        reviewed_at     TEXT NOT NULL,
        was_new         INTEGER NOT NULL,               -- 这次是不是第一次学
        correct         INTEGER NOT NULL,
        grade           INTEGER NOT NULL,               -- SM-2 评分 0～5
        response        TEXT NOT NULL DEFAULT 'null',   -- 作答内容（JSON）
        interval_after  INTEGER NOT NULL,
        ease_after      REAL NOT NULL
      );
      CREATE INDEX idx_review_log_date ON review_log(review_date);
    `,
  },
];

export const LATEST_DB_VERSION = MIGRATIONS.length
  ? MIGRATIONS[MIGRATIONS.length - 1].version
  : 0;
