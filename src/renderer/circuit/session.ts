/**
 * 回路演示页面的仿真会话（纯函数，不依赖界面，便于测试）。
 * 包括单步、运行到稳定、手动操作，以及“自动播放”每一步该做什么。
 */
import {
  initialState, operate, step, run, stateKey,
  type Circuit, type Scenario, type ScenarioStep, type SimState, type TickReport, type RunStatus,
} from "../../engine/index";

export interface SimStatus {
  kind: RunStatus | "idle" | "running";
  text: string;
  /** 检测到振荡时的循环长度（tick 数） */
  cycle?: number;
}

export interface Sim {
  circuit: Circuit;
  state: SimState;
  tick: number;
  /** 最近若干个 tick 的输出（最新在前） */
  log: TickReport[];
  status: SimStatus;
  /** 本轮（上次操作后）出现过的状态及其 tick，用于检测振荡 */
  seen: Map<string, number>;
}

export const LOG_LIMIT = 50;

/** 新会话：从初始状态先跑到稳定（例如位置继电器先按断路器位置动作好），再作为起点。 */
export function newSim(c: Circuit, maxTicks: number): Sim {
  const r = run(c, initialState(c), { maxTicks });
  const st = r.status === "stable" ? r.finalState : initialState(c);
  return { circuit: c, state: st, tick: 0, log: [], status: { kind: "idle", text: "已复位到初始稳定状态" }, seen: new Map([[stateKey(st), 0]]) };
}

/** 推进一个 tick，并判断稳定 / 振荡 / 超限。 */
export function tickOnce(s: Sim, limit: number): Sim {
  const { state, report } = step(s.circuit, s.state, s.tick + 1);
  const t = s.tick + 1;
  const key = stateKey(state);
  let status: SimStatus = { kind: "running", text: `第 ${t} 个 tick` };
  const seen = new Map(s.seen);
  if (key === stateKey(s.state) && report.timers.length === 0) {
    status = { kind: "stable", text: `第 ${t} 个 tick 后状态不再变化，回路稳定` };
  } else if (seen.has(key)) {
    const from = seen.get(key)!;
    status = {
      kind: "oscillation", cycle: t - from,
      text: `检测到振荡：第 ${t} 个 tick 后的状态与第 ${from} 个 tick 后完全相同，回路会一直循环（例如跳跃现象）`,
    };
  } else if (seen.size > limit) {
    status = { kind: "not_converged", text: `仿真未收敛：已运行 ${limit} 个 tick 仍未稳定，也没有检测到振荡` };
  }
  seen.set(key, t);
  return { ...s, state, tick: t, log: [report, ...s.log].slice(0, LOG_LIMIT), status, seen };
}

/** 一次跑到稳定（或检测到振荡 / 超限）。 */
export function runToEnd(s: Sim, limit: number): Sim {
  const r = run(s.circuit, s.state, { maxTicks: limit, startTick: s.tick });
  return {
    ...s, state: r.finalState, tick: s.tick + r.ticks.length,
    log: [...[...r.ticks].reverse(), ...s.log].slice(0, LOG_LIMIT),
    status: { kind: r.status, text: r.message + (r.cycle ? `（循环区间：第 ${r.cycle.from}～${r.cycle.to} 个 tick）` : "") },
    seen: new Map([[stateKey(r.finalState), s.tick + r.ticks.length]]),
  };
}

/** 手动操作接点或故障开关（不推进时间）。出错时把中文原因写到状态里。 */
export function applyOperate(s: Sim, target: string, to: string): Sim {
  try {
    const st = operate(s.circuit, s.state, target, to);
    return { ...s, state: st, status: { kind: "idle", text: `已操作 ${target}，点“单步”“运行到稳定”或“自动播放”观察回路变化` }, seen: new Map([[stateKey(st), s.tick]]) };
  } catch (e) {
    return { ...s, status: { kind: "idle", text: (e as Error).message } };
  }
}

