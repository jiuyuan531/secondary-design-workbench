import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // 打包后用 file:// 加载，必须用相对路径
  build: { outDir: "dist", emptyOutDir: true },
  test: { include: ["src/**/__tests__/**/*.test.ts", "tests/**/*.test.ts"] },
} as never);
