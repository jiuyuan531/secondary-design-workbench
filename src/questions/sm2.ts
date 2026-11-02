/**
 * SM-2 间隔重复算法（SuperMemo 2）。
 *
 * 评分 grade 0～5：
 * - 0～2：没记住。连续记住次数清零，1 天后再复习；
 * - 3～5：记住了（3 困难、4 良好、5 简单）。第 1 次 1 天，第 2 次 6 天，之后按“上次间隔 × 难度因子”。
 * 难度因子 ease 每次按 EF' = EF + 0.1 − (5−q)(0.08 + (5−q)×0.02) 调整，最小 1.3。
 */

export interface Sm2State {
  repetitions: number;
  interval: number;
  ease: number;
}

export const SM2_START: Sm2State = { repetitions: 0, interval: 0, ease: 2.5 };

export function sm2(prev: Sm2State, grade: number): Sm2State {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) throw new Error(`评分必须是 0～5 的整数，收到 ${grade}`);
  const ease = Math.max(1.3, round2(prev.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))));
  if (grade < 3) return { repetitions: 0, interval: 1, ease };
  const repetitions = prev.repetitions + 1;
  const interval = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.max(1, Math.round(prev.interval * prev.ease));
  return { repetitions, interval, ease };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
