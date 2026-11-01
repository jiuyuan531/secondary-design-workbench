import type { Result } from "../shared/api";

/** 调用主进程接口，失败时抛出带中文信息的 Error。 */
export async function call<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** 本地日期 YYYY-MM-DD */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dueText(days: number): string {
  if (days < 0) return `已逾期 ${-days} 天`;
  if (days === 0) return "今天到期";
  return `还剩 ${days} 天`;
}

export function dueClass(dueDate: string | null | undefined, done = false): string {
  if (!dueDate || done) return "";
  const days = Math.round((Date.parse(dueDate) - Date.parse(today())) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 7) return "due-soon";
  return "";
}
