import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { v4 as uuid } from "uuid"
import type { CaptureService, AudioChunkHandler } from "@shared/services/capture-service.js"
import type { AudioChunk } from "@shared/types/audio.js"

const CHUNK_DURATION_MS = 5000

interface AudioChunkPayload {
  id: string
  meeting_id: string
  sequence: number
  start_time_ms: number
  end_time_ms: number
  source: string
  sample_rate: number
  channel_count: number
  samples_base64: string
  created_at: string
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
        const samples = base64ToFloat32(payload.samples_base64)
        const chunk: AudioChunk = {
          id: payload.id,
          meetingId: payload.meeting_id,
          sequence: payload.sequence,
          startTimeMs: payload.start_time_ms,
          endTimeMs: payload.end_time_ms,
          source: payload.source as AudioChunk["source"],
          samples,
          sampleRate: payload.sample_rate,
          channelCount: payload.channel_count,
          createdAt: payload.created_at,
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
        args: { meeting_id: meetingId, source },
      }).catch((err) => {
        capturing = false
        throw new Error(`Failed to start capture: ${err}`)
      })
    },

    stop(): void {
      if (!capturing) throw new Error("Capture is not in progress")

      invoke("stop_capture").catch((err) => {
        throw new Error(`Failed to stop capture: ${err}`)
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
