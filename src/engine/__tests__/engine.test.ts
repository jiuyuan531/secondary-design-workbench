import { describe, it, expect } from "vitest";
import {
  initialState, operate, run, step, loadCircuit, validateCircuit, migrateCircuit, CircuitFormatError, type Circuit, type SimState,
} from "../index";
import { controlCircuit, monitorCircuit, highLowCircuit, raceCircuit, slowCircuit } from "./fixtures";

function coilOn(c: Circuit, s: SimState, id: string) {
  return step(c, s).report.coils.find((j) => j.id === id)!;
}

describe("AGENTS.md 第 8 节必测项", () => {
  it("1. 合闸：合闸线圈动作 → 断路器延时合上 → 辅助常闭断开 → 合闸线圈失电，稳定", () => {
    const c = controlCircuit({ antiPumping: true });
    let s = operate(c, initialState(c), "SA_close", "closed");
    const r = run(c, s);
    expect(r.status).toBe("stable");
    // tick1：HQ 动作，断路器开始合闸倒计时
    expect(r.ticks[0].coils.find((j) => j.id === "HQ")!.energized).toBe(true);
    expect(r.ticks[0].breakers.QF).toBe("open");
    expect(r.ticks[0].timers.map((t) => t.id)).toContain("QF");
    // tick2：断路器合上，QF 常闭断开
    expect(r.ticks[1].breakers.QF).toBe("closed");
    expect(r.ticks[1].changes.map((x) => x.id)).toEqual(expect.arrayContaining(["QF", "QF_b", "QF_a"]));
    // tick3：合闸线圈失电
    expect(r.ticks[2].coils.find((j) => j.id === "HQ")!.energized).toBe(false);
    expect(r.finalState.breakers.QF.closed).toBe(true);
    expect(r.finalState.coils.HQ.active).toBe(false);
    s = r.finalState;
  });

  it("2. 断路器合位时闭合跳闸接点 → 跳闸线圈动作 → 断路器分开", () => {
    const c = controlCircuit({ antiPumping: true });
    c.components.find((x) => x.id === "QF")!.type === "breaker" && Object.assign(c.components.find((x) => x.id === "QF")!, { initialState: "closed" });
    const s = operate(c, initialState(c), "KOP", "closed");
    const r = run(c, s);
    expect(r.ticks[0].coils.find((j) => j.id === "TQ")!.energized).toBe(true);
    expect(r.status).toBe("stable");
    expect(r.finalState.breakers.QF.closed).toBe(false);
    expect(r.finalState.coils.TQ.active).toBe(false); // QF 常开断开后跳闸线圈失电
  });

  it("3. 跳跃：合闸命令保持 + 跳闸命令，不带防跳 → 检测到振荡并给出循环起止", () => {
    const c = controlCircuit({ antiPumping: false });
    let s = operate(c, initialState(c), "SA_close", "closed");
    s = operate(c, s, "KOP", "closed");
    const r = run(c, s);
    expect(r.status).toBe("oscillation");
    expect(r.cycle).toBeDefined();
    expect(r.cycle!.to).toBeGreaterThan(r.cycle!.from);
    expect(r.message).toContain("振荡");
    // 循环内断路器既合过又分过
    const inCycle = r.ticks.filter((t) => t.tick > r.cycle!.from && t.tick <= r.cycle!.to).map((t) => t.breakers.QF);
    expect(new Set(inCycle)).toEqual(new Set(["open", "closed"]));
  });

  it("4. 防跳有效：同样条件带防跳继电器（含自保持）→ 跳开后不再重合，稳定", () => {
    const c = controlCircuit({ antiPumping: true });
    let s = operate(c, initialState(c), "SA_close", "closed");
    s = operate(c, s, "KOP", "closed");
    const r = run(c, s);
    expect(r.status).toBe("stable");
    expect(r.finalState.breakers.QF.closed).toBe(false);
    expect(r.finalState.relays.TBJ).toBe(true); // 电压线圈自保持
    expect(r.finalState.coils.TBJ_V.active).toBe(true);
    // 断路器只合过一次
    const closings = r.ticks.flatMap((t) => t.changes).filter((x) => x.id === "QF" && x.to === "合位");
    expect(closings.length).toBe(1);
  });

  it("5. 注入“控制回路断线” → 两个位置监视继电器都失电", () => {
    for (const closed of [true, false]) {
      const c = monitorCircuit(closed);
      const before = run(c, initialState(c));
      expect(before.status).toBe("stable");
      expect(before.finalState.relays[closed ? "HWJ" : "TWJ"]).toBe(true);
      expect(before.finalState.relays[closed ? "TWJ" : "HWJ"]).toBe(false);
      // 监视继电器串着跳合闸线圈，跳合闸线圈不应动作
      expect(before.finalState.breakers.QF.closed).toBe(closed);
      const s = operate(c, before.finalState, "F_break", "active");
      const after = run(c, s);
      expect(after.status).toBe("stable");
      expect(after.finalState.relays.TWJ).toBe(false);
      expect(after.finalState.relays.HWJ).toBe(false);
    }
  });

  it("6. 高低阻判定：合闸接点断开时 TWJ 动作、HQ 不动作；闭合后 TWJ 被短接失电、HQ 动作", () => {
    const c = highLowCircuit();
    const s0 = initialState(c);
    const twj = coilOn(c, s0, "TWJ_coil");
    const hq = coilOn(c, s0, "HQ");
    expect(twj.energized).toBe(true);
    expect(hq.energized).toBe(false);
    expect(hq.reason).toContain("TWJ_coil");
    const s1 = operate(c, run(c, s0).finalState, "SA", "closed");
    expect(coilOn(c, s1, "HQ").energized).toBe(true);
    const t = coilOn(c, s1, "TWJ_coil");
    expect(t.energized).toBe(false);
    expect(t.reason).toContain("短接");
    const after = step(c, s1).state;
    expect(after.relays.TWJ).toBe(false);
  });

  it("7. 有限步终止：maxTicks 内给出稳定或振荡；步数太小时报“仿真未收敛”而不是死循环", () => {
    for (const c of [controlCircuit({ antiPumping: true }), controlCircuit({ antiPumping: false }), monitorCircuit(true), raceCircuit(), slowCircuit()]) {
      let s = initialState(c);
      for (const comp of c.components) if (comp.type === "contact_no" && comp.operable) s = operate(c, s, comp.id, "closed");
      const r = run(c, s, { maxTicks: 200 });
      expect(["stable", "oscillation"]).toContain(r.status);
      expect(r.ticks.length).toBeLessThanOrEqual(200);
    }
    const c = slowCircuit();
    const r = run(c, initialState(c), { maxTicks: 10 });
    expect(r.status).toBe("not_converged");
    expect(r.message).toContain("仿真未收敛");
    expect(r.ticks.length).toBe(10);
    // 回路文件里的 maxTicks 优先
    expect(run({ ...c, maxTicks: 5 }, initialState(c)).ticks.length).toBe(5);
  });

  it("8. 同步更新：结果与元件在文件里的顺序无关", () => {
    const c = raceCircuit();
    const r1 = run(c, initialState(c));
    // 同步更新下两个继电器同时动作、同时返回 → 振荡；逐个更新则会有一个“赢家”而稳定
    expect(r1.status).toBe("oscillation");
    expect(r1.ticks[0].changes.map((x) => x.id)).toEqual(expect.arrayContaining(["A", "B"]));
    const reversed: Circuit = { ...c, components: [...c.components].reverse() };
    const r2 = run(reversed, initialState(reversed));
    expect(r2.status).toBe(r1.status);
    expect(r2.cycle).toEqual(r1.cycle);
    expect(r2.ticks.map((t) => [t.breakers, [...t.changes.map((x) => x.id)].sort()]))
      .toEqual(r1.ticks.map((t) => [t.breakers, [...t.changes.map((x) => x.id)].sort()]));
    // 防跳回路同样与顺序无关
    const cp = controlCircuit({ antiPumping: true });
    const prep = (cc: Circuit) => operate(cc, operate(cc, initialState(cc), "SA_close", "closed"), "KOP", "closed");
    const shuffled: Circuit = { ...cp, components: [...cp.components].sort((a, b) => b.id.localeCompare(a.id)) };
    expect(run(shuffled, prep(shuffled)).finalState).toEqual(run(cp, prep(cp)).finalState);
  });

  it("9. 格式迁移：schemaVersion 0 的旧回路文件自动升级并正确仿真", () => {
    const old = {
      schemaVersion: 0, id: "old", title: "旧格式回路", nodes: ["+KM", "-KM", "n1", "n2"],
      components: [
        { id: "QF", type: "breaker", initialState: "open", operateDelayTicks: 5 },
        { id: "TWJ", type: "relay" },
        { id: "SA", type: "contact_no", operable: true, from: "+KM", to: "n1" },
        { id: "TWJ_coil", type: "coil", highImpedance: true, drives: "TWJ", from: "+KM", to: "n1" },
        { id: "QF_b", type: "contact_nc", controlledBy: "QF", from: "n1", to: "n2" },
        { id: "HQ", type: "coil", highImpedance: false, drives: "QF", action: "close", from: "n2", to: "-KM" },
      ],
    };
    const { circuit, migratedFrom } = loadCircuit(JSON.stringify(old));
    expect(migratedFrom).toEqual([0]);
    expect(circuit.schemaVersion).toBe(1);
    const hq = circuit.components.find((x) => x.id === "HQ")!;
    expect(hq).toMatchObject({ between: ["n2", "-KM"], impedance: "low" });
    expect("from" in hq).toBe(false);
    // 与新格式的同一回路仿真结果一致
    const s = initialState(circuit);
    expect(coilOn(circuit, s, "TWJ_coil").energized).toBe(true);
    expect(coilOn(circuit, s, "HQ").energized).toBe(false);
    expect(run(circuit, s).finalState).toEqual(run(highLowCircuit(), initialState(highLowCircuit())).finalState);
  });
});

