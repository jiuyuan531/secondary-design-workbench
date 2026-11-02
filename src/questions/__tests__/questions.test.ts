import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { AppDatabase } from "../../db/database";
import * as repo from "../repo";
import { sm2, SM2_START, addDays } from "../sm2";
import { normalizeQuestion, isCorrect, answerText } from "../model";
import { exportQuestions, parseQuestionFile } from "../format";

let SQL: SqlJsStatic;
let db: AppDatabase;
beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-q-"));
  db = AppDatabase.open(SQL, path.join(dir, "a.db"));
});

const S: repo.ReviewSettings = { newPerDay: 10, maxReviewsPerDay: 100, includeDrafts: false };
const single = (extra = {}) => repo.createQuestion(db, {
  qtype: "single", stem: "串联型防跳中，防跳继电器电流线圈串在哪个回路？", options: ["合闸回路", "跳闸回路", "信号回路"],
  answer: 1, explanation: "示例解析", tags: ["防跳"], review_status: "reviewed", source: "manual", ...extra,
});

describe("SM-2", () => {
  it("记住时间隔 1、6、再乘难度因子；没记住清零", () => {
    let s = sm2(SM2_START, 4);
    expect(s).toEqual({ repetitions: 1, interval: 1, ease: 2.5 });
    s = sm2(s, 4);
    expect(s.interval).toBe(6);
    s = sm2(s, 5);
    expect(s.interval).toBe(15); // 6 × 2.5
    expect(s.ease).toBe(2.6);
    s = sm2(s, 1);
    expect(s.repetitions).toBe(0);
    expect(s.interval).toBe(1);
    expect(s.ease).toBeGreaterThanOrEqual(1.3);
  });
  it("难度因子最低 1.3", () => {
    let s = SM2_START;
    for (let i = 0; i < 20; i++) s = sm2(s, 0);
    expect(s.ease).toBe(1.3);
  });
  it("日期加天数", () => { expect(addDays("2026-12-30", 3)).toBe("2027-01-02"); });
});

describe("题目校验与判分", () => {
  it("各题型的答案写法", () => {
    expect(normalizeQuestion({ qtype: "single", stem: "x", options: ["a", "b"], answer: "B" as never }).answer).toBe(1);
    expect(normalizeQuestion({ qtype: "multi", stem: "x", options: ["a", "b", "c"], answer: "CA" as never }).answer).toEqual([0, 2]);
    expect(normalizeQuestion({ qtype: "judge", stem: "x", answer: "错" as never }).answer).toBe(false);
    expect(normalizeQuestion({ qtype: "order", stem: "x", options: ["a", "b", "c"] }).answer).toEqual([0, 1, 2]);
    expect(() => normalizeQuestion({ qtype: "single", stem: "x", options: ["a"], answer: 0 })).toThrow(/至少要有 2 个选项/);
    expect(() => normalizeQuestion({ qtype: "single", stem: "", options: ["a", "b"], answer: 0 })).toThrow(/题干不能为空/);
    expect(() => normalizeQuestion({ qtype: "order", stem: "x", options: ["a", "b"], answer: [0, 0] })).toThrow(/各列一次/);
  });
  it("判对错：多选不看顺序，排序要看顺序", () => {
    expect(isCorrect({ qtype: "multi", answer: [0, 2] }, [2, 0])).toBe(true);
    expect(isCorrect({ qtype: "order", answer: [2, 0, 1] }, [0, 2, 1])).toBe(false);
    expect(isCorrect({ qtype: "judge", answer: true }, true)).toBe(true);
    expect(answerText({ qtype: "order", answer: [1, 0], options: ["甲", "乙"] })).toBe("B. 乙 → A. 甲");
  });
});

