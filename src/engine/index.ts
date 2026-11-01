/** 回路仿真引擎入口：读入回路（自动迁移 + 校验）并提供仿真函数。 */
import { migrateCircuit, CircuitFormatError } from "./migrations/index";
import { validateCircuit } from "./validate";
import type { Circuit } from "./types";

export * from "./types";
export { initialState, operate, step, run, stateKey, SimError, DEFAULT_MAX_TICKS } from "./simulator";
export { analyzeConduction, judgeCoil } from "./conduction";
export { validateCircuit } from "./validate";
export { migrateCircuit, CircuitFormatError } from "./migrations/index";

export interface LoadResult {
  circuit: Circuit;
  /** 读入时执行了哪些版本的迁移 */
  migratedFrom: number[];
}

/** 读入一份回路（JSON 文本或已解析的对象）：自动升级旧格式，再校验。校验不通过抛出中文错误。 */
export function loadCircuit(input: string | unknown): LoadResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    try { raw = JSON.parse(input); } catch (e) { throw new CircuitFormatError(`回路文件不是合法的 JSON：${(e as Error).message}`); }
  }
  const { circuit, applied } = migrateCircuit(raw);
  const errs = validateCircuit(circuit as unknown as Circuit);
  if (errs.length) throw new CircuitFormatError(`回路“${String(circuit.title ?? circuit.id ?? "")}”格式有误：\n- ${errs.join("\n- ")}`);
  return { circuit: circuit as unknown as Circuit, migratedFrom: applied };
}
