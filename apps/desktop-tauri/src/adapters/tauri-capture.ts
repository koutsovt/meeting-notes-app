import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { v4 as uuid } from "uuid"
import type { CaptureService, AudioChunkHandler } from "@shared/services/capture-service.js"
import type { AudioChunk } from "@shared/types/audio.js"

const CHUNK_DURATION_MS = 5000

interface AudioChunkPayload {
  id: string
  meetingId: string
  sequence: number
  startTimeMs: number
  endTimeMs: number
  source: string
  sampleRate: number
  channelCount: number
  samplesBase64: string
  createdAt: string
}

/**
 * Tauri-native capture service.
 * Calls Rust ScreenCaptureKit backend via Tauri commands.
 * Listens for `audio-chunk` events emitted from the Rust side.
 */
export function createTauriCaptureService(
  source: AudioChunk["source"] = "system",
): CaptureService {
  let capturing = false
  let unlisten: UnlistenFn | null = null

  return {
    start(meetingId: string, onChunk: AudioChunkHandler): void {
      if (capturing) throw new Error("Capture already in progress")
      capturing = true

      listen<AudioChunkPayload>("audio-chunk", (event) => {
        const payload = event.payload
        const samples = base64ToFloat32(payload.samplesBase64)
        const chunk: AudioChunk = {
          id: payload.id,
          meetingId: payload.meetingId,
          sequence: payload.sequence,
          startTimeMs: payload.startTimeMs,
          endTimeMs: payload.endTimeMs,
          source: payload.source as AudioChunk["source"],
          samples,
          sampleRate: payload.sampleRate,
          channelCount: payload.channelCount,
          createdAt: payload.createdAt,
        }
        try {
          onChunk(chunk)
        } catch {
          // Handler errors must not break the event listener
        }
      }).then((fn) => {
        unlisten = fn
      })

      invoke("start_capture", {
        args: { meetingId, source },
      }).catch(() => {
        capturing = false
      })
    },

    stop(): void {
      if (!capturing) throw new Error("Capture is not in progress")

      invoke("stop_capture").catch(() => {
        // Error intentionally swallowed — sync interface cannot propagate async failures
      })

      if (unlisten) {
        unlisten()
        unlisten = null
      }
      capturing = false
    },

    isCapturing(): boolean {
      return capturing
    },
  }
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Float32Array(bytes.buffer)
}
