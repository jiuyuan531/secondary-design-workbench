/**
 * 题目的数据结构、校验，以及判对错（AGENTS.md 2.3 节）。纯函数，界面和主进程共用。
 *
 * 答案的内部存法（数据库里是 JSON）：
 * - single 单选：选项下标，例如 1
 * - multi  多选：选项下标数组，例如 [0, 2]
 * - judge  判断：true / false（没有选项）
 * - order  排序：正确顺序对应的选项下标数组，例如 [2, 0, 1]
 */

export type QType = "single" | "multi" | "judge" | "order";
export type ReviewStatus = "draft" | "reviewed";
export type QSource = "manual" | "ai" | "note" | "builtin" | "import";
export type Answer = number | number[] | boolean;

export const QTYPE_LABEL: Record<QType, string> = { single: "单选", multi: "多选", judge: "判断", order: "排序" };
export const STATUS_LABEL: Record<ReviewStatus, string> = { draft: "草稿", reviewed: "已审核" };
export const SOURCE_LABEL: Record<QSource, string> = { manual: "手工录入", ai: "AI 生成", note: "来自原理笔记", builtin: "内置示例", import: "导入" };

export interface QuestionInput {
  qtype: QType;
  stem: string;
  options: string[];
  answer: Answer;
  explanation: string;
  tags: string[];
  review_status: ReviewStatus;
  source: QSource;
}

export interface Question extends QuestionInput {
  id: number;
  uid: string;
  content_version: number;
  created_at: string;
  updated_at: string;
}

export class QuestionError extends Error {}

/** 校验并规范化题目；出错抛出中文 QuestionError。 */
export function normalizeQuestion(raw: Partial<QuestionInput>): QuestionInput {
  const qtype = raw.qtype as QType;
  if (!(qtype in QTYPE_LABEL)) throw new QuestionError(`题型无效：${String(raw.qtype)}（只能是单选、多选、判断、排序）`);
  const stem = String(raw.stem ?? "").trim();
  if (!stem) throw new QuestionError("题干不能为空");
  const options = qtype === "judge" ? [] : (Array.isArray(raw.options) ? raw.options : []).map((o) => String(o ?? "").trim());
  if (qtype !== "judge") {
    if (options.length < 2) throw new QuestionError(`${QTYPE_LABEL[qtype]}题至少要有 2 个选项`);
    if (options.length > 26) throw new QuestionError("选项不能超过 26 个");
    const empty = options.findIndex((o) => !o);
    if (empty >= 0) throw new QuestionError(`选项 ${letter(empty)} 是空的`);
  }
  const answer = normalizeAnswer(qtype, raw.answer, options.length);
  const status = (raw.review_status ?? "draft") as ReviewStatus;
  if (!(status in STATUS_LABEL)) throw new QuestionError(`审核状态无效：${String(raw.review_status)}`);
  const source = (raw.source ?? "manual") as QSource;
  if (!(source in SOURCE_LABEL)) throw new QuestionError(`来源无效：${String(raw.source)}`);
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((t) => String(t).trim()).filter(Boolean))];
  return { qtype, stem, options, answer, explanation: String(raw.explanation ?? "").trim(), tags, review_status: status, source };
}

function normalizeAnswer(qtype: QType, a: unknown, n: number): Answer {
  const idx = (v: unknown): number => {
    if (typeof v === "string" && /^[A-Za-z]$/.test(v.trim())) v = v.trim().toUpperCase().charCodeAt(0) - 65;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= n) throw new QuestionError(`答案 ${JSON.stringify(v)} 不是有效的选项`);
    return v;
  };
  // "AC" 这样的写法也接受
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "string" ? v.replace(/[\s,，、]/g, "").split("") : [v]);
  switch (qtype) {
    case "single": {
      if (a === undefined || a === null || a === "") throw new QuestionError("单选题要指定正确答案");
      return idx(a);
    }
    case "multi": {
      const xs = [...new Set(list(a).map(idx))].sort((x, y) => x - y);
      if (xs.length === 0) throw new QuestionError("多选题至少要有 1 个正确选项");
      return xs;
    }
    case "judge": {
      if (a === true || a === "对" || a === "正确" || a === "true") return true;
      if (a === false || a === "错" || a === "错误" || a === "false") return false;
      throw new QuestionError("判断题的答案只能是“对”或“错”");
    }
    case "order": {
      // 没写答案时，选项本身就是正确顺序
      if (a === undefined || a === null || (Array.isArray(a) && a.length === 0)) return [...Array(n).keys()];
      const xs = list(a).map(idx);
      if (xs.length !== n || new Set(xs).size !== n) throw new QuestionError("排序题的答案必须把每个选项各列一次");
      return xs;
    }
  }
}

export const letter = (i: number) => String.fromCharCode(65 + i);

/** 判断作答是否正确。response 与答案同样的存法；多选不看顺序。 */
export function isCorrect(q: Pick<QuestionInput, "qtype" | "answer">, response: unknown): boolean {
  const norm = (a: unknown) => (q.qtype === "multi" && Array.isArray(a) ? [...a].sort((x, y) => x - y) : a);
  return JSON.stringify(norm(q.answer)) === JSON.stringify(norm(response));
}

/** 正确答案的文字说明，例如“B”“A、C”“对”“C → A → B” */
export function answerText(q: Pick<QuestionInput, "qtype" | "answer" | "options">): string {
  const a = q.answer;
  if (q.qtype === "judge") return a ? "对" : "错";
  if (q.qtype === "single") return letter(a as number);
  if (q.qtype === "multi") return (a as number[]).map(letter).join("、");
  return (a as number[]).map((i) => `${letter(i)}. ${q.options[i]}`).join(" → ");
}

/** 影响复习进度的内容（只改标签不算） */
export function contentKey(q: Pick<QuestionInput, "qtype" | "stem" | "options" | "answer" | "explanation" | "review_status">): string {
  return JSON.stringify([q.qtype, q.stem, q.options, q.answer, q.explanation, q.review_status]);
}
