/**
 * 回路仿真引擎（纯 TypeScript，不依赖界面）。
 *
 * 一个 tick 的语义（同步更新，AGENTS.md 2.2 节写死）：
 * 1. 以本 tick 开始时的状态为准，构建导通图，找出正电源到负电源的所有导通路径；
 * 2. 按线圈动作判定规则判定每个线圈是否动作；
 * 3. 根据第 2 步的结果，同时计算所有线圈、继电器、断路器的下一状态（有延时的先倒计时，到 0 才变位）；
 * 4. 一次性写入新状态。接点状态由继电器 / 断路器状态决定，所以也在下一 tick 才变位。
 *
 * 下面几条是实现时补充的简化约定，已列入“待沈确认”（见 docs/回路数据格式.md）：
 * - 继电器由一个或多个线圈驱动，任一线圈（经延时后）有效即动作；
 * - 线圈动作 / 返回延时倒计时期间条件消失，倒计时取消（像时间继电器一样重新计时）；
 * - 断路器一旦开始分合动作，倒计时期间即使命令消失也会完成动作；
 * - 合闸命令和跳闸命令同时存在时，跳闸优先。
 */
import { analyzeConduction, judgeCoil, isBranch, isContact } from "./conduction";
import type {
  BranchComp, BreakerComp, Change, Circuit, CoilComp, CoilJudgement, Component, ContactComp,
  FaultComp, RunResult, SimState, TickReport,
} from "./types";

export const DEFAULT_MAX_TICKS = 200;

export class SimError extends Error {}

function index(circuit: Circuit): Map<string, Component> {
  return new Map(circuit.components.map((c) => [c.id, c]));
}

function name(c: Component | undefined, fallback: string): string {
  return c?.label ? `${c.id}（${c.label}）` : fallback;
}

export function initialState(circuit: Circuit): SimState {
  const s: SimState = { manual: {}, faults: [], coils: {}, relays: {}, breakers: {} };
  for (const c of circuit.components) {
    if ((c.type === "contact_no" || c.type === "contact_nc") && c.operable) {
      s.manual[c.id] = c.initialState ? c.initialState === "closed" : c.type === "contact_nc";
    } else if (c.type === "coil") s.coils[c.id] = { active: false };
    else if (c.type === "relay") s.relays[c.id] = c.initialState === "picked";
    else if (c.type === "breaker") s.breakers[c.id] = { closed: c.initialState === "closed" };
  }
  return s;
}

/** 用户操作：切换可操作接点，或注入 / 撤销故障。不推进时间。 */
export function operate(circuit: Circuit, state: SimState, target: string, to: string): SimState {
  const c = index(circuit).get(target);
  if (!c) throw new SimError(`找不到元件 ${target}`);
  const next = clone(state);
  if ((c.type === "contact_no" || c.type === "contact_nc") && c.operable) {
    if (to !== "open" && to !== "closed") throw new SimError(`接点只能操作为 open 或 closed，收到 ${to}`);
    next.manual[target] = to === "closed";
    return next;
  }
  if (c.type === "fault_injection") {
    if (to !== "active" && to !== "inactive") throw new SimError(`故障只能设为 active 或 inactive，收到 ${to}`);
    next.faults = next.faults.filter((f) => f !== target);
    if (to === "active") next.faults.push(target);
    next.faults.sort();
    return next;
  }
  throw new SimError(`${target} 不能手动操作（只有 operable 的接点和故障点可以操作）`);
}

function activeFaults(circuit: Circuit, state: SimState): FaultComp[] {
  const set = new Set(state.faults);
  return circuit.components.filter((c): c is FaultComp => c.type === "fault_injection" && set.has(c.id));
}

function hasFault(faults: FaultComp[], target: string, kind: FaultComp["kind"]): boolean {
  return faults.some((f) => f.target === target && f.kind === kind);
}

/** 接点是否被它的继电器 / 断路器（或手动）操作到“动作位置” */
function contactConducts(c: ContactComp, state: SimState, byId: Map<string, Component>, faults: FaultComp[]): boolean {
  if (hasFault(faults, c.id, "contact_stuck")) return true;
  if (hasFault(faults, c.id, "open_circuit")) return false;
  if (c.operable) return state.manual[c.id] ?? false;
  const ctrl = byId.get(c.controlledBy!);
  const actuated = ctrl?.type === "relay" ? !!state.relays[ctrl.id] : ctrl?.type === "breaker" ? !!state.breakers[ctrl.id]?.closed : false;
  return c.type === "contact_no" ? actuated : !actuated;
}

