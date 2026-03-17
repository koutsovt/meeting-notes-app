import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../shared"),
      "@modules": path.resolve(__dirname, "../../modules"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || "localhost",
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
})
