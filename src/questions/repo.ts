/**
 * 题库与复习的数据库操作（AGENTS.md 2.3 节）。
 *
 * - 题目在 questions 表，复习进度在 review_records 表（分表），每次作答记在 review_log；
 * - 题干、选项、答案、解析任一改动，或审核状态变化：内容版本号 +1，旧复习记录标为历史（active = 0），
 *   这道题按新题重新开始；只改标签不算修改。这一条固定执行，不做成设置项；
 * - 删除题目时复习记录和作答历史一并删除（外键级联）。
 */
import type { AppDatabase } from "../db/database";
import {
  normalizeQuestion, contentKey, isCorrect, QuestionError,
  type Question, type QuestionInput, type QType, type ReviewStatus,
} from "./model";
import { sm2, addDays, SM2_START } from "./sm2";
import { parseQuestionFile, type ParsedItem } from "./format";

interface QuestionRow {
  id: number; uid: string; qtype: string; stem: string; options: string; answer: string; explanation: string;
  tags: string; review_status: string; source: string; content_version: number; created_at: string; updated_at: string;
}

export interface QuestionWithProgress extends Question {
  /** 当前内容版本的复习进度；null 表示还没学过 */
  progress: { due_date: string; interval_days: number; repetitions: number; ease: number; last_reviewed: string } | null;
}

export interface ReviewSettings {
  newPerDay: number;
  maxReviewsPerDay: number;
  includeDrafts: boolean;
}

const nowIso = () => new Date().toISOString();

function newUid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fromRow(r: QuestionRow): Question {
  return {
    id: Number(r.id), uid: r.uid, qtype: r.qtype as QType, stem: r.stem,
    options: JSON.parse(r.options), answer: JSON.parse(r.answer), explanation: r.explanation,
    tags: JSON.parse(r.tags), review_status: r.review_status as ReviewStatus, source: r.source as Question["source"],
    content_version: Number(r.content_version), created_at: r.created_at, updated_at: r.updated_at,
  };
}

// ---------------- 题目增删改查 ----------------

export interface QuestionFilter {
  qtype?: QType;
  review_status?: ReviewStatus;
  tag?: string;
  /** 在题干、选项、解析里搜索 */
  search?: string;
}

export function listQuestions(db: AppDatabase, f: QuestionFilter = {}): QuestionWithProgress[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.qtype) { where.push("q.qtype = ?"); params.push(f.qtype); }
  if (f.review_status) { where.push("q.review_status = ?"); params.push(f.review_status); }
  if (f.search?.trim()) {
    where.push("(q.stem LIKE ? OR q.options LIKE ? OR q.explanation LIKE ?)");
    const s = `%${f.search.trim()}%`;
    params.push(s, s, s);
  }
  const rows = db.all<QuestionRow & { due_date: string | null; interval_days: number | null; repetitions: number | null; ease: number | null; last_reviewed: string | null }>(
    `SELECT q.*, r.due_date, r.interval_days, r.repetitions, r.ease, r.last_reviewed
       FROM questions q
       LEFT JOIN review_records r ON r.question_id = q.id AND r.active = 1 AND r.content_version = q.content_version
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY q.id`,
    params,
  );
  return rows
    .map((r) => ({
      ...fromRow(r),
      progress: r.due_date ? { due_date: r.due_date, interval_days: Number(r.interval_days), repetitions: Number(r.repetitions), ease: Number(r.ease), last_reviewed: r.last_reviewed! } : null,
    }))
    .filter((q) => !f.tag || q.tags.includes(f.tag));
}

export function getQuestion(db: AppDatabase, id: number): Question {
  const r = db.all<QuestionRow>("SELECT * FROM questions WHERE id = ?", [id])[0];
  if (!r) throw new QuestionError(`找不到题目 #${id}`);
  return fromRow(r);
}

