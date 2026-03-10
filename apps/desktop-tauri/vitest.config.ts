import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../shared"),
      "@modules": path.resolve(__dirname, "../../modules"),
    },
  },
})
