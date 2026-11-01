/**
 * 项目看板用到的分类选项。
 *
 * value 存进数据库，发布后不要改；label 是界面上显示的中文，可以随时改。
 * 要新增分类，在对应列表里加一项即可。
 * 项目类型、卷册状态的具体分类是否调整：TODO(待沈确认)，见 AGENTS.md 第 10 节。
 */
export interface EnumOption {
  value: string;
  label: string;
  /** 可选的说明，鼠标悬停或表单里显示 */
  hint?: string;
}

const ENUM_DATA = {
  projectType: [
    { value: "retrofit", label: "变电站二次改造", hint: "如备自投改造" },
    { value: "new_station", label: "新建站二次卷册" },
    { value: "fire_alarm", label: "消防与火灾报警" },
    { value: "bay_extension", label: "扩建线路间隔", hint: "通常需要去对侧站收资" },
    { value: "other", label: "其他" },
  ],
  projectStatus: [
    { value: "active", label: "进行中" },
    { value: "paused", label: "暂停" },
    { value: "done", label: "已完成" },
  ],
  volumeStatus: [
    { value: "not_started", label: "未开始" },
    { value: "studying", label: "学习资料" },
    { value: "drawing", label: "绘制中" },
    { value: "self_check", label: "自校" },
    { value: "review", label: "送审" },
    { value: "issued", label: "已出图" },
  ],
  taskStatus: [
    { value: "todo", label: "待办" },
    { value: "doing", label: "进行中" },
    { value: "done", label: "已完成" },
  ],
  priority: [
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
  ],
  infoNature: [
    { value: "source_fact", label: "源文件事实", hint: "图纸、规范、厂家资料上白纸黑字写着的" },
    { value: "cross_inference", label: "跨图推断", hint: "从几张图或几份资料对照推出来的，没有直接写明" },
    { value: "to_confirm", label: "待确认", hint: "还没有依据，需要问厂家、设总或现场" },
  ],
  sourceType: [
    { value: "standard_review", label: "规范/审查意见" },
    { value: "design_site", label: "设计或现场资料" },
    { value: "vendor", label: "厂家资料" },
    { value: "template", label: "参考模板" },
  ],
  issueStatus: [
    { value: "open", label: "未解决" },
    { value: "submitted", label: "已提交厂家或设总" },
    { value: "confirmed", label: "已确认" },
  ],
} satisfies Record<string, EnumOption[]>;

export type EnumKey = keyof typeof ENUM_DATA;
export const ENUMS: Record<EnumKey, EnumOption[]> = ENUM_DATA;

export function enumLabel(key: EnumKey, value: string | null | undefined): string {
  if (value == null || value === "") return "";
  return ENUMS[key].find((o) => o.value === value)?.label ?? `（未知：${value}）`;
}

export function isEnumValue(key: EnumKey, value: unknown): boolean {
  return typeof value === "string" && ENUMS[key].some((o) => o.value === value);
}
