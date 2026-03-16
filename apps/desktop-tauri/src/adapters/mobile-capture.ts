import { v4 as uuid } from "uuid"
import type { CaptureService, AudioChunkHandler } from "@shared/services/capture-service.js"
import type { AudioChunk } from "@shared/types/audio.js"

/**
 * Mobile capture service — minimal implementation.
 * Uses a timer to emit silent audio chunks so the orchestrator
 * pipeline stays alive. The SpeechBuffer (Web Speech API fallback)
 * handles actual transcription on mobile.
 */
export function createMobileCaptureService(): CaptureService {
  let capturing = false
  let meetingId = ""
  let sequence = 0
  let intervalId: ReturnType<typeof setInterval> | null = null

  return {
    start(id: string, onChunk: AudioChunkHandler): void {
      if (capturing) throw new Error("Capture already in progress")

      capturing = true
      meetingId = id
      sequence = 0

      // Emit a chunk every 5 seconds to keep the pipeline alive
      const CHUNK_MS = 5000
      intervalId = setInterval(() => {
        const seq = sequence++
        const chunk: AudioChunk = {
          id: uuid(),
          meetingId,
          sequence: seq,
          startTimeMs: seq * CHUNK_MS,
          endTimeMs: (seq + 1) * CHUNK_MS,
          source: "microphone",
          sampleRate: 16000,
          channelCount: 1,
          createdAt: new Date().toISOString(),
        }
        try {
          onChunk(chunk)
        } catch {
          // Handler errors must not stop capture
        }
      }, CHUNK_MS)
    },

    stop(): void {
      if (!capturing) throw new Error("Capture is not in progress")

      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
      capturing = false
    },

    isCapturing(): boolean {
      return capturing
    },
  }
}
