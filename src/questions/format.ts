/**
 * 题目 JSON 导入导出格式（schemaVersion 1）。
 *
 * {
 *   "schemaVersion": 1,
 *   "kind": "questions",
 *   "questions": [
 *     { "uid": "可选，同一道题的唯一标识", "type": "单选", "stem": "题干",
 *       "options": ["选项A", "选项B"], "answer": "B", "explanation": "解析",
 *       "tags": ["防跳"], "reviewStatus": "草稿", "source": "手工录入" }
 *   ]
 * }
 *
 * - type：单选 / 多选 / 判断 / 排序（也可以写 single / multi / judge / order）
 * - answer：单选写字母 "B"；多选写 ["A","C"] 或 "AC"；判断写 "对" / "错"（或 true / false）；
 *   排序写正确顺序的字母 ["C","A","B"]，不写时选项本身就是正确顺序
 * - reviewStatus：草稿 / 已审核，不写按草稿
 */
import { normalizeQuestion, letter, QTYPE_LABEL, STATUS_LABEL, SOURCE_LABEL, QuestionError, type Question, type QuestionInput, type QType, type ReviewStatus, type QSource } from "./model";

export const QUESTION_FILE_VERSION = 1;

export interface QuestionFileItem {
  uid?: string;
  type: string;
  stem: string;
  options?: string[];
  answer?: unknown;
  explanation?: string;
  tags?: string[];
  reviewStatus?: string;
  source?: string;
}

const rev = <K extends string>(m: Record<K, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>;
const TYPE_BY_LABEL = rev(QTYPE_LABEL);
const STATUS_BY_LABEL = rev(STATUS_LABEL);
const SOURCE_BY_LABEL = rev(SOURCE_LABEL);

/** 导出成文件内容 */
export function exportQuestions(qs: Question[], exportedAt: string): string {
  const items: QuestionFileItem[] = qs.map((q) => ({
    uid: q.uid,
    type: QTYPE_LABEL[q.qtype],
    stem: q.stem,
    ...(q.qtype === "judge" ? {} : { options: q.options }),
    answer: q.qtype === "judge" ? (q.answer ? "对" : "错")
      : q.qtype === "single" ? letter(q.answer as number)
      : (q.answer as number[]).map(letter),
    explanation: q.explanation,
    tags: q.tags,
    reviewStatus: STATUS_LABEL[q.review_status],
    source: SOURCE_LABEL[q.source],
  }));
  return JSON.stringify({ schemaVersion: QUESTION_FILE_VERSION, kind: "questions", exportedAt, questions: items }, null, 2) + "\n";
}

export interface ParsedItem {
  index: number;
  uid?: string;
  input?: QuestionInput;
  error?: string;
}

/** 读入导入文件，逐题校验。整个文件不对时抛出中文错误。 */
export function parseQuestionFile(text: string, defaultSource: QSource = "import"): ParsedItem[] {
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^﻿/, "")); } catch (e) { throw new QuestionError(`不是合法的 JSON 文件：${(e as Error).message}`); }
  // 也接受直接是题目数组的文件
  const obj = Array.isArray(raw) ? { schemaVersion: 1, questions: raw } : (raw as { schemaVersion?: unknown; kind?: unknown; questions?: unknown });
  if (!obj || typeof obj !== "object") throw new QuestionError("文件内容不是题目文件");
  if (obj.kind !== undefined && obj.kind !== "questions") throw new QuestionError(`这不是题目文件（kind 是 ${String(obj.kind)}）`);
  const v = obj.schemaVersion ?? 1;
  if (typeof v !== "number" || v > QUESTION_FILE_VERSION) throw new QuestionError(`题目文件版本 ${String(v)} 比程序支持的 ${QUESTION_FILE_VERSION} 新，请先升级程序`);
  if (!Array.isArray(obj.questions)) throw new QuestionError("文件里没有 questions 列表");
  return obj.questions.map((it: QuestionFileItem, index: number): ParsedItem => {
    try {
      if (!it || typeof it !== "object") throw new QuestionError("不是一个对象");
      const qtype = (TYPE_BY_LABEL[it.type] ?? it.type) as QType;
      const status = it.reviewStatus === undefined ? "draft" : (STATUS_BY_LABEL[it.reviewStatus] ?? it.reviewStatus) as ReviewStatus;
      const source = it.source === undefined ? defaultSource : (SOURCE_BY_LABEL[it.source] ?? it.source) as QSource;
      const input = normalizeQuestion({
        qtype, stem: it.stem, options: it.options ?? [], answer: it.answer as never,
        explanation: it.explanation, tags: it.tags, review_status: status, source,
      });
      const uid = typeof it.uid === "string" && it.uid.trim() ? it.uid.trim() : undefined;
      return { index, uid, input };
    } catch (e) {
      return { index, error: (e as Error).message };
    }
  });
}
