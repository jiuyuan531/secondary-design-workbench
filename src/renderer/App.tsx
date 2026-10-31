import { useEffect, useState } from "react";
import type { AppInfo } from "../shared/api";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { BoardPage } from "./pages/BoardPage";

type PageKey = "home" | "board" | "circuits" | "questions" | "settings";

const NAV: { key: PageKey; label: string }[] = [
  { key: "home", label: "首页" },
  { key: "board", label: "项目看板" },
  { key: "circuits", label: "回路演示" },
  { key: "questions", label: "题库复习" },
  { key: "settings", label: "设置" },
];

export function App() {
  const [page, setPage] = useState<PageKey>("home");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [boardTab, setBoardTab] = useState<"projects" | "kanban" | "issues" | undefined>();
  const [info, setInfo] = useState<AppInfo | null>(null);
  // 恢复备份后整体刷新各页面
  const [epoch, setEpoch] = useState(0);

  const reloadInfo = () => window.api.getAppInfo().then(setInfo);
  useEffect(() => { reloadInfo(); }, []);

  const openProject = (id: number | null) => { setProjectId(id); setPage("board"); };

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">二次设计工作台</div>
        {NAV.map((n) => (
          <button key={n.key} className={page === n.key ? "nav active" : "nav"}
            onClick={() => { setPage(n.key); if (n.key === "board") { setProjectId(null); setBoardTab(undefined); } }}>
            {n.label}
          </button>
        ))}
        <div className="version">{info ? `v${info.appVersion}` : ""}</div>
      </nav>
      <main className="content" key={epoch}>
        {info?.startupError && (
          <div className="banner error">
            <strong>启动时出现问题：</strong>
            <pre>{info.startupError}</pre>
          </div>
        )}
        {page === "home" && (
          <HomePage info={info} onChanged={reloadInfo} onOpenProject={openProject}
            onOpenIssues={() => { setProjectId(null); setBoardTab("issues"); setPage("board"); }} />
        )}
        {page === "board" && <BoardPage key={`${boardTab}`} projectId={projectId} onOpenProject={openProject} initialTab={boardTab} />}
        {page === "circuits" && <PlaceholderPage title="回路演示" milestone="M2" text="交互式二次回路仿真演示。" />}
        {page === "questions" && <PlaceholderPage title="题库复习" milestone="M3" text="题库、闪卡和间隔重复复习。" />}
        {page === "settings" && <SettingsPage onRestored={() => { reloadInfo(); setEpoch((e) => e + 1); setPage("home"); }} />}
      </main>
    </div>
  );
}