describe("复习排期", () => {
  it("新题进今日队列，答对后排到明天；草稿题不参与（设置可改）", () => {
    const q = single();
    single({ review_status: "draft", stem: "草稿题" });
    let t = repo.todayQueue(db, "2026-11-02", S);
    expect(t.fresh.map((x) => x.id)).toEqual([q.id]);
    expect(t.draftsExcluded).toBe(1);
    expect(repo.todayQueue(db, "2026-11-02", { ...S, includeDrafts: true }).fresh).toHaveLength(2);

    const r = repo.answerQuestion(db, q.id, 1, 4, "2026-11-02");
    expect(r).toMatchObject({ correct: true, was_new: true, interval: 1, due_date: "2026-11-03" });
    t = repo.todayQueue(db, "2026-11-02", S);
    expect(t.fresh).toHaveLength(0);
    expect(t.doneToday.fresh).toBe(1);
    expect(repo.todayQueue(db, "2026-11-03", S).due.map((x) => x.id)).toEqual([q.id]);
  });

  it("答错时评分按没记住处理，第二天还要复习", () => {
    const q = single();
    const r = repo.answerQuestion(db, q.id, 0, 5, "2026-11-02");
    expect(r.correct).toBe(false);
    expect(r.grade).toBeLessThanOrEqual(2);
    expect(r.due_date).toBe("2026-11-03");
  });

  it("每日新题上限、复习上限", () => {
    for (let i = 0; i < 5; i++) single({ stem: `题 ${i}` });
    expect(repo.todayQueue(db, "2026-11-02", { ...S, newPerDay: 3 }).fresh).toHaveLength(3);
    repo.answerQuestion(db, 1, 1, 4, "2026-11-02");
    repo.answerQuestion(db, 2, 1, 4, "2026-11-02");
    expect(repo.todayQueue(db, "2026-11-02", { ...S, newPerDay: 3 }).fresh).toHaveLength(1);
    expect(repo.todayQueue(db, "2026-11-03", { ...S, maxReviewsPerDay: 1 }).due).toHaveLength(1);
  });

  it("一轮复习：几天里反复作答，间隔逐步拉长", () => {
    const q = single();
    let day = "2026-11-02";
    const intervals: number[] = [];
    for (let i = 0; i < 4; i++) {
      expect(repo.todayQueue(db, day, S).fresh.length + repo.todayQueue(db, day, S).due.length).toBe(1);
      const r = repo.answerQuestion(db, q.id, 1, 4, day);
      intervals.push(r.interval);
      day = r.due_date;
    }
    expect(intervals).toEqual([1, 6, 15, 38]);
  });
});

describe("修改题目后复习进度重置（固定规则）", () => {
  it("改题干：内容版本号 +1，旧记录变历史，按新题重新开始", () => {
    const q = single();
    repo.answerQuestion(db, q.id, 1, 4, "2026-11-02");
    const r = repo.updateQuestion(db, q.id, { stem: "改过的题干" });
    expect(r.progressReset).toBe(true);
    expect(r.question.content_version).toBe(2);
    expect(repo.listQuestions(db)[0].progress).toBeNull();
    expect(repo.todayQueue(db, "2026-11-02", S).fresh.map((x) => x.id)).toEqual([q.id]);
    const hist = db.all<{ active: number; content_version: number }>("SELECT active, content_version FROM review_records");
    expect(hist).toEqual([{ active: 0, content_version: 1 }]);
    // 改完再答：新记录对应新版本
    repo.answerQuestion(db, q.id, 1, 4, "2026-11-02");
    expect(db.all("SELECT content_version FROM review_records WHERE active = 1")).toEqual([{ content_version: 2 }]);
  });

  it("改选项、答案、解析、审核状态都会重置；只改标签不重置", () => {
    const q = single();
    const fields: Record<string, unknown>[] = [{ options: ["合闸回路", "跳闸回路", "信号回路", "电压回路"] }, { answer: 0 }, { explanation: "新解析" }, { review_status: "draft" }];
    let v = 1;
    for (const f of fields) {
      repo.answerQuestion(db, q.id, repo.getQuestion(db, q.id).answer, 4, "2026-11-02");
      const r = repo.updateQuestion(db, q.id, f);
      expect(r.progressReset, JSON.stringify(f)).toBe(true);
      expect(r.question.content_version).toBe(++v);
    }
    repo.answerQuestion(db, q.id, repo.getQuestion(db, q.id).answer, 4, "2026-11-02");
    const r = repo.updateQuestion(db, q.id, { tags: ["防跳", "控制回路"] });
    expect(r.progressReset).toBe(false);
    expect(r.question.content_version).toBe(v);
    expect(repo.listQuestions(db)[0].progress).not.toBeNull();
  });

  it("批量审核：草稿改为已审核也算重新审核", () => {
    const q = single({ review_status: "draft" });
    repo.answerQuestion(db, q.id, 1, 4, "2026-11-02");
    expect(repo.setReviewStatus(db, [q.id], "reviewed")).toEqual({ changed: 1, progressReset: 1 });
    expect(repo.setReviewStatus(db, [q.id], "reviewed")).toEqual({ changed: 0, progressReset: 0 });
  });

  it("删除题目时复习记录和作答历史一并删除", () => {
    const q = single();
    repo.answerQuestion(db, q.id, 1, 4, "2026-11-02");
    repo.deleteQuestions(db, [q.id]);
    expect(db.all("SELECT * FROM review_records")).toEqual([]);
    expect(db.all("SELECT * FROM review_log")).toEqual([]);
  });
});

