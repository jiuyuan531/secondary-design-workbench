/**
 * 设置项及中文说明（AGENTS.md 第 6.1 节）。
 *
 * 所有设置项只在这里定义一次，设置页按本文件自动渲染输入框和说明文字，
 * 各页面不要手写说明。新增设置项时：在下面的列表里加一项即可。
 *
 * phase: 1 = 第一阶段就显示；2 = 第二阶段功能，第一阶段在界面上隐藏。
 * storage: "db" = 存在 SQLite 的 settings 表；
 *          "bootstrap" = 存在用户数据目录下的 bootstrap.json（例如数据库位置本身，不能存进数据库）。
 */

export type SettingType = "string" | "number" | "boolean" | "secret" | "path";

export interface SettingDef {
  key: string;
  /** 设置页上的分组标题 */
  group: string;
  label: string;
  /** 这个字段是干什么的 */
  description: string;
  /** 怎么填，举例 */
  howToFill: string;
  /** 填错了会怎样 */
  ifWrong: string;
  type: SettingType;
  default: string | number | boolean;
  phase: 1 | 2;
  storage?: "db" | "bootstrap";
  /** 数字类型的取值范围（含端点） */
  min?: number;
  max?: number;
  /** path 类型：选文件还是选文件夹 */
  pathKind?: "file" | "directory";
  /** 修改后是否需要重启程序才生效 */
  restartRequired?: boolean;
}

export const SETTINGS_SCHEMA: SettingDef[] = [
  // ---------------- 复习 ----------------
  {
    key: "review.newPerDay",
    group: "复习",
    label: "每日新题上限",
    description: "每天最多安排多少道从没复习过的新题进入复习队列。",
    howToFill: "填一个整数，例如 10。刚开始用可以少一点（5～10），习惯后再加。",
    ifWrong: "填得太大，某一天会一下子冒出很多新题，后面几天的复习量也会跟着暴涨；填 0 表示不再学新题。",
    type: "number",
    default: 10,
    min: 0,
    max: 500,
    phase: 1,
  },
  {
    key: "review.maxReviewsPerDay",
    group: "复习",
    label: "每日复习上限",
    description: "每天最多复习多少道已经学过、到期需要复习的题。",
    howToFill: "填一个整数，例如 100。",
    ifWrong: "填得太小，到期的题会积压到后面几天，间隔重复的效果变差；填得太大只是当天任务多，不会出错。",
    type: "number",
    default: 100,
    min: 1,
    max: 2000,
    phase: 1,
  },
  {
    key: "review.includeDrafts",
    group: "复习",
    label: "草稿题也参与复习",
    description: "题目有“草稿 / 已审核”两种状态。关闭时只有已审核的题进入复习队列；打开后草稿题也会出现在复习里。",
    howToFill: "一般保持关闭。只有在你想先刷一遍还没审核的题时才打开。",
    ifWrong: "打开后，没审核过、可能有错的题（包括 AI 生成的题）会出现在复习里，可能把错误的内容记住。",
    type: "boolean",
    default: false,
    phase: 1,
  },

  // ---------------- 仿真 ----------------
  {
    key: "sim.maxTicks",
    group: "仿真",
    label: "仿真步数上限（maxTicks）",
    description: "回路演示“运行到稳定”时最多推进多少个时间步。超过这个数还没稳定、也没检测到振荡，就报“仿真未收敛”，防止程序卡死。单个回路文件里也可以单独设置，回路文件里的值优先。",
    howToFill: "填一个整数，默认 200 足够绝大多数回路使用。",
    ifWrong: "填得太小，正常但较慢的回路（带较长延时）会被误报“未收敛”；填得太大，出问题的回路要多等一会儿才报错。",
    type: "number",
    default: 200,
    min: 10,
    max: 100000,
    phase: 1,
  },

  // ---------------- 数据 ----------------
  {
    key: "data.dbPath",
    group: "数据",
    label: "数据库文件位置",
    description: "保存项目、卷册、问题、题目、复习记录、笔记和设置的 SQLite 数据库文件。留空表示使用默认位置（程序的用户数据目录）。",
    howToFill: "留空，或填一个完整的文件路径，例如 D:\\二次设计\\workbench.db。如果这个位置还没有数据库文件，程序会把当前数据库复制过去；如果已经有，就直接使用那个文件。",
    ifWrong: "路径所在的文件夹不存在或没有写入权限时，程序会提示错误并继续使用原来的数据库。放在网盘同步文件夹里可能因同步冲突损坏数据，不建议。",
    type: "path",
    pathKind: "file",
    default: "",
    phase: 1,
    storage: "bootstrap",
    restartRequired: true,
  },
  {
    key: "data.circuitsDir",
    group: "数据",
    label: "回路数据目录",
    description: "存放回路定义、故障规则等 JSON 文件的文件夹。程序内编辑回路时会直接写回这里的文件。留空表示使用默认位置（用户数据目录下的 circuits 文件夹）。",
    howToFill: "留空，或填一个文件夹的完整路径，例如 D:\\二次设计\\回路库。",
    ifWrong: "文件夹不存在时程序会尝试创建；创建失败会提示错误。指向别的文件夹后，原来文件夹里的回路不会自动搬过去。",
    type: "path",
    pathKind: "directory",
    default: "",
    phase: 1,
    restartRequired: true,
  },

  // ---------------- AI（第二阶段） ----------------
  {
    key: "ai.enabled",
    group: "AI",
    label: "启用 AI 功能",
    description: "AI 讲解、从笔记出题的总开关。关闭后不会向外发送任何内容。",
    howToFill: "需要时打开。",
    ifWrong: "关闭时其他功能照常使用，只是 AI 相关按钮不可用。",
    type: "boolean",
    default: false,
    phase: 2,
  },
  {
    key: "ai.baseUrl",
    group: "AI",
    label: "接口地址",
    description: "OpenAI 兼容接口的地址。",
    howToFill: "例如 https://api.example.com/v1",
    ifWrong: "地址错误时 AI 调用会失败并提示，不影响其他功能。",
    type: "string",
    default: "",
    phase: 2,
  },
  {
    key: "ai.apiKey",
    group: "AI",
    label: "API Key",
    description: "调用 AI 接口用的密钥，只保存在本机，不写日志。",
    howToFill: "从接口服务商处复制。",
    ifWrong: "密钥错误时 AI 调用会失败并提示。",
    type: "secret",
    default: "",
    phase: 2,
  },
  {
    key: "ai.model",
    group: "AI",
    label: "模型名称",
    description: "调用的模型名。",
    howToFill: "按服务商文档填写。",
    ifWrong: "模型名错误时 AI 调用会失败并提示。",
    type: "string",
    default: "",
    phase: 2,
  },
  {
    key: "ai.maxTokens",
    group: "AI",
    label: "单次最大 token",
    description: "一次 AI 回复最多生成多少 token。",
    howToFill: "例如 2000。",
    ifWrong: "太小时回答会被截断。",
    type: "number",
    default: 2000,
    min: 100,
    max: 200000,
    phase: 2,
  },
  {
    key: "ai.confirmBeforeSend",
    group: "AI",
    label: "发送前确认内容",
    description: "每次调用 AI 前先弹窗显示将要发送的文字，确认后才发送。",
    howToFill: "建议保持打开。",
    ifWrong: "关闭后选中的文字会直接发送。",
    type: "boolean",
    default: true,
    phase: 2,
  },

  // ---------------- Notion（第二阶段） ----------------
  {
    key: "notion.enabled",
    group: "Notion",
    label: "启用 Notion 推送",
    description: "把本地数据单向推送到 Notion。",
    howToFill: "需要时打开。",
    ifWrong: "Notion 不可用时本地照常运行。",
    type: "boolean",
    default: false,
    phase: 2,
  },
  {
    key: "notion.token",
    group: "Notion",
    label: "Integration Token",
    description: "Notion 集成的密钥。",
    howToFill: "TODO(第二阶段补充获取步骤)",
    ifWrong: "推送失败并提示。",
    type: "secret",
    default: "",
    phase: 2,
  },
];

