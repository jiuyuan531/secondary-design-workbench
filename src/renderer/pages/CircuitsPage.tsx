import { useEffect, useMemo, useRef, useState } from "react";
import type { CircuitListItem } from "../../shared/api";
import {
  loadCircuit, initialState, operate, step, run, stateKey, DEFAULT_MAX_TICKS,
  type Circuit, type SimState, type TickReport, type RunStatus, type ScenarioStep,
} from "../../engine/index";
import { powerNodes } from "../../engine/validate";
import { CircuitView } from "../circuit/CircuitView";
import { call } from "../lib";

interface Sim {
  circuit: Circuit;
  state: SimState;
  tick: number;
  /** 最近若干个 tick 的输出（最新在前） */
  log: TickReport[];
  status: { kind: RunStatus | "idle" | "running"; text: string };
  /** 本轮（上次操作后）出现过的状态，用于自动播放时检测振荡 */
  seen: Map<string, number>;
}

const LOG_LIMIT = 50;

function settle(c: Circuit, maxTicks: number): SimState {
  const r = run(c, initialState(c), { maxTicks });
  return r.status === "stable" ? r.finalState : initialState(c);
}

export function CircuitsPage() {
  const [list, setList] = useState<CircuitListItem[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [maxTicks, setMaxTicks] = useState(DEFAULT_MAX_TICKS);
  const [scenarioIdx, setScenarioIdx] = useState(-1);
  const [stepIdx, setStepIdx] = useState(0);
  const [explain, setExplain] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    call(window.api.circuits.list()).then((l) => { setList(l); if (l.length && !file) setFile(l.find((x) => !x.error)?.file ?? null); }).catch((e) => setListErr(e.message));
    window.api.getSettings().then((s) => setMaxTicks(Number(s["sim.maxTicks"]) || DEFAULT_MAX_TICKS));
  }, []);

  const limit = sim?.circuit.maxTicks ?? maxTicks;

  const reset = (c: Circuit) => {
    stop();
    const st = settle(c, c.maxTicks ?? maxTicks);
    setSim({ circuit: c, state: st, tick: 0, log: [], status: { kind: "idle", text: "已复位到初始稳定状态" }, seen: new Map([[stateKey(st), 0]]) });
    setStepIdx(0);
    setExplain(null);
  };

  useEffect(() => {
    if (!file) return;
    setLoadErr(null);
    call(window.api.circuits.read(file))
      .then((text) => { const { circuit } = loadCircuit(text); reset(circuit); setScenarioIdx(circuit.scenarios?.length ? 0 : -1); })
      .catch((e) => { setSim(null); setLoadErr((e as Error).message); });
    return stop;
  }, [file, maxTicks]);

  const preview = useMemo(() => (sim ? step(sim.circuit, sim.state, sim.tick + 1).report : null), [sim]);

  function stop() {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  }

  /** 推进一个 tick，返回是否应停止（稳定 / 振荡 / 超限） */
  const tickOnce = (s: Sim): Sim => {
    const { state, report } = step(s.circuit, s.state, s.tick + 1);
    const t = s.tick + 1;
    const key = stateKey(state);
    const prevKey = stateKey(s.state);
    let status: Sim["status"] = { kind: "running", text: `第 ${t} 个 tick` };
    const seen = new Map(s.seen);
    if (key === prevKey && report.timers.length === 0) status = { kind: "stable", text: `第 ${t} 个 tick 后状态不再变化，回路稳定` };
    else if (seen.has(key)) status = { kind: "oscillation", text: `检测到振荡：第 ${t} 个 tick 后的状态与第 ${seen.get(key)} 个 tick 后完全相同，回路会一直循环（例如跳跃现象）` };
    else if (seen.size > limit) status = { kind: "not_converged", text: `仿真未收敛：已运行 ${limit} 个 tick 仍未稳定，也没有检测到振荡` };
    seen.set(key, t);
    return { ...s, state, tick: t, log: [report, ...s.log].slice(0, LOG_LIMIT), status, seen };
  };

  const doTick = () => setSim((s) => (s ? tickOnce(s) : s));

  const doRun = () => setSim((s) => {
    if (!s) return s;
    const r = run(s.circuit, s.state, { maxTicks: limit, startTick: s.tick });
    const seen = new Map([[stateKey(r.finalState), s.tick + r.ticks.length]]);
    return {
      ...s, state: r.finalState, tick: s.tick + r.ticks.length,
      log: [...[...r.ticks].reverse(), ...s.log].slice(0, LOG_LIMIT),
      status: { kind: r.status, text: r.message + (r.cycle ? `（循环区间：第 ${r.cycle.from}～${r.cycle.to} 个 tick）` : "") },
      seen,
    };
  });

  const togglePlay = () => {
    if (playing) { stop(); return; }
    setPlaying(true);
    timer.current = window.setInterval(() => {
      setSim((s) => {
        if (!s) return s;
        const n = tickOnce(s);
        if (n.status.kind !== "running") stop();
        return n;
      });
    }, 700);
  };

  const applyOperate = (target: string, to: string) => setSim((s) => {
    if (!s) return s;
    try {
      const st = operate(s.circuit, s.state, target, to);
      return { ...s, state: st, status: { kind: "idle", text: `已操作 ${target}，点“单步”或“运行到稳定”观察回路变化` }, seen: new Map([[stateKey(st), s.tick]]) };
    } catch (e) {
      return { ...s, status: { kind: "idle", text: (e as Error).message } };
    }
  });

  const toggleContact = (id: string) => {
    if (!sim) return;
    stop();
    applyOperate(id, sim.state.manual[id] ? "open" : "closed");
  };

  const scenario = sim && scenarioIdx >= 0 ? sim.circuit.scenarios?.[scenarioIdx] : undefined;
  const nextStep = () => {
    if (!scenario || stepIdx >= scenario.steps.length) return;
    stop();
    const st: ScenarioStep = scenario.steps[stepIdx];
    if (st.action === "operate") applyOperate(st.target!, st.to!);
    else if (st.action === "tick") doTick();
    else doRun();
    setExplain(st.explain ?? null);
    setStepIdx(stepIdx + 1);
  };

  const faults = sim?.circuit.components.filter((c) => c.type === "fault_injection") ?? [];
  const relays = sim?.circuit.components.filter((c) => c.type === "relay" || c.type === "breaker") ?? [];
  const latest = sim?.log[0];

  return (
    <section className="circuits-page">
      <aside className="circuit-list">
        <h2>回路库</h2>
        {listErr && <div className="banner error">{listErr}</div>}
        {list?.length === 0 && <p className="muted">回路数据目录里没有回路文件。</p>}
        {groupBy(list ?? [], (x) => x.category ?? "读入失败").map(([cat, items]) => (
          <div key={cat}>
            <div className="list-cat">{cat}</div>
            {items.map((it) => (
              <button key={it.file} className={it.file === file ? "circuit-item active" : "circuit-item"} onClick={() => setFile(it.file)} title={it.error ?? it.file}>
                {it.error ? <span className="err-text">⚠ {it.file}</span> : it.title}
                {it.reviewStatus === "草稿" && <span className="badge draft">草稿</span>}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="circuit-main">
        {loadErr && <div className="banner error"><pre>{loadErr}</pre></div>}
        {sim && preview && (
          <>
            <div className="title-row">
              <h1>{sim.circuit.title}</h1>
              {sim.circuit.reviewStatus !== "已审核" && <span className="badge draft">草稿 · 待审核</span>}
            </div>
            {sim.circuit.reviewStatus !== "已审核" && (
              <div className="banner warn small">这是程序附带的草稿回路，接法、元件高低阻取值和讲解都还没有经过审核，仅用于演示程序功能。</div>
            )}
            <div className="sim-controls">
              <button onClick={() => { stop(); doTick(); }} disabled={playing}>单步</button>
              <button onClick={() => { stop(); doRun(); }} disabled={playing}>运行到稳定</button>
              <button onClick={togglePlay}>{playing ? "暂停" : "自动播放"}</button>
              <button onClick={() => reset(sim.circuit)}>重置</button>
              <span className={`sim-status ${sim.status.kind}`}>tick {sim.tick} · {sim.status.text}</span>
            </div>
            <CircuitView circuit={sim.circuit} state={sim.state} preview={preview} onToggle={toggleContact} positive={powerNodes(sim.circuit).positive} />
            <p className="muted small">点击蓝色接点切换通断。红色粗线为当前导通路径（箭头为电流方向），橙色线圈表示按当前状态判定会动作。</p>
            {preview.notes.length > 0 && <div className="banner warn">{preview.notes.join("；")}</div>}
            <h2>当前状态下的线圈判定</h2>
            <ul className="reasons">
              {preview.coils.map((c) => <li key={c.id} className={c.energized ? "on" : ""}>{c.reason}</li>)}
            </ul>
            {latest && (
              <>
                <h2>第 {latest.tick} 个 tick 的变化</h2>
                {latest.changes.length ? <ul className="changes">{latest.changes.map((c, i) => <li key={i}>{c.text}</li>)}</ul> : <p className="muted">没有变化</p>}
                {latest.timers.length > 0 && <ul className="timers">{latest.timers.map((t) => <li key={t.id}>{t.text}</li>)}</ul>}
                {latest.notes.length > 0 && <div className="banner warn">{latest.notes.join("；")}</div>}
              </>
            )}
          </>
        )}
      </div>

      {sim && (
        <aside className="circuit-side">
          {sim.circuit.scenarios && sim.circuit.scenarios.length > 0 && (
            <div className="side-box">
              <h2>演示场景</h2>
              <select value={scenarioIdx} onChange={(e) => { setScenarioIdx(Number(e.target.value)); reset(sim.circuit); }}>
                {sim.circuit.scenarios.map((s, i) => <option key={i} value={i}>{s.title}</option>)}
              </select>
              {scenario && (
                <>
                  <ol className="steps">
                    {scenario.steps.map((s, i) => (
                      <li key={i} className={i < stepIdx ? "done" : i === stepIdx ? "current" : ""}>{stepTitle(s)}</li>
                    ))}
                  </ol>
                  <div className="toolbar">
                    <button className="primary" onClick={nextStep} disabled={stepIdx >= scenario.steps.length}>
                      {stepIdx >= scenario.steps.length ? "场景已完成" : "下一步"}
                    </button>
                    <button onClick={() => reset(sim.circuit)}>从头开始</button>
                  </div>
                  {explain && <div className="explain">{explain}</div>}
                </>
              )}
            </div>
          )}
          <div className="side-box">
            <h2>继电器与断路器</h2>
            <table className="state-table">
              <tbody>
                {relays.map((r) => {
                  const on = r.type === "relay" ? sim.state.relays[r.id] : sim.state.breakers[r.id]?.closed;
                  const text = r.type === "relay" ? (on ? "动作" : "返回") : on ? "合位" : "分位";
                  return <tr key={r.id}><td>{r.id}</td><td className="muted">{r.label}</td><td><span className={on ? "badge on" : "badge"}>{text}</span></td></tr>;
                })}
              </tbody>
            </table>
          </div>
          {faults.length > 0 && (
            <div className="side-box">
              <h2>故障注入</h2>
              {faults.map((f) => f.type === "fault_injection" && (
                <label key={f.id} className="switch fault-toggle">
                  <input type="checkbox" checked={sim.state.faults.includes(f.id)}
                    onChange={(e) => { stop(); applyOperate(f.id, e.target.checked ? "active" : "inactive"); }} />
                  {f.label ?? f.id}<span className="muted small">（{f.target}）</span>
                </label>
              ))}
            </div>
          )}
          {sim.circuit.description && (
            <div className="side-box">
              <h2>为什么这么接</h2>
              <p className="pre">{sim.circuit.description}</p>
            </div>
          )}
        </aside>
      )}
    </section>
  );
}

function stepTitle(s: ScenarioStep): string {
  if (s.action === "operate") return `操作 ${s.target} → ${({ closed: "闭合", open: "断开", active: "注入故障", inactive: "撤销故障" } as Record<string, string>)[s.to!] ?? s.to}`;
  if (s.action === "tick") return "单步";
  return "运行到稳定";
}

function groupBy<T>(arr: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of arr) (m.get(key(x)) ?? m.set(key(x), []).get(key(x))!).push(x);
  return [...m.entries()];
}
