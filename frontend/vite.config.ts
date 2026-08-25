import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const gatewayTarget = "http://127.0.0.1:7633";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vitest 组件测试环境：jsdom + 组件库（testing-library）。
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ["react-markdown", "remark-gfm"],
          ui: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-select",
            "@radix-ui/react-switch",
            "@radix-ui/react-tooltip",
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    // Wails WebView 的 wails.localhost 会触发 macOS ATS，HMR 直接连本机 Vite。
    hmr: { host: "127.0.0.1" },
    proxy: {
      "/api": {
        target: gatewayTarget,
        changeOrigin: false,
      },
      "/healthz": {
        target: gatewayTarget,
        changeOrigin: false,
      },
    },
  },
});
