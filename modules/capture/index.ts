import { v4 as uuid } from "uuid"
import type { CaptureService, AudioChunkHandler } from "../../shared/services/capture-service.js"
import type { AudioChunk } from "../../shared/types/audio.js"

const CHUNK_DURATION_MS = 5000

export interface CaptureStats {
  chunksEmitted: number
  startedAt: string | null
  source: AudioChunk["source"]
  elapsedMs: number
}

export type AudioDataCallback = (samples: Float32Array, sampleRate: number, channelCount: number) => void

/**
 * Backend that produces audio data.
 * ScreenCaptureKit (system audio) or native mic capture pushes PCM via onData.
 * Stub returns silence buffers on an interval.
 */
export interface AudioBackend {
  open(source: AudioChunk["source"], onData: AudioDataCallback): void
  close(): void
}

function createStubBackend(): AudioBackend {
  let intervalId: ReturnType<typeof setInterval> | null = null
  return {
    open(_source, onData) {
      intervalId = setInterval(() => {
        const silence = new Float32Array(16000 * 5)
        onData(silence, 16000, 1)
      }, CHUNK_DURATION_MS)
    },
    close() {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    },
  }
}

export function createCaptureService(
  source: AudioChunk["source"] = "microphone",
  backendOverride?: AudioBackend,
) {
  let sequence = 0
  let capturing = false
  let captureStartedAt: string | null = null
  let captureStartEpochMs = 0
  const backend: AudioBackend = backendOverride ?? createStubBackend()

  function getStats(): CaptureStats {
    return {
      chunksEmitted: sequence,
      startedAt: captureStartedAt,
      source,
      elapsedMs: capturing ? Date.now() - captureStartEpochMs : 0,
    }
  }

  function start(meetingId: string, onChunk: AudioChunkHandler): void {
    if (capturing) {
      throw new Error("Capture already in progress")
    }

    capturing = true
    sequence = 0
    captureStartedAt = new Date().toISOString()
    captureStartEpochMs = Date.now()

    backend.open(source, (samples, sampleRate, channelCount) => {
      const seq = sequence++
      const chunk: AudioChunk = {
        id: uuid(),
        meetingId,
        sequence: seq,
        startTimeMs: seq * CHUNK_DURATION_MS,
        endTimeMs: (seq + 1) * CHUNK_DURATION_MS,
        source,
        samples,
        sampleRate,
        channelCount,
        createdAt: new Date().toISOString(),
      }
      try {
        onChunk(chunk)
      } catch {
        // Handler errors must not stop capture
      }
    })
  }

  function stop(): void {
    if (!capturing) {
      throw new Error("Capture is not in progress")
    }

    backend.close()
    capturing = false
  }

  function isCapturing(): boolean {
    return capturing
  }

  return { start, stop, isCapturing, getStats }
}
