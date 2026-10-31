// 开发模式：启动 Vite 开发服务器，打包主进程，再启动 Electron
import { createServer } from "vite";
import { spawn, execSync } from "node:child_process";
import electronPath from "electron";

execSync("node scripts/build-main.mjs", { stdio: "inherit" });
const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
const child = spawn(electronPath, ["."], { stdio: "inherit", env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on("exit", (code) => { server.close(); process.exit(code ?? 0); });
