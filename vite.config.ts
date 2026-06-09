import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const buildDate = new Date().toLocaleString("en-GB", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
