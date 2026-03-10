import { v4 as uuid } from "uuid"
import type { CaptureService, AudioChunkHandler } from "@shared/services/capture-service.js"
import type { AudioChunk } from "@shared/types/audio.js"
import type { SpeechBuffer } from "./speech-buffer.js"

const CHUNK_DURATION_MS = 5000

/**
 * Real browser capture service using getUserMedia + MediaRecorder.
 * Requires a pre-acquired MediaStream (mic permission already granted).
 * Starts/stops the shared SpeechBuffer alongside the mic.
 */
export function createWebCaptureService(
  stream: MediaStream,
  speechBuffer: SpeechBuffer,
  source: AudioChunk["source"] = "microphone",
): CaptureService {
  let intervalId: ReturnType<typeof setInterval> | null = null
  let recorder: MediaRecorder | null = null
  let sequence = 0
  let capturing = false

  return {
    start(meetingId: string, onChunk: AudioChunkHandler): void {
      if (capturing) throw new Error("Capture already in progress")
      capturing = true
      sequence = 0

      // Start real MediaRecorder (records audio for future use / playback)
      recorder = new MediaRecorder(stream, { mimeType: "audio/webm" })
      recorder.start(CHUNK_DURATION_MS)

      // Start speech recognition
      speechBuffer.start()

      // Emit typed AudioChunks on each interval
      intervalId = setInterval(() => {
        const seq = sequence++
        const chunk: AudioChunk = {
          id: uuid(),
          meetingId,
          sequence: seq,
          startTimeMs: seq * CHUNK_DURATION_MS,
          endTimeMs: (seq + 1) * CHUNK_DURATION_MS,
          source,
          createdAt: new Date().toISOString(),
        }
        try {
          onChunk(chunk)
        } catch {
          // Handler errors must not stop the capture interval
        }
      }, CHUNK_DURATION_MS)
    },

    stop(): void {
      if (!capturing) throw new Error("Capture is not in progress")

      clearInterval(intervalId!)
      intervalId = null

      if (recorder && recorder.state !== "inactive") {
        recorder.stop()
      }
      recorder = null

      speechBuffer.stop()
      capturing = false
    },

    isCapturing(): boolean {
      return capturing
    },
  }
}
