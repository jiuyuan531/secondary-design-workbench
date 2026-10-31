import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { AppDatabase, DbError } from "../database";
import { MIGRATIONS, type Migration } from "../migrations/index";

let SQL: SqlJsStatic;
let dir: string;
beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-db-")); });

describe("数据库初始化与迁移", () => {
  it("新建数据库会执行全部迁移并写入文件", () => {
    const f = path.join(dir, "sub", "a.db");
    const db = AppDatabase.open(SQL, f);
    expect(db.version).toBe(MIGRATIONS.length);
    expect(db.lastMigration?.applied.length).toBe(MIGRATIONS.length);
    expect(db.lastMigration?.backupPath).toBeUndefined();
    expect(fs.existsSync(f)).toBe(true);
  });

  it("再次打开不重复迁移，数据保留", () => {
    const f = path.join(dir, "a.db");
    const db1 = AppDatabase.open(SQL, f);
    db1.setSetting("sim.maxTicks", 300);
    db1.close();
    const db2 = AppDatabase.open(SQL, f);
    expect(db2.lastMigration?.applied).toEqual([]);
    expect(db2.getAllSettings()["sim.maxTicks"]).toBe(300);
  });

  it("旧库升级前自动备份，并按顺序执行新增迁移", () => {
    const f = path.join(dir, "a.db");
    AppDatabase.open(SQL, f, MIGRATIONS.slice(0, 1)).close();
    const extra: Migration = { version: MIGRATIONS.length + 1, name: "测试新增表", sql: "CREATE TABLE t_extra (id INTEGER);" };
    const db = AppDatabase.open(SQL, f, [...MIGRATIONS, extra]);
    expect(db.version).toBe(extra.version);
    expect(db.lastMigration?.backupPath).toBeTruthy();
    expect(fs.existsSync(db.lastMigration!.backupPath!)).toBe(true);
    expect(db.all("SELECT name FROM sqlite_master WHERE name = 't_extra'").length).toBe(1);
  });

  it("迁移失败时回滚，版本号不变", () => {
    const f = path.join(dir, "a.db");
    AppDatabase.open(SQL, f).close();
    const bad: Migration = { version: MIGRATIONS.length + 1, name: "错误迁移", sql: "CREATE TABLE ok1 (id INTEGER); THIS IS NOT SQL;" };
    expect(() => AppDatabase.open(SQL, f, [...MIGRATIONS, bad])).toThrow(DbError);
    const db = AppDatabase.open(SQL, f);
    expect(db.version).toBe(MIGRATIONS.length);
    expect(db.all("SELECT name FROM sqlite_master WHERE name = 'ok1'").length).toBe(0);
  });

  it("数据库版本比程序新时拒绝打开", () => {
    const f = path.join(dir, "a.db");
    const extra: Migration = { version: MIGRATIONS.length + 1, name: "未来", sql: "SELECT 1;" };
    AppDatabase.open(SQL, f, [...MIGRATIONS, extra]).close();
    expect(() => AppDatabase.open(SQL, f)).toThrow(/比当前程序支持的版本/);
  });

  it("迁移版本号必须连续", () => {
    const f = path.join(dir, "a.db");
    expect(() => AppDatabase.open(SQL, f, [{ version: 2, name: "x", sql: "" }])).toThrow(/版本号应为 1/);
  });

  it("损坏的文件给出中文错误", () => {
    const f = path.join(dir, "bad.db");
    fs.writeFileSync(f, "这不是数据库".repeat(100));
    expect(() => AppDatabase.open(SQL, f)).toThrow(/无法打开数据库文件/);
  });

  it("读写自检会从磁盘文件读回刚写入的记录", () => {
    const f = path.join(dir, "a.db");
    const db = AppDatabase.open(SQL, f);
    const r1 = db.selfCheck();
    const r2 = db.selfCheck();
    expect(r1.ok && r2.ok).toBe(true);
    expect(r2.totalRows).toBe(2);
    expect(fs.readdirSync(dir).filter((x) => x.includes(".tmp")).length).toBe(0);
  });
});