/** 当前状态再推进一个 tick 也不会有任何变化（没有计时中的延时）。 */
export function isQuiescent(s: Sim): boolean {
  const { state, report } = step(s.circuit, s.state, s.tick + 1);
  return stateKey(state) === stateKey(s.state) && report.timers.length === 0;
}

// ---------------- 自动播放 ----------------

export interface Player {
  /** 下一个要执行的场景步骤 */
  stepIdx: number;
  /** 正在逐个 tick 播放“运行到稳定” */
  settling: boolean;
  /** 检测到振荡后，再多播放几个 tick 让人看清循环；null 表示还没检测到 */
  oscLeft: number | null;
}

export interface PlayResult {
  sim: Sim;
  player: Player;
  /** 本步执行了场景步骤时给出讲解；undefined 表示讲解不变 */
  explain?: string | null;
  /** 播放结束 */
  done: boolean;
  /** 下一步前停顿：tick 是 tick 之间，step 是场景步骤之间（停久一点，留时间看讲解） */
  pause: "tick" | "step";
  /** 结束时给用户的提示 */
  message?: string;
}

export const newPlayer = (stepIdx = 0): Player => ({ stepIdx, settling: false, oscLeft: null });

/** 播放是否还有内容：场景还有步骤没执行，或者回路还会变化。 */
export function hasSomethingToPlay(s: Sim, scenario: Scenario | undefined, stepIdx: number): boolean {
  return (!!scenario && stepIdx < scenario.steps.length) || !isQuiescent(s);
}

/** 自动播放的一步：按场景步骤执行；“运行到稳定”拆成一个个 tick 播放；没有场景时把回路从当前状态播放到稳定。 */
export function playStep(s: Sim, scenario: Scenario | undefined, p: Player, limit: number): PlayResult {
  if (p.settling) return settleTick(s, p, limit, scenario);

  if (scenario && p.stepIdx < scenario.steps.length) {
    const st: ScenarioStep = scenario.steps[p.stepIdx];
    const player = { ...p, stepIdx: p.stepIdx + 1 };
    const explain = st.explain ?? null;
    if (st.action === "operate") return { sim: applyOperate(s, st.target!, st.to!), player, explain, done: false, pause: "step" };
    if (st.action === "tick") return { sim: tickOnce(s, limit), player, explain, done: false, pause: "step" };
    return { ...settleTick(s, { ...player, settling: true, oscLeft: null }, limit, scenario), explain };
  }

  if (!isQuiescent(s)) return settleTick(s, { ...p, settling: true, oscLeft: null }, limit, scenario);
  return {
    sim: s, player: p, done: true, pause: "step",
    message: scenario ? "场景已播放完。再点“自动播放”会从头重播。" : "回路已经稳定，播放结束。",
  };
}

function settleTick(s: Sim, p: Player, limit: number, scenario: Scenario | undefined): PlayResult {
  const n = tickOnce(s, limit);
  const moreSteps = !!scenario && p.stepIdx < scenario.steps.length;
  const finish = (sim: Sim, message?: string): PlayResult => ({
    sim, player: { ...p, settling: false, oscLeft: null }, done: !moreSteps, pause: "step",
    message: moreSteps ? undefined : message,
  });
  switch (n.status.kind) {
    case "running":
      return { sim: n, player: p, done: false, pause: "tick" };
    case "oscillation": {
      // 第一次检测到振荡时，再完整播放一个循环，让人看到“合上→跳开→再合上”的重复过程
      const left = p.oscLeft === null ? n.status.cycle ?? 0 : p.oscLeft - 1;
      if (left > 0) return { sim: n, player: { ...p, oscLeft: left }, done: false, pause: "tick" };
      return finish(n, "回路一直在循环（振荡），已停止播放。");
    }
    case "not_converged":
      return { sim: n, player: { ...p, settling: false, oscLeft: null }, done: true, pause: "step", message: "仿真未收敛，已停止播放。" };
    default:
      return finish(n, scenario ? "场景已播放完。再点“自动播放”会从头重播。" : "回路已经稳定，播放结束。");
  }
}
