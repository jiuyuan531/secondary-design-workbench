import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { AppDatabase } from "../../db/database";
import * as repo from "../repo";
import { inspectBackup } from "../../db/backup";
import type { IssueRow } from "../model";

let SQL: SqlJsStatic;
let db: AppDatabase;
let dir: string;
beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-board-"));
  db = AppDatabase.open(SQL, path.join(dir, "a.db"));
});

const newProject = (extra: Record<string, unknown> = {}) =>
  repo.create(db, "project", { name: "某某 110kV 变电站备自投改造", voltage_level: "110kV", project_type: "retrofit", status: "active", ...extra });

describe("项目看板增删改查", () => {
  it("新建、读取、更新、删除项目", () => {
    const p = newProject();
    expect(p.id).toBe(1);
    expect(p.status).toBe("active");
    const u = repo.update(db, "project", 1, { notes: "备注", due_date: "2026-12-01" });
    expect(u.notes).toBe("备注");
    expect(u.name).toBe("某某 110kV 变电站备自投改造");
    repo.remove(db, "project", 1);
    expect(repo.list(db, "project")).toEqual([]);
  });

  it("必填项、枚举值、日期格式校验给出中文错误", () => {
    expect(() => repo.create(db, "project", { project_type: "retrofit", status: "active" })).toThrow(/项目名称.*不能为空/);
    expect(() => newProject({ project_type: "xx" })).toThrow(/项目类型.*取值无效/);
    expect(() => newProject({ due_date: "2026/12/01" })).toThrow(/日期格式/);
  });

  it("任务的卷册必须属于同一项目", () => {
    const p1 = newProject();
    const p2 = newProject({ name: "另一个项目" });
    const v = repo.create(db, "volume", { project_id: p1.id, name: "二次线", status: "drawing" });
    expect(() => repo.create(db, "task", { project_id: p2.id, volume_id: v.id, content: "x", status: "todo", priority: "high" }))
      .toThrow(/不属于所选项目/);
  });

  it("删除项目时一并删除卷册、任务、问题和问题来源；删除卷册时任务保留", () => {
    const p = newProject();
    const v = repo.create(db, "volume", { project_id: p.id, name: "保护", status: "drawing" });
    const t = repo.create(db, "task", { project_id: p.id, volume_id: v.id, content: "画图", status: "todo", priority: "high" });
    repo.create(db, "issue", { project_id: p.id, description: "q", info_nature: "to_confirm", status: "open",
      sources: [{ source_type: "vendor", reference: "说明书 p12", statement: "" }] });
    expect(repo.deleteImpact(db, "project", Number(p.id))).toEqual(["1 个卷册", "1 个任务", "1 个待确认问题"]);
    repo.remove(db, "volume", Number(v.id));
    expect(repo.get(db, "task", Number(t.id)).volume_id).toBeNull();
    repo.remove(db, "project", Number(p.id));
    expect(db.all("SELECT * FROM tasks").length).toBe(0);
    expect(db.all("SELECT * FROM issue_sources").length).toBe(0);
  });
});