function insert(db: AppDatabase, input: QuestionInput, uid: string): number {
  const now = nowIso();
  db.runNoPersist(
    `INSERT INTO questions (uid, qtype, stem, options, answer, explanation, tags, review_status, source, content_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [uid, input.qtype, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer), input.explanation,
      JSON.stringify(input.tags), input.review_status, input.source, now, now],
  );
  return Number(db.all<{ id: number }>("SELECT last_insert_rowid() AS id")[0].id);
}

export function createQuestion(db: AppDatabase, raw: Partial<QuestionInput>): Question {
  const input = normalizeQuestion(raw);
  let id = 0;
  db.transaction(() => { id = insert(db, input, newUid()); });
  return getQuestion(db, id);
}

/** 修改题目。返回修改后的题目，以及复习进度是否因此重置。 */
function updateNoPersist(db: AppDatabase, id: number, raw: Partial<QuestionInput>): { question: Question; progressReset: boolean } {
  const old = getQuestion(db, id);
  // source 不随修改变化
  const input = normalizeQuestion({ ...old, ...raw, source: old.source });
  const changed = contentKey(input) !== contentKey(old);
  const version = old.content_version + (changed ? 1 : 0);
  db.runNoPersist(
    `UPDATE questions SET qtype = ?, stem = ?, options = ?, answer = ?, explanation = ?, tags = ?, review_status = ?,
            content_version = ?, updated_at = ? WHERE id = ?`,
    [input.qtype, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer), input.explanation,
      JSON.stringify(input.tags), input.review_status, version, nowIso(), id],
  );
  let progressReset = false;
  if (changed) {
    const had = db.all<{ n: number }>("SELECT count(*) AS n FROM review_records WHERE question_id = ? AND active = 1", [id])[0];
    progressReset = Number(had.n) > 0;
    db.runNoPersist("UPDATE review_records SET active = 0 WHERE question_id = ?", [id]);
  }
  return { question: getQuestion(db, id), progressReset };
}

export function updateQuestion(db: AppDatabase, id: number, raw: Partial<QuestionInput>): { question: Question; progressReset: boolean } {
  let r!: ReturnType<typeof updateNoPersist>;
  db.transaction(() => { r = updateNoPersist(db, id, raw); });
  return r;
}

/** 批量改审核状态（审核状态变化也会重置复习进度） */
export function setReviewStatus(db: AppDatabase, ids: number[], status: ReviewStatus): { changed: number; progressReset: number } {
  let changed = 0, progressReset = 0;
  db.transaction(() => {
    for (const id of ids) {
      if (getQuestion(db, id).review_status === status) continue;
      const r = updateNoPersist(db, id, { review_status: status });
      changed++;
      if (r.progressReset) progressReset++;
    }
  });
  return { changed, progressReset };
}

export function deleteQuestions(db: AppDatabase, ids: number[]): void {
  db.transaction(() => {
    for (const id of ids) db.runNoPersist("DELETE FROM questions WHERE id = ?", [id]);
  });
}

export function allTags(db: AppDatabase): string[] {
  const set = new Set<string>();
  for (const r of db.all<{ tags: string }>("SELECT tags FROM questions")) for (const t of JSON.parse(r.tags) as string[]) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b, "zh"));
}

// ---------------- 复习 ----------------

const eligibleSql = (s: ReviewSettings) => (s.includeDrafts ? "1 = 1" : "q.review_status = 'reviewed'");

export interface TodayQueue {
  /** 到期要复习的（先复习） */
  due: Question[];
  /** 今天安排的新题 */
  fresh: Question[];
  doneToday: { reviews: number; fresh: number };
  /** 不参与复习的草稿题数量（提示用） */
  draftsExcluded: number;
}

export function todayQueue(db: AppDatabase, today: string, s: ReviewSettings): TodayQueue {
  const done = db.all<{ fresh: number; reviews: number }>(
    `SELECT coalesce(sum(CASE WHEN was_new = 1 THEN 1 ELSE 0 END), 0) AS fresh,
            coalesce(sum(CASE WHEN was_new = 0 THEN 1 ELSE 0 END), 0) AS reviews
       FROM review_log WHERE review_date = ?`, [today])[0];
  const doneFresh = Number(done.fresh), doneReviews = Number(done.reviews);
  const dueLimit = Math.max(0, s.maxReviewsPerDay - doneReviews);
  const freshLimit = Math.max(0, s.newPerDay - doneFresh);
  const due = db.all<QuestionRow>(
    `SELECT q.* FROM questions q
       JOIN review_records r ON r.question_id = q.id AND r.active = 1 AND r.content_version = q.content_version
      WHERE ${eligibleSql(s)} AND r.due_date <= ? AND r.last_reviewed < ?
      ORDER BY r.due_date, q.id LIMIT ?`, [today, today, dueLimit]).map(fromRow);
  const fresh = db.all<QuestionRow>(
    `SELECT q.* FROM questions q
      WHERE ${eligibleSql(s)}
        AND NOT EXISTS (SELECT 1 FROM review_records r WHERE r.question_id = q.id AND r.active = 1 AND r.content_version = q.content_version)
      ORDER BY q.id LIMIT ?`, [freshLimit]).map(fromRow);
  const draftsExcluded = s.includeDrafts ? 0 : Number(db.all<{ n: number }>("SELECT count(*) AS n FROM questions WHERE review_status = 'draft'")[0].n);
  return { due, fresh, doneToday: { reviews: doneReviews, fresh: doneFresh }, draftsExcluded };
}

export interface AnswerResult {
  correct: boolean;
  grade: number;
  interval: number;
  due_date: string;
  was_new: boolean;
}

/**
 * 记录一次作答并按 SM-2 排下次复习。
 * correct 由程序判断；答错时评分最高按 2 计（没记住）。答对时 grade 由用户选：3 困难、4 良好、5 简单。
 */
export function answerQuestion(db: AppDatabase, id: number, response: unknown, grade: number, today: string): AnswerResult {
  const q = getQuestion(db, id);
  const correct = isCorrect(q, response);
  const g = correct ? Math.max(3, Math.min(5, grade)) : Math.min(2, Math.max(0, grade));
  let result!: AnswerResult;
  db.transaction(() => {
    let rec = db.all<{ id: number; repetitions: number; interval_days: number; ease: number }>(
      "SELECT id, repetitions, interval_days, ease FROM review_records WHERE question_id = ? AND active = 1 AND content_version = ?",
      [id, q.content_version])[0];
    const wasNew = !rec;
    if (!rec) {
      db.runNoPersist(
        `INSERT INTO review_records (question_id, content_version, active, repetitions, interval_days, ease, due_date, last_reviewed, created_at)
         VALUES (?, ?, 1, 0, 0, ?, ?, ?, ?)`, [id, q.content_version, SM2_START.ease, today, today, nowIso()]);
      const rid = Number(db.all<{ id: number }>("SELECT last_insert_rowid() AS id")[0].id);
      rec = { id: rid, ...SM2_START, interval_days: 0 };
    }
    const next = sm2({ repetitions: Number(rec.repetitions), interval: Number(rec.interval_days), ease: Number(rec.ease) }, g);
    const due = addDays(today, next.interval);
    db.runNoPersist("UPDATE review_records SET repetitions = ?, interval_days = ?, ease = ?, due_date = ?, last_reviewed = ? WHERE id = ?",
      [next.repetitions, next.interval, next.ease, due, today, rec.id]);
    db.runNoPersist(
      `INSERT INTO review_log (record_id, question_id, content_version, review_date, reviewed_at, was_new, correct, grade, response, interval_after, ease_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rec.id, id, q.content_version, today, nowIso(), wasNew ? 1 : 0, correct ? 1 : 0, g, JSON.stringify(response ?? null), next.interval, next.ease]);
    result = { correct, grade: g, interval: next.interval, due_date: due, was_new: wasNew };
  });
  return result;
}