describe("其他行为", () => {
  it("校验给出中文错误", () => {
    const c = highLowCircuit();
    c.components.push({ id: "X", type: "contact_no", between: ["n1", "nope"] });
    const errs = validateCircuit(c);
    expect(errs.join("\n")).toMatch(/节点 nope 不在 nodes 里/);
    expect(errs.join("\n")).toMatch(/要么 operable/);
    expect(() => loadCircuit(c)).toThrow(CircuitFormatError);
    expect(() => loadCircuit("{bad json")).toThrow(/不是合法的 JSON/);
    expect(() => migrateCircuit({ ...c, schemaVersion: 99 })).toThrow(/比程序支持的版本/);
  });

  it("线圈延时：倒计时期间条件消失则取消", () => {
    const c = slowCircuit();
    let s = step(c, initialState(c)).state;
    expect(s.coils.K_coil.timer).toEqual({ kind: "pickup", remaining: 50 });
    s = operate(c, s, "S", "open");
    s = step(c, s).state;
    expect(s.coils.K_coil.timer).toBeUndefined();
    expect(s.coils.K_coil.active).toBe(false);
  });

  it("接点粘连与线圈烧毁故障", () => {
    const c = controlCircuit({ antiPumping: true });
    c.components.push(
      { id: "F_stuck", type: "fault_injection", target: "SA_close", kind: "contact_stuck" },
      { id: "F_burn", type: "fault_injection", target: "HQ", kind: "coil_burnt" },
    );
    let s = operate(c, initialState(c), "F_stuck", "active");
    expect(coilOn(c, s, "HQ").energized).toBe(true); // 接点没操作也导通
    s = operate(c, s, "F_burn", "active");
    const j = coilOn(c, s, "HQ");
    expect(j.energized).toBe(false);
    expect(j.reason).toContain("烧毁");
    expect(run(c, s).finalState.breakers.QF.closed).toBe(false);
  });

  it("不能操作非可操作元件", () => {
    const c = controlCircuit({ antiPumping: true });
    expect(() => operate(c, initialState(c), "QF_b", "closed")).toThrow(/不能手动操作/);
  });
});
