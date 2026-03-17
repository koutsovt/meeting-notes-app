import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"
import fs from "fs"

/**
 * Vite plugin: patch OpenAI & Anthropic SDK browser detection for Tauri.
 *
 * Tauri runs inside WKWebView which has `window`, `document`, and
 * `navigator` — making these SDKs refuse to run because they think
 * it's a public browser. In a Tauri desktop/mobile app the WebView is
 * sandboxed, so this is a false positive.
 *
 * We patch the source files on disk at config time (before dep
 * pre-bundling). Idempotent — `npm install` restores originals.
 */
function patchBrowserCheck(): Plugin {
  const ESM_RE = /export const isRunningInBrowser = \(\) => \{[\s\S]*?\};/
  const ESM_STUB = "export const isRunningInBrowser = () => { return false; };"
  const CJS_RE = /const isRunningInBrowser = \(\) => \{[\s\S]*?\};/
  const CJS_STUB = "const isRunningInBrowser = () => { return false; };"

  function patchFile(filePath: string) {
    if (!fs.existsSync(filePath)) return
    const src = fs.readFileSync(filePath, "utf-8")
    if (src.includes("return false")) return
    const isESM = filePath.endsWith(".mjs")
    const patched = src.replace(isESM ? ESM_RE : CJS_RE, isESM ? ESM_STUB : CJS_STUB)
    if (patched !== src) {
      fs.writeFileSync(filePath, patched, "utf-8")
      console.log(`[patch-browser-check] ${filePath}`)
    }
  }

  const roots = [
    path.resolve(__dirname, "node_modules"),
    path.resolve(__dirname, "../../node_modules"),
  ]
  const targets = [
    "openai/internal/detect-platform.mjs",
    "openai/internal/detect-platform.js",
    "@anthropic-ai/sdk/internal/detect-platform.mjs",
    "@anthropic-ai/sdk/internal/detect-platform.js",
  ]

  // Patch immediately when config is loaded (before optimizeDeps)
  for (const root of roots) {
    for (const target of targets) {
      patchFile(path.join(root, target))
    }
  }

  return {
    name: "patch-browser-check",
    enforce: "pre",
  }
}

export default defineConfig({
  plugins: [patchBrowserCheck(), react()],
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
