/**
 * 数据库备份与恢复（M1）。
 * 备份：把当前数据库完整写到用户选的位置。
 * 恢复：先检查选中的文件是不是本程序的数据库、版本是否兼容，再自动备份当前数据库，最后替换。
 */
import fs from "node:fs";
import type { SqlJsStatic } from "sql.js";
import { LATEST_DB_VERSION } from "./migrations/index";

export interface BackupCheck {
  ok: boolean;
  version?: number;
  error?: string;
  summary?: string;
}

/** 检查一个文件能否作为恢复来源。不修改文件。 */
export function inspectBackup(SQL: SqlJsStatic, filePath: string): BackupCheck {
  let db;
  try {
    db = new SQL.Database(fs.readFileSync(filePath));
    const version = Number(db.exec("PRAGMA user_version;")[0]?.values[0]?.[0] ?? 0);
    const tables = new Set((db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map((r) => String(r[0])));
    if (version < 1 || !tables.has("settings") || !tables.has("app_meta"))
      return { ok: false, error: "这个文件不是二次设计工作台的数据库备份" };
    if (version > LATEST_DB_VERSION)
      return { ok: false, version, error: `备份来自更新版本的程序（数据库版本 ${version}，当前程序支持到 ${LATEST_DB_VERSION}），请先升级程序` };
    const count = (t: string) => (tables.has(t) ? Number(db!.exec(`SELECT count(*) FROM ${t}`)[0].values[0][0]) : 0);
    const summary = `项目 ${count("projects")} 个，卷册 ${count("volumes")} 个，任务 ${count("tasks")} 个，待确认问题 ${count("issues")} 个，题目 ${count("questions")} 道`;
    return { ok: true, version, summary };
  } catch (e) {
    return { ok: false, error: `无法读取这个文件：${(e as Error).message}` };
  } finally {
    db?.close();
  }
}

export function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
