/**
 * 回路 JSON 的格式迁移。
 *
 * 每次修改回路格式：把 CIRCUIT_SCHEMA_VERSION 加 1，并在下面登记一个从旧版本升级到新版本的函数。
 * 读入旧文件时依次执行，用户不需要手改文件。
 */
import { CIRCUIT_SCHEMA_VERSION } from "../types";

export class CircuitFormatError extends Error {}

type RawCircuit = Record<string, unknown>;

/** key = 旧版本号，函数把它升级到 key + 1 */
const MIGRATIONS: Record<number, (c: RawCircuit) => RawCircuit> = {
  /**
   * 0 → 1：早期草稿格式。
   * - 元件两端用 from / to 两个字段表示，改为 between: [from, to]
   * - 线圈、灯、电阻用 highImpedance: true/false，改为 impedance: "high" | "low"
   */
  0: (c) => ({
    ...c,
    schemaVersion: 1,
    components: ((c.components as RawCircuit[]) ?? []).map((comp) => {
      const out: RawCircuit = { ...comp };
      if ("from" in out || "to" in out) {
        out.between = [out.from, out.to];
        delete out.from;
        delete out.to;
      }
      if ("highImpedance" in out) {
        out.impedance = out.highImpedance ? "high" : "low";
        delete out.highImpedance;
      }
      return out;
    }),
  }),
};

export interface MigrationResult {
  circuit: RawCircuit;
  fromVersion: number;
  applied: number[];
}

export function migrateCircuit(raw: unknown): MigrationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CircuitFormatError("回路文件内容不是一个 JSON 对象");
  let c = raw as RawCircuit;
  const v = c.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new CircuitFormatError("回路文件缺少有效的 schemaVersion");
  if (v > CIRCUIT_SCHEMA_VERSION)
    throw new CircuitFormatError(`回路文件版本（${v}）比程序支持的版本（${CIRCUIT_SCHEMA_VERSION}）新，请升级程序`);
  const applied: number[] = [];
  for (let cur = v; cur < CIRCUIT_SCHEMA_VERSION; cur++) {
    const fn = MIGRATIONS[cur];
    if (!fn) throw new CircuitFormatError(`缺少从版本 ${cur} 升级的迁移函数`);
    c = fn(c);
    applied.push(cur);
  }
  return { circuit: c, fromVersion: v, applied };
}
