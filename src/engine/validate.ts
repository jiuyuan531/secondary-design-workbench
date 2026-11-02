/** 回路定义校验：返回中文错误列表，空数组表示通过。 */
import type { Circuit, Component } from "./types";

const BRANCH_TYPES = new Set(["contact_no", "contact_nc", "coil", "lamp", "resistor"]);
const ALL_TYPES = new Set([...BRANCH_TYPES, "power", "relay", "breaker", "fault_injection"]);

export function powerNodes(c: Circuit): { positive: string; negative: string } {
  const p = c.components.find((x) => x.type === "power");
  return p && p.type === "power" ? { positive: p.positive, negative: p.negative } : { positive: "+KM", negative: "-KM" };
}

export function validateCircuit(c: Circuit): string[] {
  const errs: string[] = [];
  if (!c.id) errs.push("缺少回路 id");
  if (!c.title) errs.push("缺少回路标题 title");
  if (!Array.isArray(c.nodes) || c.nodes.length === 0) errs.push("nodes 不能为空");
  if (!Array.isArray(c.components)) return [...errs, "components 必须是数组"];
  const nodes = new Set(c.nodes ?? []);
  const byId = new Map<string, Component>();
  for (const comp of c.components) {
    if (!comp.id) { errs.push("有元件缺少 id"); continue; }
    if (byId.has(comp.id)) errs.push(`元件 id 重复：${comp.id}`);
    byId.set(comp.id, comp);
    if (!ALL_TYPES.has(comp.type)) errs.push(`${comp.id}：未知的元件类型 ${String(comp.type)}`);
  }
  const powers = c.components.filter((x) => x.type === "power");
  if (powers.length > 1) errs.push("只能有一个 power 元件");
  const { positive, negative } = powerNodes(c);
  if (!nodes.has(positive)) errs.push(`正电源节点 ${positive} 不在 nodes 里`);
  if (!nodes.has(negative)) errs.push(`负电源节点 ${negative} 不在 nodes 里`);

  const isRelayOrBreaker = (id: string | undefined) => {
    const t = id ? byId.get(id)?.type : undefined;
    return t === "relay" || t === "breaker";
  };
  const nonNegInt = (v: unknown) => v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 0);

  for (const comp of c.components) {
    if (BRANCH_TYPES.has(comp.type)) {
      const b = (comp as { between?: unknown }).between;
      if (!Array.isArray(b) || b.length !== 2) { errs.push(`${comp.id}：between 必须是两个节点`); continue; }
      for (const n of b) if (!nodes.has(n)) errs.push(`${comp.id}：节点 ${String(n)} 不在 nodes 里`);
      if (b[0] === b[1]) errs.push(`${comp.id}：两端不能是同一个节点`);
    }
    switch (comp.type) {
      case "contact_no":
      case "contact_nc":
        if (comp.operable && comp.controlledBy) errs.push(`${comp.id}：不能既可手动操作又被 ${comp.controlledBy} 控制`);
        if (!comp.operable && !comp.controlledBy) errs.push(`${comp.id}：接点要么 operable: true，要么写 controlledBy`);
        if (comp.controlledBy && !isRelayOrBreaker(comp.controlledBy)) errs.push(`${comp.id}：controlledBy 指向的 ${comp.controlledBy} 不是继电器或断路器`);
        if (comp.initialState && !comp.operable) errs.push(`${comp.id}：只有可操作接点才能写 initialState`);
        break;
      case "coil": {
        if (!isRelayOrBreaker(comp.drives)) errs.push(`${comp.id}：drives 指向的 ${String(comp.drives)} 不是继电器或断路器`);
        const target = byId.get(comp.drives);
        if (target?.type === "breaker" && comp.action !== "close" && comp.action !== "trip") errs.push(`${comp.id}：驱动断路器的线圈必须写 action（close 或 trip）`);
        if (target?.type === "relay" && comp.action) errs.push(`${comp.id}：驱动继电器的线圈不写 action`);
        if (comp.impedance && comp.impedance !== "high" && comp.impedance !== "low") errs.push(`${comp.id}：impedance 只能是 high 或 low`);
        if (!nonNegInt(comp.pickupDelayTicks) || !nonNegInt(comp.dropoutDelayTicks)) errs.push(`${comp.id}：延时必须是非负整数`);
        break;
      }
      case "lamp":
      case "resistor":
        if (comp.impedance && comp.impedance !== "high" && comp.impedance !== "low") errs.push(`${comp.id}：impedance 只能是 high 或 low`);
        break;
      case "breaker":
        if (!nonNegInt(comp.operateDelayTicks)) errs.push(`${comp.id}：operateDelayTicks 必须是非负整数`);
        break;
      case "fault_injection": {
        const t = byId.get(comp.target);
        if (!t) { errs.push(`${comp.id}：故障目标 ${comp.target} 不存在`); break; }
        if (comp.kind === "open_circuit" && !BRANCH_TYPES.has(t.type)) errs.push(`${comp.id}：断线只能注入到回路上的元件`);
        else if (comp.kind === "contact_stuck" && t.type !== "contact_no" && t.type !== "contact_nc") errs.push(`${comp.id}：接点粘连只能注入到接点`);
        else if (comp.kind === "coil_burnt" && t.type !== "coil") errs.push(`${comp.id}：线圈烧毁只能注入到线圈`);
        else if (!["open_circuit", "contact_stuck", "coil_burnt"].includes(comp.kind)) errs.push(`${comp.id}：未知的故障类型 ${String(comp.kind)}`);
        break;
      }
    }
  }
  for (const r of c.components.filter((x) => x.type === "relay" || x.type === "breaker")) {
    if (!c.components.some((x) => x.type === "coil" && x.drives === r.id)) errs.push(`${r.id}：没有线圈驱动它`);
  }
  if (c.maxTicks !== undefined && !(Number.isInteger(c.maxTicks) && c.maxTicks > 0)) errs.push("maxTicks 必须是正整数");

  // 演示场景：操作的对象必须存在，并且是可操作接点或故障点
  if (c.scenarios !== undefined && !Array.isArray(c.scenarios)) errs.push("scenarios 必须是数组");
  for (const [si, sc] of (Array.isArray(c.scenarios) ? c.scenarios : []).entries()) {
    const where = `演示场景“${sc?.title ?? si + 1}”`;
    if (!Array.isArray(sc?.steps)) { errs.push(`${where}：steps 必须是数组`); continue; }
    sc.steps.forEach((st, i) => {
      const at = `${where}第 ${i + 1} 步`;
      if (st.action === "tick" || st.action === "run") return;
      if (st.action !== "operate") { errs.push(`${at}：action 只能是 operate、tick 或 run`); return; }
      const t = st.target ? byId.get(st.target) : undefined;
      if (!t) { errs.push(`${at}：操作对象 ${String(st.target)} 不存在`); return; }
      if ((t.type === "contact_no" || t.type === "contact_nc") && t.operable) {
        if (st.to !== "open" && st.to !== "closed") errs.push(`${at}：接点只能操作为 open 或 closed`);
      } else if (t.type === "fault_injection") {
        if (st.to !== "active" && st.to !== "inactive") errs.push(`${at}：故障只能设为 active 或 inactive`);
      } else errs.push(`${at}：${st.target} 不是可操作接点或故障点，不能操作`);
    });
  }
  return errs;
}
