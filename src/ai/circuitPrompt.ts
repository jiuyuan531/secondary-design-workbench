/**
 * “让 Claude 写回路”：给 Claude Code 的提示词、从回答里取出回路文件、以及生成结果的检查。
 * 纯函数，不依赖 Electron，便于测试。
 */
import { loadCircuit, initialState, operate, step, run, SimError, type Circuit } from "../engine/index";

export interface PromptInput {
  /** 用户写的要求 */
  request: string;
  /** 《回路数据格式》说明全文 */
  formatDoc: string;
  /** 一个内置示例回路（JSON 文本），给 Claude 参考写法 */
  example: string;
  /** 在这个回路基础上修改（用户勾选时才有） */
  base?: string;
  /** 上一次生成的结果和检查出的问题，用于让 Claude 自己修正 */
  previous?: { text: string; errors: string[] };
}

export function buildCircuitPrompt(p: PromptInput): string {
  const parts: string[] = [];
  parts.push(`你在帮一位变电站电气二次设计工程师，为桌面程序“二次设计工作台”编写回路演示文件。程序会用这个文件画出回路图，并按“高阻 / 低阻两档”的简化规则逐 tick 仿真，用来学习回路原理。

## 你要交付的
只回答一个 \`\`\`json 代码块，里面是完整的回路文件（不要省略任何部分）。代码块前面可以用几句中文简要说明：你做了哪些假设、哪些地方需要工程师确认。不要调用任何工具，不要写代码块以外的长篇解释。

## 必须遵守
1. "reviewStatus" 一律写 "草稿"。工程师审核后才会改成 "已审核"。
2. 不编造工程内容。拿不准的接法、取值、讲解，照最常见的通用原理写，并在 description 或对应步骤的 explain 里注明 "TODO(待沈确认)：……"，说清楚需要确认什么。
3. 不写具体厂家型号、端子号、规范条文号。
4. 元件 id 用常见的文字符号（如 QF、HQ、TQ、KCF、TWJ、HWJ、SA），label 写中文名称。
5. 每个线圈和灯都写 impedance（high / low）；取值依据写进 description，拿不准就标 TODO(待沈确认)。
6. 每个回路上的元件（接点、线圈、灯、电阻）都要在 layout 里写坐标，元件之间不要重叠。按梯形图排布：正电源 +KM 是左边的竖母线（x=40），负电源 -KM 是右边的竖母线（x 一般 900 左右），母线用节点的 points 画出；每条支路占一行，行距 70～90，同一行的元件从左到右排，x 间隔约 180～200。
7. 写 1～3 个演示场景（scenarios），按操作顺序展示这个回路要演示的动作过程，每一步都写 explain（中文讲解）。场景里只能 operate 可操作接点（operable: true）或故障点（fault_injection）。
8. 严格按下面的格式说明写，JSON 必须合法（双引号、没有注释、没有多余逗号）。`);
  parts.push(`## 回路数据格式说明\n\n${p.formatDoc.trim()}`);
  parts.push(`## 参考示例（程序自带的草稿回路，只参考写法，内容不一定正确）\n\n\`\`\`json\n${p.example.trim()}\n\`\`\``);
  if (p.base) {
    parts.push(`## 在这个现有回路的基础上修改\n\n保留原来的 id、title 和没有要求改动的部分，只按要求修改，最后给出修改后的完整文件。\n\n\`\`\`json\n${p.base.trim()}\n\`\`\``);
  }
  parts.push(`## 工程师的要求\n\n${p.request.trim()}`);
  if (p.previous) {
    parts.push(`## 你上一次给出的文件没有通过程序检查\n\n检查结果：\n${p.previous.errors.map((e) => `- ${e}`).join("\n")}\n\n上一次的文件：\n\n\`\`\`json\n${p.previous.text.trim()}\n\`\`\`\n\n请改正这些问题，重新给出完整的文件。`);
  }
  return parts.join("\n\n") + "\n";
}

/** 从回答里取出回路 JSON 文本和代码块前的说明。取最后一个 ```json 代码块；没有代码块时取第一个 { 到最后一个 }。 */
export function extractCircuitJson(answer: string): { json: string | null; notes: string } {
  const re = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(answer))) last = m;
  if (last) return { json: last[1].trim(), notes: answer.slice(0, last.index).trim() };
  const a = answer.indexOf("{"), b = answer.lastIndexOf("}");
  if (a >= 0 && b > a) return { json: answer.slice(a, b + 1), notes: answer.slice(0, a).trim() };
  return { json: null, notes: answer.trim() };
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  /** 规范化后的文本：审核状态强制为草稿、两空格缩进 */
  text?: string;
  circuit?: Circuit;
}

/** 检查生成的回路：格式校验、布局完整不重叠、每个演示场景都能跑完（允许振荡，不允许不收敛或报错）。 */
export function checkGeneratedCircuit(json: string): CheckResult {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, errors: [`不是合法的 JSON：${(e as Error).message}`] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["最外层必须是一个对象"] };
  raw.reviewStatus = "草稿";
  const text = JSON.stringify(raw, null, 2) + "\n";
  let circuit: Circuit;
  try {
    circuit = loadCircuit(text).circuit;
  } catch (e) {
    return { ok: false, errors: (e as Error).message.split("\n").map((l) => l.replace(/^- /, "")).filter((l) => l && !l.endsWith("格式有误：")), text };
  }
  const errors: string[] = [];

  // 布局
  const layout = (circuit.layout ?? {}) as Record<string, { x?: unknown; y?: unknown }>;
  const spots = new Map<string, string>();
  for (const c of circuit.components) {
    if (!("between" in c)) continue;
    const l = layout[c.id];
    if (!l || typeof l.x !== "number" || typeof l.y !== "number") { errors.push(`${c.id}：layout 里缺少坐标`); continue; }
    const key = `${l.x},${l.y}`;
    if (spots.has(key)) errors.push(`${c.id} 和 ${spots.get(key)} 的坐标相同（${key}），图上会重叠`);
    else spots.set(key, c.id);
  }

  // 演示场景逐步跑一遍
  if (!circuit.scenarios?.length) errors.push("没有演示场景（scenarios）");
  const limit = circuit.maxTicks ?? 200;
  for (const sc of circuit.scenarios ?? []) {
    let st = initialState(circuit);
    const r0 = run(circuit, st, { maxTicks: limit });
    if (r0.status === "stable") st = r0.finalState;
    sc.steps.forEach((s, i) => {
      const where = `场景“${sc.title}”第 ${i + 1} 步`;
      try {
        if (s.action === "operate") st = operate(circuit, st, s.target!, s.to!);
        else if (s.action === "tick") st = step(circuit, st).state;
        else {
          const r = run(circuit, st, { maxTicks: limit });
          if (r.status === "not_converged") errors.push(`${where}：运行 ${limit} 个 tick 仍未稳定（仿真未收敛）`);
          st = r.finalState;
        }
      } catch (e) {
        errors.push(`${where}：${e instanceof SimError ? e.message : String(e)}`);
      }
      if (!s.explain) errors.push(`${where}：缺少 explain 讲解`);
    });
  }
  return { ok: errors.length === 0, errors, text, circuit };
}