export const CURRENT_PHASE = 1 as const;

export function getSettingDef(key: string): SettingDef | undefined {
  return SETTINGS_SCHEMA.find((d) => d.key === key);
}

export type SettingValue = string | number | boolean;

/**
 * 校验并规范化一个设置值。返回 { ok: true, value } 或 { ok: false, error }（中文错误信息）。
 */
export function validateSetting(
  def: SettingDef,
  raw: unknown,
): { ok: true; value: SettingValue } | { ok: false; error: string } {
  switch (def.type) {
    case "boolean":
      if (typeof raw !== "boolean") return { ok: false, error: `“${def.label}”只能是开或关` };
      return { ok: true, value: raw };
    case "number": {
      const n = typeof raw === "string" ? Number(raw.trim()) : raw;
      if (typeof n !== "number" || !Number.isFinite(n) || (typeof raw === "string" && raw.trim() === ""))
        return { ok: false, error: `“${def.label}”需要填数字` };
      if (!Number.isInteger(n)) return { ok: false, error: `“${def.label}”需要填整数` };
      if (def.min !== undefined && n < def.min) return { ok: false, error: `“${def.label}”不能小于 ${def.min}` };
      if (def.max !== undefined && n > def.max) return { ok: false, error: `“${def.label}”不能大于 ${def.max}` };
      return { ok: true, value: n };
    }
    case "string":
    case "secret":
    case "path":
      if (typeof raw !== "string") return { ok: false, error: `“${def.label}”需要填文字` };
      return { ok: true, value: raw.trim() };
  }
}

export function visibleSettings(phase: number = CURRENT_PHASE): SettingDef[] {
  return SETTINGS_SCHEMA.filter((d) => d.phase <= phase);
}