describe("JSON 导入导出", () => {
  const file = JSON.stringify({ schemaVersion: 1, kind: "questions", questions: [
    { uid: "u1", type: "单选", stem: "TWJ 是什么继电器？", options: ["合闸位置继电器", "跳闸位置继电器"], answer: "B", reviewStatus: "已审核", tags: ["控制回路"] },
    { uid: "u2", type: "多选", stem: "多选题", options: ["a", "b", "c"], answer: ["A", "C"] },
    { type: "判断", stem: "判断题", answer: "对" },
    { type: "排序", stem: "排序题", options: ["第一步", "第二步", "第三步"] },
    { type: "单选", stem: "坏题", options: ["a"], answer: "A" },
  ] });

  it("预览：新题、格式错误逐条列出", () => {
    expect(repo.previewImport(db, file)).toEqual({ total: 5, fresh: 4, same: 0, changed: 0, invalid: [{ index: 5, error: "单选题至少要有 2 个选项" }] });
  });

  it("导入后可以复习，导出再导入内容不变", () => {
    expect(repo.applyImport(db, file, false)).toEqual({ added: 4, updated: 0, progressReset: 0, skipped: 1 });
    const qs = repo.listQuestions(db);
    expect(qs.map((q) => q.review_status)).toEqual(["reviewed", "draft", "draft", "draft"]);
    expect(qs[0].source).toBe("import");
    const out = exportQuestions(qs, "2026-11-02T00:00:00Z");
    const back = parseQuestionFile(out).map((x) => x.input);
    expect(back).toEqual(qs.map(({ qtype, stem, options, answer, explanation, tags, review_status, source }) => ({ qtype, stem, options, answer, explanation, tags, review_status, source })));
    expect(repo.previewImport(db, out)).toMatchObject({ fresh: 0, same: 4, changed: 0 });
  });

  it("同一 uid 内容不同：勾选更新才覆盖，并按规则重置进度", () => {
    repo.applyImport(db, file, false);
    repo.answerQuestion(db, 1, 1, 4, "2026-11-02");
    const changed = file.replace("TWJ 是什么继电器？", "TWJ 的中文名称是？");
    expect(repo.previewImport(db, changed)).toMatchObject({ changed: 1, same: 1, fresh: 2 });
    expect(repo.applyImport(db, changed, false).updated).toBe(0);
    expect(repo.getQuestion(db, 1).stem).toBe("TWJ 是什么继电器？");
    expect(repo.applyImport(db, changed, true)).toMatchObject({ updated: 1, progressReset: 1 });
    expect(repo.getQuestion(db, 1).content_version).toBe(2);
  });

  it("文件整体不对时给出中文错误", () => {
    expect(() => repo.previewImport(db, "{")).toThrow(/不是合法的 JSON/);
    expect(() => repo.previewImport(db, '{"kind":"circuits"}')).toThrow(/不是题目文件/);
    expect(() => repo.previewImport(db, '{"schemaVersion":9,"questions":[]}')).toThrow(/请先升级程序/);
  });
});

describe("内置示例题", () => {
  it("全部合法，全部是草稿、来源为内置示例", () => {
    for (const f of fs.readdirSync("data/seed/questions").filter((x) => x.endsWith(".json"))) {
      const items = parseQuestionFile(fs.readFileSync(path.join("data/seed/questions", f), "utf8"));
      expect(items.filter((x) => x.error), f).toEqual([]);
      for (const x of items) expect([x.input!.review_status, x.input!.source, !!x.uid]).toEqual(["draft", "builtin", true]);
    }
  });
});
