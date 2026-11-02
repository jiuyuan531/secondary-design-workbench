import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadCircuit } from "../../../engine/index";
import { newSim, playStep, newPlayer, hasSomethingToPlay, applyOperate, type Sim, type PlayResult } from "../session";
import { blankCircuitText, copyCircuitText } from "../templates";

const seed = (f: string) => loadCircuit(fs.readFileSync(path.join("data/seed/circuits", f), "utf8")).circuit;

/** 模拟定时器：一直调用 playStep 直到播放结束 */
function playAll(sim: Sim, scenarioIdx: number | null, limit = 200) {
  const scenario = scenarioIdx === null ? undefined : sim.circuit.scenarios![scenarioIdx];
  let p = newPlayer();
  let s = sim;
  const results: PlayResult[] = [];
  for (let i = 0; i < 500; i++) {
    const r = playStep(s, scenario, p, limit);
    results.push(r);
    s = r.sim; p = r.player;
    if (r.done) return { s, results };
  }
  throw new Error("自动播放没有结束");
}

describe("自动播放", () => {
  it("刚复位的稳定回路没有场景时：没有可以播放的内容", () => {
    const sim = newSim(seed("breaker-control-basic.json"), 200);
    expect(hasSomethingToPlay(sim, undefined, 0)).toBe(false);
  });

  it("操作接点后，没有场景也会逐个 tick 播放到稳定", () => {
    const c = seed("breaker-control-basic.json");
    const sim = applyOperate(newSim(c, 200), "SA_close", "closed");
    expect(hasSomethingToPlay(sim, undefined, 0)).toBe(true);
    const { s, results } = playAll(sim, null);
    // 至少播放了两个 tick（不是一下子跳到结果）
    expect(results.filter((r) => r.pause === "tick").length).toBeGreaterThanOrEqual(1);
    expect(s.status.kind).toBe("stable");
    expect(s.state.breakers.QF.closed).toBe(true);
  });

  it("每个草稿回路的每个场景都能自动播放完，讲解依次出现", () => {
    for (const f of fs.readdirSync("data/seed/circuits").filter((x) => x.endsWith(".json"))) {
      const c = seed(f);
      (c.scenarios ?? []).forEach((sc, i) => {
        const { s, results } = playAll(newSim(c, 200), i);
        const explained = results.filter((r) => r.explain !== undefined).length;
        expect(explained, `${f} / ${sc.title}`).toBe(sc.steps.length);
        expect(["stable", "oscillation", "idle"]).toContain(s.status.kind);
      });
    }
  });

  it("去掉防跳的场景：播放到振荡后再多放一个循环，最后停在振荡状态", () => {
    const c = seed("anti-pumping.json");
    const idx = c.scenarios!.findIndex((x) => x.title.includes("跳跃"));
    const { s, results } = playAll(newSim(c, 200), idx);
    expect(s.status.kind).toBe("oscillation");
    const firstOsc = results.findIndex((r) => r.sim.status.kind === "oscillation");
    const cycle = results[firstOsc].sim.status.cycle!;
    expect(cycle).toBeGreaterThan(1);
    // 检测到振荡之后又播放了 cycle 个 tick
    expect(results.length - 1 - firstOsc).toBe(cycle);
  });
});

describe("新建回路模板", () => {
  it("空白模板本身是合法回路，草稿状态", () => {
    const { circuit } = loadCircuit(blankCircuitText());
    expect(circuit.reviewStatus).toBe("草稿");
    const { s } = playAll(newSim(circuit, 200), 0);
    expect(s.status.kind).toBe("stable");
  });

  it("复制回路：换 id 和标题，审核状态改回草稿，其它不变", () => {
    const text = fs.readFileSync("data/seed/circuits/anti-pumping.json", "utf8");
    const orig = loadCircuit(text).circuit;
    const copy = loadCircuit(copyCircuitText(text)).circuit;
    expect(copy.id).toBe(`${orig.id}-copy`);
    expect(copy.title).toBe(`${orig.title}（副本）`);
    expect(copy.reviewStatus).toBe("草稿");
    expect(copy.components).toEqual(orig.components);
  });
});
