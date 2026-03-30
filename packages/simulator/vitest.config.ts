import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/learning/**", "**/node_modules/**"],
  },
});
