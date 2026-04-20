import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { devCardWriter } from "./vite-plugins/dev-card-writer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    devCardWriter(),
  ],
  resolve: {
    alias: {
      "@lorcana-sim/engine": path.resolve(__dirname, "../engine/src/index.ts"),
      "@lorcana-sim/simulator": path.resolve(__dirname, "../simulator/src/index.ts"),
      "@lorcana-sim/analytics": path.resolve(__dirname, "../analytics/src/index.ts"),
    },
  },
});
