# 二次设计工作台

变电站二次设计用的本地桌面程序，包含两个模块：

- **模块 A：二次回路学习**（交互式回路演示、题库与间隔重复复习、读图找错、原理笔记）
- **模块 B：项目看板**（项目、卷册、任务、待确认问题、收资/提资记录）

完整需求与里程碑见 [AGENTS.md](AGENTS.md)。所有数据只保存在本机。

## 当前进度

| 里程碑 | 状态 |
|---|---|
| M0 项目骨架、打包、数据库与迁移、设置页框架 | ✅ 已完成，待在 Windows 上验收 |
| M1 项目看板 | 未开始 |

## 获取程序

两种方式任选：

1. **直接下载**：在 GitHub 仓库的 Actions 页面打开最新一次“Windows 打包与自检”，下载 `erci-workbench-windows` 压缩包，里面有免安装版和安装版 exe。
2. **本地打包**：本机装好 Node.js 22 或更新版本，双击 `build.bat`，完成后到 `release` 文件夹取 exe。

打包好的 exe 不需要安装 Node.js 就能运行。

> 国内网络下载 Electron 很慢时，可以在运行 build.bat 前先执行
> `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`

## M0 验收方法

在一台**没装 Node.js** 的 Windows 电脑上：

1. 双击 `erci-workbench-版本号-portable.exe` 启动。
2. 首页“数据库状态”里能看到数据库文件位置和表结构版本。
3. 点“运行读写自检”，显示“✓ 读写正常”。关掉程序再打开，再点一次，累计次数会加 1（说明数据确实存进了文件）。
4. 打开“设置”，修改“仿真步数上限”为 300 并保存，重启后仍是 300；填 5 会提示“不能小于 10”。

## 开发

```bash
npm ci
npm run dev        # 开发模式（界面热更新）
npm test           # 单元测试
npm run typecheck  # 类型检查
```

目录说明见 [docs/架构说明.md](docs/架构说明.md)。