describe("待确认问题", () => {
  it("区分信息性质和来源类型，并记录矛盾的两边说法", () => {
    const p = newProject();
    const i = repo.create(db, "issue", {
      project_id: p.id,
      description: "备自投跳闸出口是否经压板",
      info_nature: "cross_inference",
      has_conflict: true,
      status: "open",
      sources: [
        { source_type: "vendor", reference: "厂家说明书 p.23", statement: "说法 A" },
        { source_type: "design_site", reference: "原施工图 第5张", statement: "说法 B" },
      ],
    }) as IssueRow;
    expect(i.info_nature).toBe("cross_inference");
    expect(i.has_conflict).toBe(1);
    expect(i.sources.map((s) => s.source_type)).toEqual(["vendor", "design_site"]);
    expect(i.sources[1].statement).toBe("说法 B");
  });

  it("有矛盾时至少两个来源且都要写说法", () => {
    const p = newProject();
    const base = { project_id: p.id, description: "d", info_nature: "to_confirm", has_conflict: true, status: "open" };
    expect(() => repo.create(db, "issue", { ...base, sources: [{ source_type: "vendor", reference: "a", statement: "x" }] }))
      .toThrow(/至少要填两个来源/);
    expect(() => repo.create(db, "issue", { ...base, sources: [
      { source_type: "vendor", reference: "a", statement: "x" },
      { source_type: "template", reference: "b", statement: "" },
    ] })).toThrow(/每个来源都要写明/);
  });

  it("来源必须选类型、填引用", () => {
    const p = newProject();
    const base = { project_id: p.id, description: "d", info_nature: "to_confirm", status: "open" };
    expect(() => repo.create(db, "issue", { ...base, sources: [{ source_type: "", reference: "a", statement: "" }] })).toThrow(/来源类型/);
    expect(() => repo.create(db, "issue", { ...base, sources: [{ source_type: "vendor", reference: "", statement: "x" }] })).toThrow(/来源引用/);
  });

  it("已确认必须填确认人、日期、结论；更新时不传来源则保留原来源", () => {
    const p = newProject();
    const i = repo.create(db, "issue", { project_id: p.id, description: "d", info_nature: "to_confirm", status: "open",
      sources: [{ source_type: "vendor", reference: "r", statement: "" }] });
    expect(() => repo.update(db, "issue", Number(i.id), { status: "confirmed" })).toThrow(/确认人、确认日期、结论/);
    const u = repo.update(db, "issue", Number(i.id), { status: "confirmed", confirmed_by: "设总", confirmed_date: "2026-11-02", conclusion: "按 A 做" }) as IssueRow;
    expect(u.status).toBe("confirmed");
    expect(u.sources.length).toBe(1);
  });
});

describe("仪表盘", () => {
  it("列出 14 天内到期和已逾期的未完成卷册/任务，以及各项目未解决问题数", () => {
    const p = newProject();
    repo.create(db, "volume", { project_id: p.id, name: "逾期卷册", status: "drawing", due_date: "2026-10-25" });
    repo.create(db, "volume", { project_id: p.id, name: "已出图", status: "issued", due_date: "2026-11-01" });
    repo.create(db, "volume", { project_id: p.id, name: "很远", status: "drawing", due_date: "2027-03-01" });
    repo.create(db, "task", { project_id: p.id, content: "收资", status: "todo", priority: "high", due_date: "2026-11-05" });
    repo.create(db, "task", { project_id: p.id, content: "已完成", status: "done", priority: "high", due_date: "2026-11-05" });
    repo.create(db, "issue", { project_id: p.id, description: "a", info_nature: "to_confirm", status: "open" });
    repo.create(db, "issue", { project_id: p.id, description: "b", info_nature: "to_confirm", status: "submitted" });
    repo.create(db, "issue", { project_id: p.id, description: "c", info_nature: "to_confirm", status: "confirmed",
      confirmed_by: "x", confirmed_date: "2026-10-30", conclusion: "y" });
    const d = repo.dashboard(db, "2026-10-31");
    expect(d.upcoming.map((u) => u.title)).toEqual(["逾期卷册", "收资"]);
    expect(d.upcoming[0].days_left).toBe(-6);
    expect(d.openIssuesByProject).toEqual([{ project_id: p.id, project_name: p.name, open: 1, submitted: 1, conflicts: 0 }]);
    expect(d.totals.openIssues).toBe(2);
  });
});

describe("备份与恢复", () => {
  it("备份文件能被识别并完整恢复", () => {
    const p = newProject();
    repo.create(db, "volume", { project_id: p.id, name: "保护", status: "drawing" });
    const backup = path.join(dir, "backup.db");
    fs.copyFileSync(db.filePath, backup);
    const check = inspectBackup(SQL, backup);
    expect(check.ok).toBe(true);
    expect(check.summary).toContain("项目 1 个，卷册 1 个");
    // 模拟误删后恢复
    repo.remove(db, "project", Number(p.id));
    db.close();
    fs.copyFileSync(backup, path.join(dir, "a.db"));
    const db2 = AppDatabase.open(SQL, path.join(dir, "a.db"));
    expect(repo.list(db2, "volume").map((v) => v.name)).toEqual(["保护"]);
  });

  it("拒绝不是本程序数据库的文件", () => {
    const other = new SQL.Database();
    other.exec("CREATE TABLE x (a); PRAGMA user_version = 1;");
    const f = path.join(dir, "other.db");
    fs.writeFileSync(f, other.export());
    expect(inspectBackup(SQL, f).ok).toBe(false);
    fs.writeFileSync(path.join(dir, "junk.db"), "junk");
    expect(inspectBackup(SQL, path.join(dir, "junk.db")).ok).toBe(false);
  });
});
