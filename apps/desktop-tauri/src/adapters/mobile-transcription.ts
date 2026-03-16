import { invoke } from "@tauri-apps/api/core"
import { v4 as uuid } from "uuid"
import type { TranscriptionService } from "@shared/services/transcription-service.js"
import type { AudioChunk } from "@shared/types/audio.js"
import type { TranscriptChunk, Transcript } from "@shared/types/transcript.js"

// Dynamic import to bypass TS resolution issue with addPluginListener
async function registerPluginListener<T>(
  plugin: string,
  event: string,
  cb: (payload: T) => void,
): Promise<{ unregister: () => Promise<void> }> {
  const core = await import("@tauri-apps/api/core")
  const fn = (core as any).addPluginListener
  return fn(plugin, event, cb)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Mobile transcription service using tauri-plugin-stt.
 * Uses native iOS SFSpeechRecognizer via addPluginListener directly
 * (bypasses the plugin's broken isMobilePlatform() detection in its JS wrapper).
 *
 * The plugin's Swift code uses AVAudioEngine + SFSpeechAudioBufferRecognitionRequest
 * which provides much better accuracy than webkitSpeechRecognition in WKWebView.
 */
export function createMobileTranscriptionService(): {
  service: TranscriptionService
  startListeningForMeeting: () => Promise<void>
  stopListeningForMeeting: () => Promise<void>
  onInterim: ((text: string) => void) | null
} {
  interface BufferedResult {
    text: string
    timestampMs: number
    confidence: number
  }

  let buffer: BufferedResult[] = []
  let startEpochMs = 0
  let listening = false
  let resultUnlisten: { unregister: () => Promise<void> } | null = null
  let errorUnlisten: { unregister: () => Promise<void> } | null = null
  let stateUnlisten: { unregister: () => Promise<void> } | null = null

  const wrapper = {
    onInterim: null as ((text: string) => void) | null,

    async startListeningForMeeting(): Promise<void> {
      if (listening) return
      buffer = []
      startEpochMs = Date.now()
      listening = true

      try {
        // Step 1: Request permissions and wait for iOS to fully grant them
        const permResult = await invoke("plugin:stt|request_permission") as {
          microphone?: string
          speechRecognition?: string
        }

        if (permResult.microphone !== "granted" || permResult.speechRecognition !== "granted") {
          console.error("[mobile-stt] Permissions not granted:", permResult)
          listening = false
          return
        }

        // Step 2: Small delay to let iOS fully release audio session after permission dialogs
        await delay(500)

        // Step 3: Register listeners BEFORE starting recognition
        resultUnlisten = await registerPluginListener<{
          transcript?: string
          isFinal?: boolean
          confidence?: number
        }>("stt", "result", (result) => {
          const text = result.transcript?.trim()
          if (!text) return

          if (result.isFinal) {
            buffer.push({
              text,
              timestampMs: Date.now() - startEpochMs,
              confidence: result.confidence ?? 0.8,
            })
          } else {
            wrapper.onInterim?.(text)
          }
        })

        errorUnlisten = await registerPluginListener<{
          code?: string
          message?: string
          details?: string
        }>("stt", "error", (err) => {
          console.error("[mobile-stt] Error:", err.code, err.message, err.details)
        })

        stateUnlisten = await registerPluginListener<{
          state?: string
        }>("stt", "stateChange", (state) => {
          console.log("[mobile-stt] State:", state.state)
        })

        // Step 4: Start recognition
        await invoke("plugin:stt|start_listening", {
          config: {
            language: "en-US",
            interimResults: true,
            continuous: true,
          },
        })
      } catch (err) {
        console.error("[mobile-stt] Failed to start:", err)
        listening = false
        // Clean up any registered listeners
        await cleanup()
      }
    },

    async stopListeningForMeeting(): Promise<void> {
      if (!listening) return
      listening = false
      try {
        await invoke("plugin:stt|stop_listening")
      } catch (err) {
        console.error("[mobile-stt] Failed to stop:", err)
      }
      await cleanup()
    },

    service: {
      async transcribeChunk(chunk: AudioChunk): Promise<TranscriptChunk> {
        const matches = buffer.filter(
          (r) => r.timestampMs >= chunk.startTimeMs && r.timestampMs < chunk.endTimeMs,
        )
        const text = matches.map((r) => r.text).join(" ")
        const avgConfidence =
          matches.length > 0
            ? matches.reduce((sum, r) => sum + r.confidence, 0) / matches.length
            : 0

        return {
          id: uuid(),
          meetingId: chunk.meetingId,
          sequence: chunk.sequence,
          text: text || "(no speech detected)",
          startTimeMs: chunk.startTimeMs,
          endTimeMs: chunk.endTimeMs,
          confidence: avgConfidence,
          createdAt: new Date().toISOString(),
        }
      },

      assembleTranscript(meetingId: string, chunks: TranscriptChunk[]): Transcript {
        const sorted = [...chunks].sort((a, b) => a.sequence - b.sequence)
        return {
          id: uuid(),
          meetingId,
          chunks: sorted,
          fullText: sorted.map((c) => c.text).join(" "),
          createdAt: new Date().toISOString(),
        }
      },
    } as TranscriptionService,
  }

  async function cleanup(): Promise<void> {
    if (resultUnlisten) {
      await resultUnlisten.unregister()
      resultUnlisten = null
    }
    if (errorUnlisten) {
      await errorUnlisten.unregister()
      errorUnlisten = null
    }
    if (stateUnlisten) {
      await stateUnlisten.unregister()
      stateUnlisten = null
    }
  }

  return wrapper
}
