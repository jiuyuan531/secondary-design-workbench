/**
 * 回路数据格式（当前 schemaVersion = 1）与仿真状态的类型定义。
 * 格式说明见 docs/回路数据格式.md。
 */

export const CIRCUIT_SCHEMA_VERSION = 1;

export type Impedance = "high" | "low";
export type FaultKind = "open_circuit" | "contact_stuck" | "coil_burnt";

interface Base {
  id: string;
  label?: string;
}

/** 正、负电源节点。不写时默认 +KM / -KM。 */
export interface PowerComp extends Base {
  type: "power";
  positive: string;
  negative: string;
}

export interface ContactComp extends Base {
  type: "contact_no" | "contact_nc";
  between: [string, string];
  /** 可由用户点击操作 */
  operable?: boolean;
  /** 被哪个继电器或断路器控制 */
  controlledBy?: string;
  /** 仅可操作接点：初始是否闭合。不写时常开为断开、常闭为闭合 */
  initialState?: "open" | "closed";
}

export interface CoilComp extends Base {
  type: "coil";
  between: [string, string];
  coilKind?: "voltage" | "current";
  impedance?: Impedance;
  /** 驱动的继电器或断路器 id */
  drives: string;
  /** 驱动断路器时必填：合闸 close / 跳闸 trip */
  action?: "close" | "trip";
  pickupDelayTicks?: number;
  dropoutDelayTicks?: number;
}

export interface RelayComp extends Base {
  type: "relay";
  initialState?: "picked" | "dropped";
}

export interface BreakerComp extends Base {
  type: "breaker";
  initialState?: "open" | "closed";
  /** 收到分合命令后经过多少个 tick 变位，默认 1 */
  operateDelayTicks?: number;
}

export interface PassiveComp extends Base {
  type: "lamp" | "resistor";
  between: [string, string];
  impedance?: Impedance;
}

/** 可注入的故障点 */
export interface FaultComp extends Base {
  type: "fault_injection";
  target: string;
  kind: FaultKind;
}

export type Component = PowerComp | ContactComp | CoilComp | RelayComp | BreakerComp | PassiveComp | FaultComp;
export type BranchComp = ContactComp | CoilComp | PassiveComp;

export interface ScenarioStep {
  action: "operate" | "tick" | "run";
  target?: string;
  to?: "open" | "closed" | "active" | "inactive";
  explain?: string;
}

export interface Scenario {
  title: string;
  steps: ScenarioStep[];
}

export interface Circuit {
  schemaVersion: number;
  id: string;
  title: string;
  category?: string;
  reviewStatus?: "草稿" | "已审核";
  description?: string;
  nodes: string[];
  components: Component[];
  layout?: Record<string, { x: number; y: number; [k: string]: unknown }>;
  scenarios?: Scenario[];
  /** 本回路的仿真步数上限，优先于设置里的值 */
  maxTicks?: number;
}

// ---------------- 仿真状态 ----------------

export interface Timer {
  kind: "pickup" | "dropout";
  remaining: number;
}

export interface CoilState {
  /** 线圈输出（经过延时后）是否有效 */
  active: boolean;
  timer?: Timer;
}

export interface BreakerState {
  closed: boolean;
  pending?: { to: "open" | "closed"; remaining: number };
}

export interface SimState {
  /** 可操作接点是否闭合 */
  manual: Record<string, boolean>;
  /** 已注入的故障点 id */
  faults: string[];
  coils: Record<string, CoilState>;
  relays: Record<string, boolean>;
  breakers: Record<string, BreakerState>;
}

// ---------------- 每个 tick 的输出 ----------------

export interface CoilJudgement {
  id: string;
  energized: boolean;
  /** 中文原因，供界面讲解 */
  reason: string;
}

export interface Change {
  id: string;
  from: string;
  to: string;
  text: string;
}

export interface TickReport {
  /** 第几个 tick（从 1 开始） */
  tick: number;
  /** 本 tick 开始时的导通路径，每条路径是元件 id 序列（从正电源到负电源） */
  paths: string[][];
  coils: CoilJudgement[];
  /** 本 tick 后发生的变化：线圈、继电器、断路器、接点 */
  changes: Change[];
  breakers: Record<string, "open" | "closed">;
  /** 本 tick 结束后仍在倒计时的延时 */
  timers: { id: string; text: string; remaining: number }[];
  notes: string[];
}

export type RunStatus = "stable" | "oscillation" | "not_converged";

export interface RunResult {
  status: RunStatus;
  ticks: TickReport[];
  finalState: SimState;
  /** 振荡时：循环从第 from 个 tick 后的状态开始，到第 to 个 tick 后回到同一状态 */
  cycle?: { from: number; to: number };
  message: string;
}
