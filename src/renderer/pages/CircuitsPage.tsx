import { useEffect, useMemo, useRef, useState } from "react";
import type { CircuitListItem } from "../../shared/api";
import { loadCircuit, step, DEFAULT_MAX_TICKS, type Circuit, type ScenarioStep } from "../../engine/index";
import { powerNodes } from "../../engine/validate";
import { CircuitView } from "../circuit/CircuitView";
import { CircuitEditor, blankCircuitText, copyCircuitText } from "../circuit/CircuitEditor";
import {
  newSim, tickOnce, runToEnd, applyOperate, playStep, newPlayer, hasSomethingToPlay,
  type Sim, type Player,
} from "../circuit/session";
import { call } from "../lib";

const SPEEDS = [
  { label: "慢", ms: 1200 },
  { label: "中", ms: 700 },
  { label: "快", ms: 300 },
];

type EditorState = { file: string | null; text: string } | null;

export function CircuitsPage() {
  const [list, setList] = useState<CircuitListItem[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string>("");
  const [sim, setSim] = useState<Sim | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [maxTicks, setMaxTicks] = useState(DEFAULT_MAX_TICKS);
  const [scenarioIdx, setScenarioIdx] = useState(-1);
  const [stepIdx, setStepIdx] = useState(0);
  const [explain, setExplain] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [speed, setSpeed] = useState(SPEEDS[1].ms);
  const [big, setBig] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [circuitsDir, setCircuitsDir] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // 自动播放用 ref 读最新值，避免定时器拿到旧状态
  const simRef = useRef(sim);
  simRef.current = sim;
  const playerRef = useRef<Player | null>(null);
  const timer = useRef<number | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const refreshList = (select?: string) =>
    call(window.api.circuits.list())
      .then((l) => {
        setList(l);
        setListErr(null);
        if (select) setFile(select);
        else setFile((cur) => (cur && l.some((x) => x.file === cur) ? cur : l.find((x) => !x.error)?.file ?? null));
      })
      .catch((e) => setListErr(e.message));

  useEffect(() => {
    refreshList();
    window.api.getSettings().then((s) => setMaxTicks(Number(s["sim.maxTicks"]) || DEFAULT_MAX_TICKS));
    window.api.getAppInfo().then((i) => setCircuitsDir(i.circuitsDir));
    return stop;
  }, []);

  // 大图模式下按 Esc 退出
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !editor) setBig(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big, editor]);

  const limit = sim?.circuit.maxTicks ?? maxTicks;
  const limitRef = useRef(limit);
  limitRef.current = limit;

  const reset = (c: Circuit) => {
    stop();
    setSim(newSim(c, c.maxTicks ?? maxTicks));
    setStepIdx(0);
    setExplain(null);
    setNotice(null);
  };

  useEffect(() => {
    if (!file) { setSim(null); return; }
    setLoadErr(null);
    call(window.api.circuits.read(file))
      .then((text) => {
        setFileText(text);
        const { circuit } = loadCircuit(text);
        reset(circuit);
        setScenarioIdx(circuit.scenarios?.length ? 0 : -1);
      })
      .catch((e) => { setSim(null); setLoadErr((e as Error).message); });
    return stop;
  }, [file, maxTicks, reloadKey]);

  const preview = useMemo(() => (sim ? step(sim.circuit, sim.state, sim.tick + 1).report : null), [sim]);
  const scenario = sim && scenarioIdx >= 0 ? sim.circuit.scenarios?.[scenarioIdx] : undefined;
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  function stop() {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    playerRef.current = null;
    setPlaying(false);
  }

  const doTick = () => { setNotice(null); setSim((s) => (s ? tickOnce(s, limit) : s)); };
  const doRun = () => { setNotice(null); setSim((s) => (s ? runToEnd(s, limit) : s)); };

  const loop = () => {
    const s = simRef.current;
    const p = playerRef.current;
    if (!s || !p) { stop(); return; }
    const r = playStep(s, scenarioRef.current, p, limitRef.current);
    simRef.current = r.sim;
    setSim(r.sim);
    playerRef.current = r.player;
    setStepIdx(r.player.stepIdx);
    if (r.explain !== undefined) setExplain(r.explain);
    if (r.done) { stop(); setNotice(r.message ?? null); return; }
    timer.current = window.setTimeout(loop, r.pause === "tick" ? speedRef.current : speedRef.current * 2.5);
  };

  const togglePlay = () => {
    if (playing) { stop(); return; }
    let s = simRef.current;
    if (!s) return;
    let from = stepIdx;
    if (!hasSomethingToPlay(s, scenario, from)) {
      if (!scenario) {
        setNotice("回路现在是稳定的，没有可以播放的变化。先点击图上的蓝色接点（或者在右侧选一个演示场景），再点“自动播放”，就能一步一步看到回路的动作过程。");
        return;
      }
      // 场景已经播完：从头重播
      s = newSim(s.circuit, limit);
      simRef.current = s;
      setSim(s);
      setExplain(null);
      from = 0;
      setStepIdx(0);
    }
    setNotice(null);
    playerRef.current = newPlayer(from);
    setPlaying(true);
    timer.current = window.setTimeout(loop, 150);
  };

  const operateNow = (target: string, to: string) => { setNotice(null); setSim((s) => (s ? applyOperate(s, target, to) : s)); };

  const toggleContact = (id: string) => {
    if (!sim) return;
    stop();
    operateNow(id, sim.state.manual[id] ? "open" : "closed");
  };

  const nextStep = () => {
    if (!scenario || stepIdx >= scenario.steps.length) return;
    stop();
    const st: ScenarioStep = scenario.steps[stepIdx];
    if (st.action === "operate") operateNow(st.target!, st.to!);
    else if (st.action === "tick") doTick();
    else doRun();
    setExplain(st.explain ?? null);
    setStepIdx(stepIdx + 1);
  };

  const openEditor = (mode: "edit" | "copy" | "blank") => {
    stop();
    if (mode === "edit" && file) setEditor({ file, text: fileText });
    else if (mode === "copy" && fileText) setEditor({ file: null, text: copyCircuitText(fileText) });
    else setEditor({ file: null, text: blankCircuitText() });
  };

  const onSaved = (saved: string) => {
    setEditor(null);
    if (saved === file) setReloadKey((k) => k + 1);
    refreshList(saved);
  };

  const faults = sim?.circuit.components.filter((c) => c.type === "fault_injection") ?? [];
  const relays = sim?.circuit.components.filter((c) => c.type === "relay" || c.type === "breaker") ?? [];
  const latest = sim?.log[0];
  const brokenFile = list?.find((x) => x.file === file)?.error;

  return (
    <section className={big ? "circuits-page big" : "circuits-page"}>
      {!big && (
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
          <div className="list-actions">
            <button onClick={() => openEditor("blank")}>＋ 新建回路</button>
            <button onClick={() => openEditor("copy")} disabled={!sim} title="以当前选中的回路为底稿另存一份">复制当前回路</button>
            <button onClick={() => openEditor("edit")} disabled={!file} title="编辑当前回路文件">编辑当前回路</button>
            <button className="link" onClick={() => refreshList()}>刷新列表</button>
            {circuitsDir && <button className="link" onClick={() => window.api.openPath(circuitsDir)}>打开回路文件夹</button>}
          </div>
        </aside>
      )}

      <div className="circuit-main">
        {loadErr && (
          <div className="banner error">
            <pre>{loadErr}</pre>
            {brokenFile && file && <button onClick={() => call(window.api.circuits.read(file)).then((t) => setEditor({ file, text: t }))}>打开编辑器修改这个文件</button>}
          </div>
        )}
        {sim && preview && (
          <>
            <div className="title-row">
              <h1>{sim.circuit.title}</h1>
              {sim.circuit.reviewStatus !== "已审核" && <span className="badge draft">草稿 · 待审核</span>}
              <span className="spacer" />
              <button onClick={() => setBig(!big)} title={big ? "回到普通视图（Esc）" : "全窗口显示回路图"}>{big ? "退出大图（Esc）" : "⛶ 放大查看"}</button>
            </div>
            {!big && sim.circuit.reviewStatus !== "已审核" && (
              <div className="banner warn small">这是程序附带的草稿回路，接法、元件高低阻取值和讲解都还没有经过审核，仅用于演示程序功能。</div>
            )}
            <div className="sim-controls">
              <button onClick={() => { stop(); doTick(); }} disabled={playing}>单步</button>
              <button onClick={() => { stop(); doRun(); }} disabled={playing}>运行到稳定</button>
              <button className={playing ? "" : "primary"} onClick={togglePlay}
                title={scenario ? "按右侧场景的步骤自动演示，每一步之间稍作停顿；“运行到稳定”会逐个 tick 慢放" : "把回路从当前状态逐个 tick 慢放到稳定；先点接点改变状态再播放"}>
                {playing ? "⏸ 暂停" : "▶ 自动播放"}
              </button>
              <label className="speed">速度
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {SPEEDS.map((x) => <option key={x.ms} value={x.ms}>{x.label}</option>)}
                </select>
              </label>
              <button onClick={() => reset(sim.circuit)}>重置</button>
              <span className={`sim-status ${sim.status.kind}`}>tick {sim.tick} · {sim.status.text}</span>
            </div>
            {notice && <div className="banner info small">{notice}</div>}
            {big && explain && <div className="explain">{explain}</div>}
            <CircuitView circuit={sim.circuit} state={sim.state} preview={preview} onToggle={toggleContact}
              positive={powerNodes(sim.circuit).positive} className={big ? "big" : ""}
              onBlankDoubleClick={() => setBig(!big)} />
            <p className="muted small">点击蓝色接点切换通断。红色粗线为当前导通路径（箭头为电流方向），橙色线圈表示按当前状态判定会动作。滚轮缩放，按住空白处拖动，双击空白处{big ? "退出" : "进入"}大图。</p>
            {preview.notes.length > 0 && <div className="banner warn">{preview.notes.join("；")}</div>}
            {!big && (
              <>
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
                    <button className="primary" onClick={nextStep} disabled={playing || stepIdx >= scenario.steps.length}>
                      {stepIdx >= scenario.steps.length ? "场景已完成" : "下一步"}
                    </button>
                    <button onClick={() => reset(sim.circuit)}>从头开始</button>
                  </div>
                  {!big && explain && <div className="explain">{explain}</div>}
                </>
              )}
            </div>
          )}
          {big && latest && (
            <div className="side-box">
              <h2>第 {latest.tick} 个 tick 的变化</h2>
              {latest.changes.length ? <ul className="changes">{latest.changes.map((c, i) => <li key={i}>{c.text}</li>)}</ul> : <p className="muted">没有变化</p>}
              {latest.timers.length > 0 && <ul className="timers">{latest.timers.map((t) => <li key={t.id}>{t.text}</li>)}</ul>}
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
                    onChange={(e) => { stop(); operateNow(f.id, e.target.checked ? "active" : "inactive"); }} />
                  {f.label ?? f.id}<span className="muted small">（{f.target}）</span>
                </label>
              ))}
            </div>
          )}
          {!big && sim.circuit.description && (
            <div className="side-box">
              <h2>为什么这么接</h2>
              <p className="pre">{sim.circuit.description}</p>
            </div>
          )}
        </aside>
      )}

      {editor && (
        <CircuitEditor file={editor.file} initialText={editor.text} existingFiles={(list ?? []).map((x) => x.file)}
          onClose={() => setEditor(null)} onSaved={onSaved} />
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