function branchConducts(b: BranchComp, state: SimState, byId: Map<string, Component>, faults: FaultComp[]): boolean {
  if (b.type === "contact_no" || b.type === "contact_nc") return contactConducts(b, state, byId, faults);
  if (hasFault(faults, b.id, "open_circuit")) return false;
  if (b.type === "coil" && hasFault(faults, b.id, "coil_burnt")) return false;
  return true;
}

/** 推进一个 tick。返回新状态和本 tick 的输出，不修改传入的状态。 */
export function step(circuit: Circuit, state: SimState, tickNo = 1): { state: SimState; report: TickReport } {
  const byId = index(circuit);
  const faults = activeFaults(circuit, state);
  const notes: string[] = [];

  // 1. 导通分析（只看本 tick 开始时的状态）
  const cond = analyzeConduction(circuit, (b) => branchConducts(b, state, byId, faults));
  if (cond.powerShorted) notes.push("警告：正负电源之间有一条全部由闭合接点组成的通路，相当于电源短路");
  if (cond.truncated) notes.push(`导通路径超过 ${cond.paths.length} 条，已截断，判定结果可能不完整`);

  // 2. 线圈动作判定
  const coils = circuit.components.filter((c): c is CoilComp => c.type === "coil");
  const judgements: CoilJudgement[] = coils.map((c) =>
    judgeCoil(c, cond, byId, { burnt: hasFault(faults, c.id, "coil_burnt"), openCircuit: hasFault(faults, c.id, "open_circuit") }),
  );
  const energized = new Map(judgements.map((j) => [j.id, j.energized]));

  // 3. 同时计算下一状态
  const next = clone(state);
  for (const c of coils) {
    const cur = state.coils[c.id] ?? { active: false };
    const e = energized.get(c.id)!;
    const ns = { ...cur };
    if (cur.timer) {
      const wantPickup = cur.timer.kind === "pickup";
      if (e !== wantPickup) {
        delete ns.timer; // 条件消失，倒计时取消
      } else {
        const remaining = cur.timer.remaining - 1;
        if (remaining <= 0) { ns.active = wantPickup; delete ns.timer; }
        else ns.timer = { ...cur.timer, remaining };
      }
    } else if (e !== cur.active) {
      const delay = e ? c.pickupDelayTicks ?? 0 : c.dropoutDelayTicks ?? 0;
      if (delay <= 0) ns.active = e;
      else ns.timer = { kind: e ? "pickup" : "dropout", remaining: delay };
    }
    next.coils[c.id] = ns;
  }
  for (const r of circuit.components.filter((c) => c.type === "relay")) {
    next.relays[r.id] = coils.some((c) => c.drives === r.id && next.coils[c.id].active);
  }
  for (const b of circuit.components.filter((c): c is BreakerComp => c.type === "breaker")) {
    const cur = state.breakers[b.id] ?? { closed: false };
    const ns = { ...cur };
    const cmd = (action: "close" | "trip") => coils.some((c) => c.drives === b.id && c.action === action && next.coils[c.id].active);
    const close = cmd("close");
    const trip = cmd("trip");
    if (cur.pending) {
      const remaining = cur.pending.remaining - 1;
      if (remaining <= 0) { ns.closed = cur.pending.to === "closed"; delete ns.pending; }
      else ns.pending = { ...cur.pending, remaining };
    } else {
      if (close && trip) notes.push(`${b.id} 同时收到合闸和跳闸命令，按跳闸优先处理`);
      const want = trip ? false : close ? true : null;
      if (want !== null && want !== cur.closed) {
        const delay = b.operateDelayTicks ?? 1;
        if (delay <= 0) ns.closed = want;
        else ns.pending = { to: want ? "closed" : "open", remaining: delay };
      }
    }
    next.breakers[b.id] = ns;
  }

  // 4. 整理输出
  const changes: Change[] = [];
  for (const c of coils) {
    const a = state.coils[c.id]?.active ?? false;
    const b = next.coils[c.id].active;
    if (a !== b) changes.push({ id: c.id, from: a ? "动作" : "返回", to: b ? "动作" : "返回", text: `线圈 ${name(c, c.id)} ${b ? "动作" : "返回"}` });
  }
  for (const r of circuit.components.filter((c) => c.type === "relay")) {
    const a = !!state.relays[r.id];
    const b = next.relays[r.id];
    if (a !== b) changes.push({ id: r.id, from: a ? "动作" : "返回", to: b ? "动作" : "返回", text: `继电器 ${name(r, r.id)} ${b ? "动作" : "返回"}` });
  }
  for (const br of circuit.components.filter((c) => c.type === "breaker")) {
    const a = !!state.breakers[br.id]?.closed;
    const b = next.breakers[br.id].closed;
    if (a !== b) changes.push({ id: br.id, from: a ? "合位" : "分位", to: b ? "合位" : "分位", text: `断路器 ${name(br, br.id)} ${b ? "合上" : "跳开"}` });
  }
  const nextFaults = activeFaults(circuit, next);
  for (const c of circuit.components) {
    if (!isBranch(c) || !isContact(c) || (c as ContactComp).operable) continue;
    const a = contactConducts(c as ContactComp, state, byId, faults);
    const b = contactConducts(c as ContactComp, next, byId, nextFaults);
    if (a !== b) changes.push({ id: c.id, from: a ? "闭合" : "断开", to: b ? "闭合" : "断开", text: `接点 ${name(c, c.id)} ${b ? "闭合" : "断开"}` });
  }

  const report: TickReport = {
    tick: tickNo,
    paths: cond.paths,
    coils: judgements,
    changes,
    breakers: Object.fromEntries(Object.entries(next.breakers).map(([k, v]) => [k, v.closed ? "closed" : "open"])),
    timers: listTimers(next),
    notes,
  };
  return { state: next, report };
}

