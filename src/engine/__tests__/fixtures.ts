/**
 * 测试用的通用回路。只用于测试引擎逻辑，不代表工程结论（AGENTS.md 第 8 节）。
 */
import type { Circuit, Component } from "../types";

const nodes = (...n: string[]) => ["+KM", "-KM", ...n];

/** 基本控制回路：合闸回路 + 跳闸回路，可选防跳 */
export function controlCircuit(opts: { antiPumping: boolean }): Circuit {
  const comps: Component[] = [
    { id: "QF", type: "breaker", initialState: "open", operateDelayTicks: 1 },
    // 合闸回路：+KM — SA合 — c1 —（TBJ常闭）— c2 — QF常闭 — c3 — HQ — -KM
    { id: "SA_close", type: "contact_no", operable: true, between: ["+KM", "c1"] },
    { id: "QF_b", type: "contact_nc", controlledBy: "QF", between: ["c2", "c3"] },
    { id: "HQ", type: "coil", impedance: "low", drives: "QF", action: "close", between: ["c3", "-KM"] },
    // 跳闸回路：+KM — 跳闸接点 — t1 —（TBJ电流线圈）— t2 — QF常开 — t3 — TQ — -KM
    { id: "KOP", type: "contact_no", operable: true, between: ["+KM", "t1"] },
    { id: "QF_a", type: "contact_no", controlledBy: "QF", between: ["t2", "t3"] },
    { id: "TQ", type: "coil", impedance: "low", drives: "QF", action: "trip", between: ["t3", "-KM"] },
  ];
  if (opts.antiPumping) {
    comps.push(
      { id: "TBJ", type: "relay" },
      { id: "TBJ_I", type: "coil", coilKind: "current", impedance: "low", drives: "TBJ", between: ["t1", "t2"] },
      { id: "TBJ_nc", type: "contact_nc", controlledBy: "TBJ", between: ["c1", "c2"] },
      // 自保持：TBJ 常开接点 + 电压线圈，接在合闸命令之后
      { id: "TBJ_no", type: "contact_no", controlledBy: "TBJ", between: ["c1", "c4"] },
      { id: "TBJ_V", type: "coil", coilKind: "voltage", impedance: "high", drives: "TBJ", between: ["c4", "-KM"] },
    );
  } else {
    // 不带防跳：用两个接点直接把 c1-c2、t1-t2 接通（用 initialState closed 的可操作接点代替导线）
    comps.push(
      { id: "W1", type: "contact_no", operable: true, initialState: "closed", between: ["c1", "c2"] },
      { id: "W2", type: "contact_no", operable: true, initialState: "closed", between: ["t1", "t2"] },
    );
  }
  return {
    schemaVersion: 1, id: "test-control", title: "测试：控制回路",
    nodes: nodes("c1", "c2", "c3", "c4", "t1", "t2", "t3"), components: comps,
  };
}

/** 位置监视：TWJ 经 QF 常闭串 HQ，HWJ 经 QF 常开串 TQ；QK 为控制电源空开 */
export function monitorCircuit(breakerClosed: boolean): Circuit {
  return {
    schemaVersion: 1, id: "test-monitor", title: "测试：位置监视",
    nodes: nodes("p", "a1", "a2", "b1", "b2"),
    components: [
      { id: "QK", type: "contact_no", operable: true, initialState: "closed", between: ["+KM", "p"] },
      { id: "QF", type: "breaker", initialState: breakerClosed ? "closed" : "open" },
      { id: "TWJ", type: "relay" },
      { id: "HWJ", type: "relay" },
      { id: "TWJ_coil", type: "coil", impedance: "high", drives: "TWJ", between: ["p", "a1"] },
      { id: "QF_b", type: "contact_nc", controlledBy: "QF", between: ["a1", "a2"] },
      { id: "HQ", type: "coil", impedance: "low", drives: "QF", action: "close", between: ["a2", "-KM"] },
      { id: "HWJ_coil", type: "coil", impedance: "high", drives: "HWJ", between: ["p", "b1"] },
      { id: "QF_a", type: "contact_no", controlledBy: "QF", between: ["b1", "b2"] },
      { id: "TQ", type: "coil", impedance: "low", drives: "QF", action: "trip", between: ["b2", "-KM"] },
      { id: "F_break", type: "fault_injection", target: "QK", kind: "open_circuit", label: "控制回路断线" },
    ],
  };
}

/** 第 6 条：高阻 TWJ 经常闭接点串接低阻合闸线圈，并与合闸接点并联 */
export function highLowCircuit(): Circuit {
  return {
    schemaVersion: 1, id: "test-highlow", title: "测试：高低阻判定",
    nodes: nodes("n1", "n2"),
    components: [
      { id: "QF", type: "breaker", initialState: "open", operateDelayTicks: 5 },
      { id: "TWJ", type: "relay" },
      { id: "SA", type: "contact_no", operable: true, between: ["+KM", "n1"] },
      { id: "TWJ_coil", type: "coil", impedance: "high", drives: "TWJ", between: ["+KM", "n1"] },
      { id: "QF_b", type: "contact_nc", controlledBy: "QF", between: ["n1", "n2"] },
      { id: "HQ", type: "coil", impedance: "low", drives: "QF", action: "close", between: ["n2", "-KM"] },
    ],
  };
}

/** 第 8 条：两个继电器互相用常闭接点闭锁对方，先更新谁结果就不同 */
export function raceCircuit(): Circuit {
  return {
    schemaVersion: 1, id: "test-race", title: "测试：同步更新",
    nodes: nodes("a", "b"),
    components: [
      { id: "A", type: "relay" },
      { id: "B", type: "relay" },
      { id: "B_nc", type: "contact_nc", controlledBy: "B", between: ["+KM", "a"] },
      { id: "A_coil", type: "coil", drives: "A", between: ["a", "-KM"] },
      { id: "A_nc", type: "contact_nc", controlledBy: "A", between: ["+KM", "b"] },
      { id: "B_coil", type: "coil", drives: "B", between: ["b", "-KM"] },
    ],
  };
}

/** 第 7 条：带长延时的继电器 */
export function slowCircuit(): Circuit {
  return {
    schemaVersion: 1, id: "test-slow", title: "测试：长延时",
    nodes: nodes("x"),
    components: [
      { id: "K", type: "relay" },
      { id: "S", type: "contact_no", operable: true, initialState: "closed", between: ["+KM", "x"] },
      { id: "K_coil", type: "coil", drives: "K", pickupDelayTicks: 50, between: ["x", "-KM"] },
    ],
  };
}
