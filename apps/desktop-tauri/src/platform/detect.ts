/**
 * Detect the current platform at runtime.
 * Uses multiple signals: touch support, screen size, user-agent,
 * and maxTouchPoints to reliably distinguish iOS/Android from macOS.
 */

export type Platform = "macos" | "ios" | "android" | "browser"

/**
 * Check if running inside Tauri.
 * Mirrors the official @tauri-apps/api/core isTauri() implementation.
 * Direct named import fails due to a TS declaration resolution bug with this package.
 */
function isTauri(): boolean {
  return !!(globalThis as Record<string, unknown>).isTauri
}

export function detectPlatform(): Platform {
  if (typeof window === "undefined") return "browser"

  if (!isTauri()) return "browser"

  const ua = navigator.userAgent.toLowerCase()

  // Check for Android first (user-agent is reliable on Android WebView)
  if (ua.includes("android")) {
    return "android"
  }

  // iOS detection: WKWebView on iOS may have a macOS-like user-agent,
  // so we use multiple signals:
  // 1. Explicit iPhone/iPad/iPod in UA
  // 2. Touch-capable "Mac" (iPad with desktop UA)
  // 3. Small screen + touch (iPhone)
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    return "ios"
  }
  if (ua.includes("mac") && navigator.maxTouchPoints > 0) {
    return "ios"
  }
  if ("ontouchend" in document && navigator.maxTouchPoints > 0) {
    return "ios"
  }

  return "macos"
}

export function isMobile(): boolean {
  const platform = detectPlatform()
  return platform === "ios" || platform === "android"
}

export function isDesktop(): boolean {
  return detectPlatform() === "macos"
}

export function isBrowser(): boolean {
  return detectPlatform() === "browser"
}
