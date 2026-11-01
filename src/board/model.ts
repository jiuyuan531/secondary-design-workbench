/**
 * 项目看板的数据模型定义（AGENTS.md 第 3.2 节）。
 * 增删改查、表单和列表都按这里的字段定义自动生成，字段的中文名和填写说明也写在这里。
 */
import type { EnumKey } from "./enums";

export type FieldType = "text" | "textarea" | "date" | "enum" | "ref" | "boolean";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  enumKey?: EnumKey;
  refEntity?: EntityName;
  /** 表单里显示在输入框下面的说明 */
  help?: string;
  /** 新建时的默认值 */
  default?: string | number | null;
  placeholder?: string;
}

export type EntityName = "project" | "volume" | "task" | "issue";

export interface EntityDef {
  name: EntityName;
  table: string;
  label: string;
  fields: FieldDef[];
  orderBy: string;
}

const PROJECT: EntityDef = {
  name: "project",
  table: "projects",
  label: "项目",
  orderBy: "CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, due_date IS NULL, due_date, id",
  fields: [
    { key: "name", label: "项目名称", type: "text", required: true, help: "以正式文件上的名称为准，不用文件夹里的简称或别名。" },
    { key: "voltage_level", label: "电压等级", type: "text", placeholder: "例如 110kV" },
    { key: "project_type", label: "项目类型", type: "enum", enumKey: "projectType", required: true, default: "retrofit" },
    { key: "status", label: "状态", type: "enum", enumKey: "projectStatus", required: true, default: "active" },
    { key: "folder_path", label: "本地文件夹", type: "text", help: "项目资料所在文件夹的完整路径，详情页可一键打开。", placeholder: "例如 D:\\项目\\某某站备自投改造" },
    { key: "start_date", label: "开始日期", type: "date" },
    { key: "due_date", label: "截止日期", type: "date" },
    { key: "notes", label: "备注", type: "textarea" },
  ],
};

const VOLUME: EntityDef = {
  name: "volume",
  table: "volumes",
  label: "卷册",
  orderBy: "due_date IS NULL, due_date, id",
  fields: [
    { key: "project_id", label: "所属项目", type: "ref", refEntity: "project", required: true },
    { key: "name", label: "卷册名称", type: "text", required: true },
    { key: "drawing_no", label: "图号", type: "text" },
    { key: "revision", label: "版本", type: "text", default: "R01", placeholder: "R01、R02……" },
    { key: "status", label: "状态", type: "enum", enumKey: "volumeStatus", required: true, default: "not_started" },
    { key: "due_date", label: "交付日期", type: "date" },
    { key: "notes", label: "备注", type: "textarea" },
  ],
};

const TASK: EntityDef = {
  name: "task",
  table: "tasks",
  label: "任务",
  orderBy: "status = 'done', due_date IS NULL, due_date, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id",
  fields: [
    { key: "project_id", label: "所属项目", type: "ref", refEntity: "project", required: true },
    { key: "volume_id", label: "所属卷册", type: "ref", refEntity: "volume", help: "可不选，表示属于整个项目。" },
    { key: "content", label: "任务内容", type: "textarea", required: true },
    { key: "status", label: "状态", type: "enum", enumKey: "taskStatus", required: true, default: "todo" },
    { key: "priority", label: "优先级", type: "enum", enumKey: "priority", required: true, default: "medium" },
    { key: "due_date", label: "截止日期", type: "date" },
  ],
};

const ISSUE: EntityDef = {
  name: "issue",
  table: "issues",
  label: "待确认问题",
  orderBy: "CASE status WHEN 'open' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END, id DESC",
  fields: [
    { key: "project_id", label: "所属项目", type: "ref", refEntity: "project", required: true },
    { key: "volume_id", label: "所属卷册", type: "ref", refEntity: "volume", help: "可不选，表示属于整个项目。" },
    { key: "description", label: "问题描述", type: "textarea", required: true },
    { key: "info_nature", label: "信息性质", type: "enum", enumKey: "infoNature", required: true, default: "to_confirm",
      help: "源文件事实：资料上直接写明的；跨图推断：对照几份资料推出来的；待确认：还没有依据。" },
    { key: "has_conflict", label: "来源之间有矛盾", type: "boolean", default: 0,
      help: "勾选后至少要填两个来源，分别记下各自的说法。不需要判断哪边对。" },
    { key: "status", label: "状态", type: "enum", enumKey: "issueStatus", required: true, default: "open" },
    { key: "confirmed_by", label: "确认人", type: "text", help: "状态为“已确认”时必填。" },
    { key: "confirmed_date", label: "确认日期", type: "date", help: "状态为“已确认”时必填。" },
    { key: "conclusion", label: "结论", type: "textarea", help: "状态为“已确认”时必填。" },
  ],
};

export const ENTITIES: Record<EntityName, EntityDef> = {
  project: PROJECT,
  volume: VOLUME,
  task: TASK,
  issue: ISSUE,
};

/** 问题的来源（一条问题可以有多个来源，用于记录矛盾的两边说法） */
export interface IssueSource {
  id?: number;
  source_type: string;
  reference: string;
  statement: string;
}

export type Row = Record<string, string | number | null>;
export type IssueRow = Row & { sources: IssueSource[] };
