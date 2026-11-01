import { useMemo } from "react";
import type { Circuit, ContactComp, SimState, TickReport } from "../../engine/types";
import { powerNodes } from "../../engine/validate";
import { computeGeometry, currentDirections, hotWires, type Placed, type Pt } from "./geometry";

/**
 * SVG 回路图：导通路径高亮（带电流方向箭头），动作的线圈变色，可操作接点可以点击切换。
 */
export function CircuitView({ circuit, state, preview, onToggle, positive }: {
  circuit: Circuit;
  state: SimState;
  /** 以当前状态做一次判定得到的结果（导通路径、线圈是否带电），只用于显示 */
  preview: TickReport;
  onToggle: (id: string) => void;
  positive: string;
}) {
  const geo = useMemo(() => computeGeometry(circuit), [circuit]);
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

  const [vx, vy, vw, vh] = geo.viewBox;
  return (
    <svg className="circuit" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMin meet">
      {geo.wires.map((w, i) => (
        <polyline key={i} points={w.pts.map((p) => p.join(",")).join(" ")} className={hot.has(w) ? "wire hot" : "wire"} />
      ))}
      {circuit.nodes.map((n) => {
        const l = (circuit.layout as Record<string, { x?: number; y?: number }> | undefined)?.[n];
        return l && typeof l.x === "number" ? <text key={n} x={l.x} y={(l.y ?? 0) - 10} className="node-label">{n}</text> : null;
      })}
      {geo.placed.map((p) => (
        <Symbol key={p.comp.id} p={p}
          hot={hotComps.has(p.comp.id)}
          forward={dirs.get(p.comp.id)}
          energized={energized.has(p.comp.id)}
          closed={p.comp.type === "contact_no" || p.comp.type === "contact_nc" ? conducts(p.comp) : undefined}
          fault={faultTargets.get(p.comp.id)}
          onClick={(p.comp.type === "contact_no" || p.comp.type === "contact_nc") && p.comp.operable ? () => onToggle(p.comp.id) : undefined}
        />
      ))}
    </svg>
  );
}

function Symbol({ p, hot, forward, energized, closed, fault, onClick }: {
  p: Placed; hot: boolean; forward?: boolean; energized: boolean; closed?: boolean; fault?: string; onClick?: () => void;
}) {
  const { comp, x, y, dir, len } = p;
  const h = len / 2;
  const rot = dir === "v" ? 90 : 0;
  const cls = ["sym", comp.type, hot ? "hot" : "", energized ? "energized" : "", onClick ? "operable" : "", fault ? "faulted" : ""].join(" ");
  // 电流方向：本地坐标下 +x 方向为 between[0] → between[1]（flip 时相反）
  const flip = (p.ends[0][0] > p.ends[1][0]) || (p.ends[0][1] > p.ends[1][1]);
  const arrowRight = forward === undefined ? undefined : forward !== flip;
  const labelPos: Pt = dir === "h" ? [x, y - 17] : [x + 20, y - 4];
  const subPos: Pt = dir === "h" ? [x, y + 26] : [x + 20, y + 10];
  return (
    <g className={cls} onClick={onClick}>
      <title>{`${comp.id}${comp.label ? "：" + comp.label : ""}${onClick ? "（点击切换）" : ""}${fault ? `\n已注入故障：${fault}` : ""}`}</title>
      <g transform={`translate(${x} ${y}) rotate(${rot})`}>
        {onClick && <rect x={-h} y={-16} width={len} height={32} className="hit" />}
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