function listTimers(s: SimState): TickReport["timers"] {
  const out: TickReport["timers"] = [];
  for (const [id, c] of Object.entries(s.coils)) {
    if (c.timer) out.push({ id, remaining: c.timer.remaining, text: `线圈 ${id} ${c.timer.kind === "pickup" ? "动作" : "返回"}延时，还剩 ${c.timer.remaining} 个 tick` });
  }
  for (const [id, b] of Object.entries(s.breakers)) {
    if (b.pending) out.push({ id, remaining: b.pending.remaining, text: `断路器 ${id} 正在${b.pending.to === "closed" ? "合闸" : "分闸"}，还剩 ${b.pending.remaining} 个 tick` });
  }
  return out;
}

/** 连续执行 tick，直到稳定、检测到振荡或超过步数上限。 */
export function run(circuit: Circuit, state: SimState, opts: { maxTicks?: number; startTick?: number } = {}): RunResult {
  const maxTicks = opts.maxTicks ?? circuit.maxTicks ?? DEFAULT_MAX_TICKS;
  const start = opts.startTick ?? 0;
  const ticks: TickReport[] = [];
  const seen = new Map<string, number>([[stateKey(state), start]]);
  let cur = state;
  let prevKey = stateKey(state);
  for (let k = 1; k <= maxTicks; k++) {
    const t = start + k;
    const { state: next, report } = step(circuit, cur, t);
    ticks.push(report);
    const key = stateKey(next);
    if (key === prevKey && report.timers.length === 0) {
      return { status: "stable", ticks, finalState: next, message: `第 ${t} 个 tick 后状态不再变化，回路稳定` };
    }
    const first = seen.get(key);
    if (first !== undefined) {
      return {
        status: "oscillation", ticks, finalState: next, cycle: { from: first, to: t },
        message: `检测到振荡：第 ${t} 个 tick 后的状态与第 ${first} 个 tick 后完全相同，回路会一直循环（例如跳跃现象）`,
      };
    }
    seen.set(key, t);
    prevKey = key;
    cur = next;
  }
  return {
    status: "not_converged", ticks, finalState: cur,
    message: `仿真未收敛：运行了 ${maxTicks} 个 tick 仍未稳定，也没有检测到振荡`,
  };
}

/** 完整状态的规范化字符串（键排序），用于稳定和振荡判定 */
export function stateKey(s: SimState): string {
  return canonical(s);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function clone(s: SimState): SimState {
  return JSON.parse(JSON.stringify(s));
}