export interface ReviewStats {
  total: number;
  reviewed: number;
  drafts: number;
  /** 当前版本已经学过的题 */
  learned: number;
  /** 今天还要做的：到期复习 + 新题 */
  todayDue: number;
  todayFresh: number;
  doneToday: number;
}

export function reviewStats(db: AppDatabase, today: string, s: ReviewSettings): ReviewStats {
  const [t] = db.all<{ total: number; reviewed: number; drafts: number; learned: number }>(
    `SELECT count(*) AS total,
            coalesce(sum(CASE WHEN review_status = 'reviewed' THEN 1 ELSE 0 END), 0) AS reviewed,
            coalesce(sum(CASE WHEN review_status = 'draft' THEN 1 ELSE 0 END), 0) AS drafts,
            (SELECT count(*) FROM review_records r JOIN questions q2 ON q2.id = r.question_id
              WHERE r.active = 1 AND r.content_version = q2.content_version) AS learned
       FROM questions`);
  const q = todayQueue(db, today, s);
  return {
    total: Number(t.total), reviewed: Number(t.reviewed), drafts: Number(t.drafts), learned: Number(t.learned),
    todayDue: q.due.length, todayFresh: q.fresh.length, doneToday: q.doneToday.reviews + q.doneToday.fresh,
  };
}

// ---------------- 导入导出 ----------------

export interface ImportPreview {
  total: number;
  fresh: number;
  same: number;
  changed: number;
  invalid: { index: number; error: string }[];
}

function classify(db: AppDatabase, items: ParsedItem[]) {
  return items.map((it) => {
    if (!it.input) return { it, kind: "invalid" as const };
    const old = it.uid ? db.all<QuestionRow>("SELECT * FROM questions WHERE uid = ?", [it.uid])[0] : undefined;
    if (!old) return { it, kind: "fresh" as const };
    const o = fromRow(old);
    const same = contentKey(o) === contentKey(it.input) && JSON.stringify(o.tags) === JSON.stringify(it.input.tags);
    return { it, kind: same ? ("same" as const) : ("changed" as const), id: o.id };
  });
}

export function previewImport(db: AppDatabase, text: string): ImportPreview {
  const c = classify(db, parseQuestionFile(text));
  return {
    total: c.length,
    fresh: c.filter((x) => x.kind === "fresh").length,
    same: c.filter((x) => x.kind === "same").length,
    changed: c.filter((x) => x.kind === "changed").length,
    invalid: c.filter((x) => x.kind === "invalid").map((x) => ({ index: x.it.index + 1, error: x.it.error! })),
  };
}

/** 导入：新题插入；已有的题（uid 相同）内容不同时，updateExisting 为 true 才覆盖（会按规则重置复习进度）。格式有错的题跳过。 */
export function applyImport(db: AppDatabase, text: string, updateExisting: boolean, defaultSource: Question["source"] = "import") {
  const c = classify(db, parseQuestionFile(text, defaultSource));
  let added = 0, updated = 0, progressReset = 0;
  db.transaction(() => {
    for (const x of c) {
      if (x.kind === "fresh") { insert(db, x.it.input!, x.it.uid ?? newUid()); added++; }
      else if (x.kind === "changed" && updateExisting) {
        const r = updateNoPersist(db, x.id!, x.it.input!);
        updated++;
        if (r.progressReset) progressReset++;
      }
    }
  });
  return { added, updated, progressReset, skipped: c.length - added - updated };
}
