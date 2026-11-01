/**
 * 导通分析和线圈动作判定（AGENTS.md 2.2 节）。
 * 只读状态，不修改任何东西。
 */
import type { BranchComp, Circuit, CoilComp, CoilJudgement, Component, Impedance } from "./types";
import { powerNodes } from "./validate";

/** 单个回路最多枚举多少条导通路径，防止复杂回路卡死 */
export const MAX_PATHS = 5000;

export function isBranch(c: Component): c is BranchComp {
  return c.type === "contact_no" || c.type === "contact_nc" || c.type === "coil" || c.type === "lamp" || c.type === "resistor";
}

export function isContact(c: Component): boolean {
  return c.type === "contact_no" || c.type === "contact_nc";
}

export function impedanceOf(c: Component): Impedance | null {
  if (c.type === "coil") return c.impedance ?? "low";
  if (c.type === "lamp" || c.type === "resistor") return c.impedance ?? "high";
  return null;
}

export interface Conduction {
  /** 本状态下导通的支路元件 */
  conducting: Set<string>;
  /** 从正电源到负电源的所有简单导通路径（元件 id 序列） */
  paths: string[][];
  /** 两端被一条全部由闭合接点组成的通路短接的非接点元件 */
  shorted: Set<string>;
  /** 正负电源之间存在全部由闭合接点组成的通路（电源短路） */
  powerShorted: boolean;
  /** 路径数超过上限被截断 */
  truncated: boolean;
}

class UnionFind {
  private p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r)!;
    this.p.set(x, r);
    return r;
  }
  union(a: string, b: string) { this.p.set(this.find(a), this.find(b)); }
}

export function analyzeConduction(circuit: Circuit, conducts: (c: BranchComp) => boolean): Conduction {
  const branches = circuit.components.filter(isBranch);
  const conducting = new Set(branches.filter(conducts).map((b) => b.id));
  const { positive, negative } = powerNodes(circuit);

  // 闭合接点把节点连成等电位的组
  const uf = new UnionFind();
  for (const b of branches) if (isContact(b) && conducting.has(b.id)) uf.union(b.between[0], b.between[1]);
  const shorted = new Set(
    branches.filter((b) => !isContact(b) && uf.find(b.between[0]) === uf.find(b.between[1])).map((b) => b.id),
  );
  const powerShorted = uf.find(positive) === uf.find(negative);

  // 邻接表：节点 → [元件, 对端节点]
  const adj = new Map<string, [string, string][]>();
  for (const b of branches) {
    if (!conducting.has(b.id)) continue;
    const [x, y] = b.between;
    (adj.get(x) ?? adj.set(x, []).get(x)!).push([b.id, y]);
    (adj.get(y) ?? adj.set(y, []).get(y)!).push([b.id, x]);
  }
  const paths: string[][] = [];
  let truncated = false;
  const visited = new Set<string>([positive]);
  const cur: string[] = [];
  const dfs = (node: string) => {
    if (truncated) return;
    if (node === negative) {
      if (paths.length >= MAX_PATHS) { truncated = true; return; }
      paths.push([...cur]);
      return;
    }
    for (const [edge, next] of adj.get(node) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      cur.push(edge);
      dfs(next);
      cur.pop();
      visited.delete(next);
    }
  };
  dfs(positive);
  return { conducting, paths, shorted, powerShorted, truncated };
}

export interface CoilFaultInfo {
  burnt: boolean;
  openCircuit: boolean;
}

/**
 * 线圈动作判定（高低阻两档模型，沈 2026-10-31 同意采用）：
 * 1. 线圈必须位于某条导通路径上；
 * 2. 被闭合接点短接的元件不动作，也不算作路径上的高阻元件；
 * 3. 某条路径上除它以外没有其他高阻元件 → 动作；
 *    所有路径上都还有其他高阻元件 → 只有高阻线圈动作，低阻线圈不动作。
 * 做成独立函数，以后要换更精细的模型只改这里。
 */
export function judgeCoil(
  coil: CoilComp,
  cond: Conduction,
  byId: Map<string, Component>,
  fault: CoilFaultInfo,
): CoilJudgement {
  const id = coil.id;
  const no = (reason: string): CoilJudgement => ({ id, energized: false, reason: `${id} 未动作：${reason}` });
  if (fault.burnt) return no("线圈烧毁（注入的故障）");
  if (fault.openCircuit) return no("线圈回路断线（注入的故障）");
  if (cond.shorted.has(id)) return no("两端被闭合接点短接，线圈上没有电压");
  const onPaths = cond.paths.filter((p) => p.includes(id));
  if (onPaths.length === 0) return no("不在正电源到负电源的导通路径上");

  const others = onPaths.map((p) =>
    p.filter((x) => x !== id && !cond.shorted.has(x) && impedanceOf(byId.get(x)!) === "high"),
  );
  if (others.some((o) => o.length === 0)) {
    return { id, energized: true, reason: `${id} 动作：所在导通路径上没有其他高阻元件` };
  }
  const blockers = [...new Set(others.flat())].join("、");
  if ((coil.impedance ?? "low") === "high") {
    return { id, energized: true, reason: `${id} 动作：它是高阻线圈（灵敏的小电流继电器），路径上虽串有高阻元件 ${blockers}，仍能动作` };
  }
  return no(`路径上串有高阻元件 ${blockers}，电流太小，低阻线圈不动作`);
}
