/** 内置草稿回路：能读入、场景能跑完，关键演示结果符合预期（只验证程序行为，不代表工程审核）。 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadCircuit, initialState, operate, run, step, type Circuit, type RunResult } from "../index";

const dir = path.resolve(__dirname, "../../../data/seed/circuits");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

function playScenario(c: Circuit, title: string): RunResult[] {
  const sc = c.scenarios!.find((s) => s.title === title)!;
  let s = run(c, initialState(c)).finalState;
  const runs: RunResult[] = [];
  for (const st of sc.steps) {
    if (st.action === "operate") s = operate(c, s, st.target!, st.to!);
    else if (st.action === "tick") s = step(c, s).state;
    else { const r = run(c, s); runs.push(r); s = r.finalState; }
  }
  return runs;
}

describe("内置草稿回路", () => {
  it("至少有 3 个，全部标为草稿、通过校验、带布局", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const { circuit } = loadCircuit(fs.readFileSync(path.join(dir, f), "utf8"));
      expect(circuit.reviewStatus, f).toBe("草稿");
      expect(`${circuit.id}.json`).toBe(f);
      for (const comp of circuit.components) {
        if ("between" in comp) expect(circuit.layout?.[comp.id], `${f} ${comp.id} 缺少布局`).toBeDefined();
      }
    }
  });

  const load = (id: string) => loadCircuit(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")).circuit;

  it("所有场景都能跑完且不报未收敛", () => {
    for (const f of files) {
      const c = load(f.replace(/\.json$/, ""));
      for (const sc of c.scenarios ?? []) for (const r of playScenario(c, sc.title)) expect(r.status, `${f} ${sc.title}`).not.toBe("not_converged");
    }
  });

  it("防跳回路：带防跳稳定在分位，去掉防跳报振荡", () => {
    const c = load("anti-pumping");
    const withAP = playScenario(c, "带防跳：合于故障");
    expect(withAP[0].status).toBe("stable");
    expect(withAP[0].finalState.breakers.QF.closed).toBe(false);
    expect(playScenario(c, "去掉防跳：跳跃现象")[0].status).toBe("oscillation");
  });

  it("控制回路断线：注入故障后 TWJ、HWJ 都返回，断线信号所在回路导通", () => {
    const c = load("control-circuit-alarm");
    const [r] = playScenario(c, "跳闸线圈断线");
    expect(r.finalState.relays).toEqual({ TWJ: false, HWJ: false });
    expect(step(c, r.finalState).report.paths.some((p) => p.includes("ALM"))).toBe(true);
  });
});
