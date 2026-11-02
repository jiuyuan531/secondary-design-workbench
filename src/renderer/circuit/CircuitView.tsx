import { useEffect, useMemo, useRef, useState } from "react";
import type { Circuit, ContactComp, SimState, TickReport } from "../../engine/types";
import { powerNodes } from "../../engine/validate";
import { computeGeometry, currentDirections, hotWires, type Placed, type Pt } from "./geometry";

type Box = [number, number, number, number];

/** 编辑布局时的回调：拖动元件 / 节点改坐标，双击元件切换横竖 */
export interface LayoutEditing {
  onMove: (id: string, x: number, y: number) => void;
  onRotate: (id: string) => void;
}

const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * SVG 回路图：导通路径高亮（带电流方向箭头），动作的线圈变色，可操作接点可以点击切换。
 * 滚轮缩放、按住空白处拖动平移；传入 editing 时可以拖动元件改布局。
 */
export function CircuitView({ circuit, state, preview, onToggle, positive, editing, className, onBlankDoubleClick }: {
  circuit: Circuit;
  state: SimState;
  /** 以当前状态做一次判定得到的结果（导通路径、线圈是否带电），只用于显示 */
  preview: TickReport;
  onToggle: (id: string) => void;
  positive: string;
  editing?: LayoutEditing;
  className?: string;
  /** 双击空白处（不是元件）时调用，例如切换大图 */
  onBlankDoubleClick?: () => void;
}) {
  const geo = useMemo(() => computeGeometry(circuit), [circuit]);
  const svgRef = useRef<SVGSVGElement>(null);
  // 缩放后的可视区域；null 表示“适应窗口”
  const [view, setView] = useState<Box | null>(null);
  const fit = geo.viewBox;
  const box: Box = view ?? fit;
  const boxRef = useRef(box);
  boxRef.current = box;
  // 换了回路就回到适应窗口
  useEffect(() => setView(null), [circuit.id]);

  const toSvg = (clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };

  const zoomAt = (factor: number, center?: Pt) => {
    const [x, y, w, h] = boxRef.current;
    const nw = Math.min(Math.max(w * factor, fit[2] / 8), fit[2] * 4);
    const k = nw / w;
    const [cx, cy] = center ?? [x + w / 2, y + h / 2];
    setView([cx - (cx - x) * k, cy - (cy - y) * k, w * k, h * k]);
  };

  // 滚轮缩放（React 的 onWheel 是被动监听，不能阻止页面滚动，所以手动注册）
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, toSvg(e.clientX, e.clientY));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  });

  // 拖动：空白处平移；编辑模式下按住元件 / 节点圆点移动它
  const drag = useRef<{ kind: "pan" | "item"; id?: string; start: Pt; origin: Pt; startBox: Box; moved: boolean; cx: number; cy: number } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = (e.target as Element).closest("[data-drag-id]");
    const id = editing && target ? target.getAttribute("data-drag-id")! : undefined;
    const start = toSvg(e.clientX, e.clientY);
    let origin: Pt = [0, 0];
    if (id) {
      const pl = geo.placed.find((p) => p.comp.id === id);
      const nl = (circuit.layout as Record<string, { x?: number; y?: number }> | undefined)?.[id];
      origin = pl ? [pl.x, pl.y] : [nl?.x ?? 0, nl?.y ?? 0];
    }
    drag.current = { kind: id ? "item" : "pan", id, start, origin, startBox: boxRef.current, moved: false, cx: e.clientX, cy: e.clientY };
    suppressClick.current = false;
  };
  // 真正开始拖动后才捕获指针；按下就捕获会让接点收不到点击
  const beginMove = (e: React.PointerEvent, d: NonNullable<typeof drag.current>) => {
    if (d.moved) return;
    d.moved = true;
    svgRef.current?.setPointerCapture(e.pointerId);
    // 拖元件时固定视图，免得图的范围变化导致整体缩放跳动
    if (d.kind === "item") setView(d.startBox);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      // 平移时用起始视图换算，避免视图变化导致抖动
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const [x, y, w, h] = d.startBox;
      const scale = Math.max(w / rect.width, h / rect.height);
      const dx = (e.clientX - d.cx) * scale;
      const dy = (e.clientY - d.cy) * scale;
      if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) > 3) beginMove(e, d);
      if (d.moved) setView([x - dx, y - dy, w, h]);
    } else {
      const p = toSvg(e.clientX, e.clientY);
      const nx = snap(d.origin[0] + p[0] - d.start[0]);
      const ny = snap(d.origin[1] + p[1] - d.start[1]);
      if (nx !== d.origin[0] || ny !== d.origin[1] || d.moved) {
        beginMove(e, d);
        editing!.onMove(d.id!, nx, ny);
      }
    }
  };
  const onPointerUp = () => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
  };
  const clickGuard = (fn?: () => void) => fn && (() => { if (suppressClick.current) { suppressClick.current = false; return; } fn(); });
  const hotComps = useMemo(() => new Set(preview.paths.flat()), [preview]);
  const negative = powerNodes(circuit).negative;
  const hot = useMemo(() => hotWires(geo, hotComps, [positive, negative]), [geo, hotComps, positive, negative]);
  const dirs = useMemo(() => currentDirections(circuit, preview.paths, positive), [circuit, preview, positive]);
  const energized = new Set(preview.coils.filter((c) => c.energized).map((c) => c.id));
  const faultTargets = new Map<string, string>();
  for (const c of circuit.components) if (c.type === "fault_injection" && state.faults.includes(c.id)) faultTargets.set(c.target, c.label ?? c.kind);
  const byId = new Map(circuit.components.map((c) => [c.id, c]));

  const conducts = (c: ContactComp): boolean => {
    const f = circuit.components.find((x) => x.type === "fault_injection" && state.faults.includes(x.id) && x.target === c.id);
    if (f && f.type === "fault_injection") return f.kind === "contact_stuck";
    if (c.operable) return !!state.manual[c.id];
    const ctrl = byId.get(c.controlledBy!);
    const act = ctrl?.type === "relay" ? !!state.relays[ctrl.id] : ctrl?.type === "breaker" ? !!state.breakers[ctrl.id]?.closed : false;
    return c.type === "contact_no" ? act : !act;
  };

  const [vx, vy, vw, vh] = box;
  const layout = circuit.layout as Record<string, { x?: number; y?: number }> | undefined;
  return (
    <div className={`circuit-wrap ${className ?? ""}`}>
      <div className="zoom-bar">
        <button onClick={() => zoomAt(1 / 1.3)} title="放大（也可以滚动鼠标滚轮）">＋</button>
        <button onClick={() => zoomAt(1.3)} title="缩小">－</button>
        <button onClick={() => setView(null)} title="整张图适应窗口">适应</button>
      </div>
      <svg ref={svgRef} className={editing ? "circuit editing" : "circuit"} viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${fit[2]} / ${fit[3]}` }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={(e) => { if (onBlankDoubleClick && !(e.target as Element).closest(".sym, [data-drag-id]")) onBlankDoubleClick(); }}>
        {geo.wires.map((w, i) => (
          <polyline key={i} points={w.pts.map((p) => p.join(",")).join(" ")} className={hot.has(w) ? "wire hot" : "wire"} />
        ))}
        {circuit.nodes.map((n) => {
          const l = layout?.[n];
          if (!l || typeof l.x !== "number") return null;
          return (
            <g key={n}>
              <text x={l.x} y={(l.y ?? 0) - 10} className="node-label">{n}</text>
              {editing && <circle data-drag-id={n} cx={l.x} cy={l.y} r={6} className="node-handle"><title>{`节点 ${n}：拖动移动引出点`}</title></circle>}
            </g>
          );
        })}
        {geo.placed.map((p) => (
          <Symbol key={p.comp.id} p={p}
            hot={hotComps.has(p.comp.id)}
            forward={dirs.get(p.comp.id)}
            energized={energized.has(p.comp.id)}
            closed={p.comp.type === "contact_no" || p.comp.type === "contact_nc" ? conducts(p.comp) : undefined}
            fault={faultTargets.get(p.comp.id)}
            editing={!!editing}
            onDoubleClick={editing ? () => editing.onRotate(p.comp.id) : undefined}
            onClick={clickGuard((p.comp.type === "contact_no" || p.comp.type === "contact_nc") && p.comp.operable && !editing ? () => onToggle(p.comp.id) : undefined)}
          />
        ))}
      </svg>
    </div>
  );
}

function Symbol({ p, hot, forward, energized, closed, fault, onClick, onDoubleClick, editing }: {
  p: Placed; hot: boolean; forward?: boolean; energized: boolean; closed?: boolean; fault?: string;
  onClick?: () => void; onDoubleClick?: () => void; editing: boolean;
}) {
  const { comp, x, y, dir, len } = p;
  const h = len / 2;
  const rot = dir === "v" ? 90 : 0;
  const cls = ["sym", comp.type, hot ? "hot" : "", energized ? "energized" : "", onClick ? "operable" : "", fault ? "faulted" : "", editing ? "movable" : "", p.autoPlaced ? "auto-placed" : ""].join(" ");
  // 电流方向：本地坐标下 +x 方向为 between[0] → between[1]（flip 时相反）
  const flip = (p.ends[0][0] > p.ends[1][0]) || (p.ends[0][1] > p.ends[1][1]);
  const arrowRight = forward === undefined ? undefined : forward !== flip;
  const labelPos: Pt = dir === "h" ? [x, y - 17] : [x + 20, y - 4];
  const subPos: Pt = dir === "h" ? [x, y + 26] : [x + 20, y + 10];
  return (
    <g className={cls} onClick={onClick} onDoubleClick={onDoubleClick} data-drag-id={editing ? comp.id : undefined}>
      <title>{`${comp.id}${comp.label ? "：" + comp.label : ""}${onClick ? "（点击切换）" : ""}${editing ? "（拖动移动，双击切换横竖）" : ""}${p.autoPlaced ? "\n还没有写布局坐标，暂时排在下方" : ""}${fault ? `\n已注入故障：${fault}` : ""}`}</title>
      <g transform={`translate(${x} ${y}) rotate(${rot})`}>
        {(onClick || editing) && <rect x={-h} y={-16} width={len} height={32} className="hit" />}
        <line x1={-h} y1={0} x2={-15} y2={0} className="lead" />
        <line x1={15} y1={0} x2={h} y2={0} className="lead" />
        {(comp.type === "contact_no" || comp.type === "contact_nc") && (
          <>
            <circle cx={-15} cy={0} r={2} className="term" />
            <circle cx={15} cy={0} r={2} className="term" />
            {closed ? <line x1={-15} y1={0} x2={15} y2={0} className="blade" /> : <line x1={-15} y1={0} x2={12} y2={-13} className="blade" />}
            {comp.type === "contact_nc" && <line x1={15} y1={0} x2={15} y2={-12} className="nc-mark" />}
          </>
        )}
        {comp.type === "coil" && <rect x={-15} y={-9} width={30} height={18} className="body" />}
        {comp.type === "resistor" && <rect x={-15} y={-6} width={30} height={12} className="body" />}
        {comp.type === "lamp" && (
          <>
            <circle cx={0} cy={0} r={11} className={hot ? "body lit" : "body"} />
            <line x1={-8} y1={-8} x2={8} y2={8} className="lamp-x" />
            <line x1={-8} y1={8} x2={8} y2={-8} className="lamp-x" />
          </>
        )}
        {hot && arrowRight !== undefined && (
          <path d={arrowRight ? `M ${h - 14} -4 L ${h - 6} 0 L ${h - 14} 4 Z` : `M ${-h + 14} -4 L ${-h + 6} 0 L ${-h + 14} 4 Z`} className="arrow" />
        )}
        {fault && <g className="fault-mark"><line x1={-9} y1={-9} x2={9} y2={9} /><line x1={-9} y1={9} x2={9} y2={-9} /></g>}
      </g>
      <text x={labelPos[0]} y={labelPos[1]} className="sym-id" textAnchor={dir === "h" ? "middle" : "start"}>{comp.id}</text>
      {comp.label && <text x={subPos[0]} y={subPos[1]} className="sym-label" textAnchor={dir === "h" ? "middle" : "start"}>{comp.label}</text>}
    </g>
  );
}
