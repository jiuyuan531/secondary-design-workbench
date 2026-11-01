/**
 * 回路图几何：根据 layout 计算元件端点和导线走向。
 *
 * layout 写法：
 * - 回路上的元件：{ "x": 中心横坐标, "y": 中心纵坐标, "dir": "h" | "v", "len": 长度(默认 70), "flip": 是否两端对调 }
 *   水平元件 between[0] 在左、between[1] 在右；竖直元件 between[0] 在上。
 * - 节点（可选）：{ "x", "y", "points": [[x, y], ...] }，用来画母线或指定导线拐点。
 * 同一节点的所有端点和 points 用最短的横竖折线连成一棵树。
 */
import type { BranchComp, Circuit } from "../../engine/types";

export type Pt = [number, number];
export const DEFAULT_LEN = 70;

export interface Placed {
  comp: BranchComp;
  x: number;
  y: number;
  dir: "h" | "v";
  len: number;
  /** between[0]、between[1] 的端点坐标 */
  ends: [Pt, Pt];
  autoPlaced: boolean;
}

export interface WireSeg {
  node: string;
  pts: Pt[];
  /** 连接 a、b 两个点（在 nodePoints 里的下标） */
  a: number;
  b: number;
}

export interface Geometry {
  placed: Placed[];
  nodePoints: Map<string, { pt: Pt; comp?: string; anchor?: boolean }[]>;
  wires: WireSeg[];
  viewBox: [number, number, number, number];
  missingLayout: string[];
}

function isBranch(c: Circuit["components"][number]): c is BranchComp {
  return "between" in c;
}

export function computeGeometry(circuit: Circuit): Geometry {
  const layout = (circuit.layout ?? {}) as Record<string, Record<string, unknown>>;
  const placed: Placed[] = [];
  const missingLayout: string[] = [];
  let autoY = 0;
  for (const c of circuit.components.filter(isBranch)) {
    const l = layout[c.id];
    let x: number, y: number, dir: "h" | "v", len: number, auto = false;
    if (l && typeof l.x === "number" && typeof l.y === "number") {
      x = l.x; y = l.y; dir = l.dir === "v" ? "v" : "h"; len = typeof l.len === "number" ? l.len : DEFAULT_LEN;
    } else {
      // 没写布局的元件依次排在下方，提示用户补布局
      missingLayout.push(c.id);
      auto = true;
      x = 470; y = 1000 + autoY; dir = "h"; len = DEFAULT_LEN; autoY += 60;
    }
    const h = len / 2;
    let ends: [Pt, Pt] = dir === "h" ? [[x - h, y], [x + h, y]] : [[x, y - h], [x, y + h]];
    if (l?.flip) ends = [ends[1], ends[0]];
    placed.push({ comp: c, x, y, dir, len, ends, autoPlaced: auto });
  }

  const nodePoints = new Map<string, { pt: Pt; comp?: string; anchor?: boolean }[]>();
  for (const n of circuit.nodes) nodePoints.set(n, []);
  for (const p of placed) {
    p.comp.between.forEach((n, i) => nodePoints.get(n)?.push({ pt: p.ends[i], comp: p.comp.id }));
  }
  for (const n of circuit.nodes) {
    const l = layout[n];
    if (!l) continue;
    const pts = Array.isArray(l.points) ? (l.points as Pt[]) : typeof l.x === "number" ? [[l.x, l.y] as Pt] : [];
    // 第一个点视为节点的“引出点”（电源节点就是电源接入处）
    pts.forEach((pt, i) => nodePoints.get(n)!.push({ pt: [pt[0], pt[1]], anchor: i === 0 }));
  }

  const wires: WireSeg[] = [];
  for (const [node, pts] of nodePoints) {
    for (const [a, b] of mst(pts.map((p) => p.pt))) wires.push({ node, a, b, pts: route(pts[a].pt, pts[b].pt) });
  }

  const all: Pt[] = [...placed.flatMap((p) => p.ends), ...[...nodePoints.values()].flat().map((p) => p.pt)];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minX = Math.min(...xs, 0) - 30, minY = Math.min(...ys, 0) - 40;
  const maxX = Math.max(...xs, 100) + 30, maxY = Math.max(...ys, 100) + 40;
  return { placed, nodePoints, wires, viewBox: [minX, minY, maxX - minX, maxY - minY], missingLayout };
}

/** 曼哈顿距离的最小生成树（Prim），返回下标对 */
function mst(pts: Pt[]): [number, number][] {
  if (pts.length < 2) return [];
  const inTree = new Set([0]);
  const edges: [number, number][] = [];
  const d = (i: number, j: number) => Math.abs(pts[i][0] - pts[j][0]) + Math.abs(pts[i][1] - pts[j][1]);
  while (inTree.size < pts.length) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const i of inTree) for (let j = 0; j < pts.length; j++) {
      if (inTree.has(j)) continue;
      const dd = d(i, j);
      if (dd < bestD) { bestD = dd; best = [i, j]; }
    }
    edges.push(best!);
    inTree.add(best![1]);
  }
  return edges;
}

/** 先横后竖的折线 */
function route(p: Pt, q: Pt): Pt[] {
  if (p[0] === q[0] || p[1] === q[1]) return [p, q];
  return [p, [q[0], p[1]], q];
}

/**
 * 导线是否带电：节点的连线树里，某条边两侧都有“在导通路径上的元件端点”（电源节点还包括电源接入点）时，这条边有电流流过。
 */
export function hotWires(geo: Geometry, hotComps: Set<string>, powerNodes: string[] = []): Set<WireSeg> {
  const hot = new Set<WireSeg>();
  const byNode = new Map<string, WireSeg[]>();
  for (const w of geo.wires) (byNode.get(w.node) ?? byNode.set(w.node, []).get(w.node)!).push(w);
  for (const [node, ws] of byNode) {
    const pts = geo.nodePoints.get(node)!;
    const isHot = pts.map((p) => !!p.comp && hotComps.has(p.comp));
    // 电源节点：有电流流出 / 流入时，电源接入点也算一个热点
    if (powerNodes.includes(node) && isHot.some(Boolean)) pts.forEach((p, i) => { if (p.anchor) isHot[i] = true; });
    const total = isHot.filter(Boolean).length;
    if (total < 2) continue;
    for (const w of ws) {
      // 去掉这条边后，从 a 侧能到达的热点数
      const seen = new Set([w.a]);
      const stack = [w.a];
      while (stack.length) {
        const v = stack.pop()!;
        for (const e of ws) {
          if (e === w) continue;
          const u = e.a === v ? e.b : e.b === v ? e.a : -1;
          if (u >= 0 && !seen.has(u)) { seen.add(u); stack.push(u); }
        }
      }
      const side = [...seen].filter((i) => isHot[i]).length;
      if (side > 0 && side < total) hot.add(w);
    }
  }
  return hot;
}

/** 每个导通元件的电流方向：true 表示从 between[0] 流向 between[1] */
export function currentDirections(circuit: Circuit, paths: string[][], positive: string): Map<string, boolean> {
  const byId = new Map(circuit.components.filter(isBranch).map((c) => [c.id, c]));
  const out = new Map<string, boolean>();
  for (const path of paths) {
    let node = positive;
    for (const id of path) {
      const c = byId.get(id)!;
      const forward = c.between[0] === node;
      if (!out.has(id)) out.set(id, forward);
      node = forward ? c.between[1] : c.between[0];
    }
  }
  return out;
}
