// 用 esbuild 把 Electron 主进程和 preload 打包成 CommonJS
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron", "sql.js"],
  sourcemap: true,
  logLevel: "info",
};

await build({ ...common, entryPoints: ["app/main.ts"], outfile: "dist-electron/main.js" });
await build({ ...common, entryPoints: ["app/preload.ts"], outfile: "dist-electron/preload.js" });
