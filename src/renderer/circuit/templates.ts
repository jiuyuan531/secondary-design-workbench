/** 新建回路用的模板（纯函数，便于测试）。 */

/** 新建回路的空白模板：只是一个能运行的最小例子，内容需要自己改。 */
export function blankCircuitText(): string {
  const c = {
    schemaVersion: 1,
    id: "new-circuit",
    title: "新回路",
    category: "未分类",
    reviewStatus: "草稿",
    description: "TODO(待沈确认)：写这个回路的作用和为什么这么接。下面的元件只是模板示例，请换成实际回路。",
    nodes: ["+KM", "-KM", "n1"],
    components: [
      { id: "SA", type: "contact_no", label: "操作接点", operable: true, between: ["+KM", "n1"] },
      { id: "K", type: "relay", label: "继电器" },
      { id: "K_coil", type: "coil", label: "K 线圈", coilKind: "voltage", impedance: "high", drives: "K", between: ["n1", "-KM"] },
      { id: "K_no", type: "contact_no", label: "K 常开接点", controlledBy: "K", between: ["+KM", "n1"] },
    ],
    layout: {
      "+KM": { x: 40, y: 60, points: [[40, 60], [40, 150]] },
      "-KM": { x: 520, y: 60, points: [[520, 60], [520, 150]] },
      SA: { x: 140, y: 60, dir: "h" },
      K_no: { x: 140, y: 150, dir: "h" },
      K_coil: { x: 400, y: 60, dir: "h" },
    },
    scenarios: [
      {
        title: "示例：按下 SA",
        steps: [
          { action: "operate", target: "SA", to: "closed", explain: "TODO(待沈确认)：这一步的讲解。" },
          { action: "run", explain: "TODO(待沈确认)：运行到稳定后的讲解。" },
        ],
      },
    ],
  };
  return JSON.stringify(c, null, 2) + "\n";
}

/** 以现有回路为底稿另存：换 id 和标题，审核状态改回草稿。 */
export function copyCircuitText(text: string): string {
  const raw = JSON.parse(text) as Record<string, unknown>;
  raw.id = `${String(raw.id ?? "circuit")}-copy`;
  raw.title = `${String(raw.title ?? "回路")}（副本）`;
  raw.reviewStatus = "草稿";
  return JSON.stringify(raw, null, 2) + "\n";
}
