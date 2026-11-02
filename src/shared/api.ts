/** 主进程与界面之间的接口类型（preload 暴露为 window.api）。 */
import type { SettingValue } from "../settings/schema";
import type { EntityName, Row } from "../board/model";
import type { Dashboard, ListFilter } from "../board/repo";
import type { BackupCheck } from "../db/backup";
import type { Question, QuestionInput, ReviewStatus } from "../questions/model";
import type { QuestionFilter, QuestionWithProgress, TodayQueue, AnswerResult, ReviewStats, ImportPreview } from "../questions/repo";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AppInfo {
  appVersion: string;
  electronVersion: string;
  platform: string;
  userDataDir: string;
  dbPath: string;
  dbVersion: number | null;
  latestDbVersion: number;
  circuitsDir: string;
  /** 本次启动执行的迁移说明 */
  migrationsApplied: string[];
  migrationBackupPath?: string;
  /** 启动时数据库打开失败的原因（中文），为空表示正常 */
  startupError?: string;
}

export interface SelfCheckResult {
  ok: boolean;
  totalRows: number;
  lastId: number;
  at: string;
}

export type SetSettingResult =
  | { ok: true; value: SettingValue; restartRequired: boolean; note?: string }
  | { ok: false; error: string };

export interface WorkbenchApi {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<Record<string, SettingValue>>;
  setSetting(key: string, value: unknown): Promise<SetSettingResult>;
  selfCheck(): Promise<SelfCheckResult>;
  openPath(p: string): Promise<string>;
  pickPath(kind: "file" | "directory", current?: string): Promise<string | null>;
  relaunch(): Promise<void>;

  board: {
    list(entity: EntityName, filter?: ListFilter): Promise<Result<Row[]>>;
    get(entity: EntityName, id: number): Promise<Result<Row>>;
    create(entity: EntityName, data: Record<string, unknown>): Promise<Result<Row>>;
    update(entity: EntityName, id: number, data: Record<string, unknown>): Promise<Result<Row>>;
    deleteImpact(entity: EntityName, id: number): Promise<Result<string[]>>;
    remove(entity: EntityName, id: number): Promise<Result<void>>;
    dashboard(today: string): Promise<Result<Dashboard>>;
  };

  circuits: {
    list(): Promise<Result<CircuitListItem[]>>;
    read(file: string): Promise<Result<string>>;
    /** 保存回路文件（先校验格式）；create 为 true 时不允许覆盖已有文件 */
    write(file: string, text: string, create?: boolean): Promise<Result<{ file: string; historyKept: boolean }>>;
    /** 用系统默认程序打开《回路数据格式》说明 */
    openFormatDoc(): Promise<Result<string>>;
  };

  /** 题库 */
  questions: {
    list(filter?: QuestionFilter): Promise<Result<QuestionWithProgress[]>>;
    tags(): Promise<Result<string[]>>;
    create(data: Partial<QuestionInput>): Promise<Result<Question>>;
    update(id: number, data: Partial<QuestionInput>): Promise<Result<{ question: Question; progressReset: boolean }>>;
    setStatus(ids: number[], status: ReviewStatus): Promise<Result<{ changed: number; progressReset: number }>>;
    remove(ids: number[]): Promise<Result<void>>;
    /** 导出（不传 ids 导出全部）；用户取消时为 null */
    exportFile(ids?: number[]): Promise<Result<{ path: string; count: number } | null>>;
    pickImport(): Promise<Result<{ path: string; preview?: ImportPreview; error?: string } | null>>;
    importFile(path: string, updateExisting: boolean): Promise<Result<{ added: number; updated: number; progressReset: number; skipped: number }>>;
  };

  /** 复习 */
  review: {
    queue(today: string): Promise<Result<TodayQueue>>;
    answer(id: number, response: unknown, grade: number, today: string): Promise<Result<AnswerResult>>;
    stats(today: string): Promise<Result<ReviewStats>>;
  };

  /** 让 Claude 写回路（调用本机 Claude Code） */
  claude: {
    /** baseFile：在回路文件夹里的这个回路基础上修改 */
    generate(request: string, baseFile?: string): Promise<Result<ClaudeGenerateResult>>;
    cancel(): Promise<void>;
    /** 订阅进度文字，返回取消订阅的函数 */
    onProgress(cb: (text: string) => void): () => void;
  };

  data: {
    backup(): Promise<Result<{ path: string; summary?: string } | null>>;
    pickRestore(): Promise<Result<{ path: string; check: BackupCheck } | null>>;
    restore(source: string): Promise<Result<{ safetyBackup: string; summary?: string }>>;
  };
}

export interface CircuitListItem {
  file: string;
  id?: string;
  title?: string;
  category?: string;
  reviewStatus?: string;
  migratedFrom?: number[];
  /** 读入失败时的中文原因 */
  error?: string;
}

export interface ClaudeGenerateResult {
  text: string | null;
  notes: string;
  /** 最后一次检查仍有的问题；空数组表示全部通过 */
  errors: string[];
  attempts: number;
  costUsd: number;
}
