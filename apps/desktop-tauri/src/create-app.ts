import { createOrchestrator } from "./orchestrator/index.js"
import { createIntelligenceService } from "@modules/intelligence/index.js"
import { createExportService } from "@modules/export/index.js"
import { createMemoryStorageService } from "./storage-memory.js"
import { createSpeechBuffer } from "./adapters/speech-buffer.js"
import { createWebCaptureService } from "./adapters/web-capture.js"
import { createWebTranscriptionService } from "./adapters/web-transcription.js"
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

/**
 * Request microphone permission and return the MediaStream.
 * Must be called before createApp.
 */
export async function requestMicPermission(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true })
}

/**
 * Create the app with real browser services.
 * Requires a pre-acquired MediaStream (mic already granted).
 */
export function createApp(micStream: MediaStream): App {
  const storage = createMemoryStorageService()
  const speechBuffer = createSpeechBuffer()

  const app: App = {
    orchestrator: null!,
    storage,
    onTranscriptUpdate: null,
    onLiveNote: null,
    onInterimText: null,
  }

  speechBuffer.onInterim = (text) => app.onInterimText?.(text)

  app.orchestrator = createOrchestrator({
    capture: createWebCaptureService(micStream, speechBuffer),
    transcription: createWebTranscriptionService(speechBuffer),
    intelligence: createIntelligenceService(),
    storage,
    export: createExportService(),
    onTranscriptUpdate: (chunk) => app.onTranscriptUpdate?.(chunk),
    onLiveNote: (note) => app.onLiveNote?.(note),
  })

  return app
}
