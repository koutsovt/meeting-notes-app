import { createOrchestrator } from "./orchestrator/index.js"
import { createIntelligenceService } from "@modules/intelligence/index.js"
import { createExportService } from "@modules/export/index.js"
import { createMemoryStorageService } from "./storage-memory.js"
import { createSpeechBuffer } from "./adapters/speech-buffer.js"
import { createWebCaptureService } from "./adapters/web-capture.js"
import { createWebTranscriptionService } from "./adapters/web-transcription.js"
import { createTauriCaptureService } from "./adapters/tauri-capture.js"
import { createTauriTranscriptionService } from "./adapters/tauri-transcription.js"
import { createMobileCaptureService } from "./adapters/mobile-capture.js"
import { detectPlatform } from "./platform/detect.js"
import type { Orchestrator } from "./orchestrator/index.js"
import type { StorageService } from "@shared/services/storage-service.js"
import type { TranscriptChunk } from "@shared/types/transcript.js"
import type { LiveNote } from "@shared/types/summary.js"

export interface App {
  orchestrator: Orchestrator
  storage: StorageService
  onTranscriptUpdate: ((chunk: TranscriptChunk) => void) | null
  onLiveNote: ((note: LiveNote) => void) | null
  onInterimText: ((text: string) => void) | null
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
}

/**
 * Request microphone permission and return the MediaStream.
 * Only needed in browser mode — Tauri uses ScreenCaptureKit or mobile plugin.
 */
export async function requestMicPermission(): Promise<MediaStream | null> {
  if (isTauri()) return null
  return navigator.mediaDevices.getUserMedia({ audio: true })
}

/**
 * Load the whisper model in Tauri mode (desktop only).
 */
export async function loadWhisperModel(model: string = "small.en"): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("load_model", { model })
}

/**
 * Create the app with appropriate services based on runtime environment.
 * Supports three modes: desktop (macOS), mobile (iOS/Android), browser (dev).
 */
export async function createApp(micStream: MediaStream | null): Promise<App> {
  const storage = createMemoryStorageService()
  const platform = detectPlatform()

  const app: App = {
    orchestrator: null!,
    storage,
    onTranscriptUpdate: null,
    onLiveNote: null,
    onInterimText: null,
  }

  if (platform === "ios" || platform === "android") {
    // Mobile: timer-based capture + webkitSpeechRecognition
    // Uses iOS WKWebView's built-in SFSpeechRecognizer wrapper
    const speechBuffer = createSpeechBuffer()
    speechBuffer.onInterim = (text) => app.onInterimText?.(text)

    const mobileCapture = createMobileCaptureService()
    const originalStart = mobileCapture.start.bind(mobileCapture)
    const originalStop = mobileCapture.stop.bind(mobileCapture)
    mobileCapture.start = (id, onChunk) => {
      speechBuffer.start()
      originalStart(id, onChunk)
    }
    mobileCapture.stop = () => {
      originalStop()
      speechBuffer.stop()
    }

    app.orchestrator = createOrchestrator({
      capture: mobileCapture,
      transcription: createWebTranscriptionService(speechBuffer),
      intelligence: createIntelligenceService(),
      storage,
      export: createExportService(),
      onTranscriptUpdate: (chunk) => app.onTranscriptUpdate?.(chunk),
      onLiveNote: (note) => app.onLiveNote?.(note),
    })
  } else if (platform === "macos") {
    // Desktop: ScreenCaptureKit + Whisper
    await loadWhisperModel()

    app.orchestrator = createOrchestrator({
      capture: createTauriCaptureService(),
      transcription: createTauriTranscriptionService(),
      intelligence: createIntelligenceService(),
      storage,
      export: createExportService(),
      onTranscriptUpdate: (chunk) => app.onTranscriptUpdate?.(chunk),
      onLiveNote: (note) => app.onLiveNote?.(note),
    })
  } else {
    // Browser dev mode: Web Speech API
    const speechBuffer = createSpeechBuffer()
    speechBuffer.onInterim = (text) => app.onInterimText?.(text)

    app.orchestrator = createOrchestrator({
      capture: createWebCaptureService(micStream!, speechBuffer),
      transcription: createWebTranscriptionService(speechBuffer),
      intelligence: createIntelligenceService(),
      storage,
      export: createExportService(),
      onTranscriptUpdate: (chunk) => app.onTranscriptUpdate?.(chunk),
      onLiveNote: (note) => app.onLiveNote?.(note),
    })
  }

  return app
}
