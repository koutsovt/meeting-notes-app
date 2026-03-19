import { invoke } from "@tauri-apps/api/core"
import { v4 as uuid } from "uuid"
import type { TranscriptionService } from "@shared/services/transcription-service.js"
import type { AudioChunk } from "@shared/types/audio.js"
import type { TranscriptChunk, Transcript } from "@shared/types/transcript.js"

interface RecognitionResult {
  transcript: string
  isFinal: boolean
  confidence: number
}

/**
 * Mobile transcription service using custom speech-recognizer plugin.
 * Uses Tauri Channel API for reliable result delivery from native
 * SFSpeechRecognizer → JS (bypasses broken self.trigger() in tauri-plugin-stt).
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
  let lastDrainIndex = 0
  let startEpochMs = 0
  let listening = false
  let flushIntervalId: ReturnType<typeof setInterval> | null = null
  let lastInterimText = ""

  const wrapper = {
    onInterim: null as ((text: string) => void) | null,

    async startListeningForMeeting(): Promise<void> {
      if (listening) return
      buffer = []
      lastDrainIndex = 0
      startEpochMs = Date.now()
      listening = true

      try {
        const perms = (await invoke("plugin:speech-recognizer|request_permissions")) as {
          microphone: string
          speechRecognition: string
        }
        if (perms.microphone !== "granted" || perms.speechRecognition !== "granted") {
          listening = false
          return
        }

        const { Channel } = await import("@tauri-apps/api/core")
        const onResult = new Channel<RecognitionResult>()
        lastInterimText = ""
        onResult.onmessage = (result: RecognitionResult) => {
          const text = result.transcript?.trim()

          if (result.isFinal) {
            // iOS sends empty final results — use the last interim text instead
            const finalText = text || lastInterimText
            lastInterimText = ""
            if (finalText) {
              buffer.push({
                text: finalText,
                timestampMs: Date.now() - startEpochMs,
                confidence: result.confidence || 0.8,
              })
            }
          } else if (text) {
            lastInterimText = text
            wrapper.onInterim?.(text)
          }
        }

        await invoke("plugin:speech-recognizer|start", {
          onResult,
          config: {
            language: "en-US",
            interimResults: true,
            continuous: true,
          },
        })
      } catch {
        listening = false
      }
    },

    async stopListeningForMeeting(): Promise<void> {
      if (!listening) return
      listening = false
      if (flushIntervalId) {
        clearInterval(flushIntervalId)
        flushIntervalId = null
      }
      try {
        await invoke("plugin:speech-recognizer|stop")
      } catch {
        // stop failed silently
      }
      // Wait for final result to arrive from native side
      await new Promise((r) => setTimeout(r, 1500))
      // Flush any remaining interim text (iOS often doesn't send a useful final result)
      if (lastInterimText) {
        buffer.push({
          text: lastInterimText,
          timestampMs: Date.now() - startEpochMs,
          confidence: 0.7,
        })
        lastInterimText = ""
      }
    },

    service: {
      async transcribeChunk(chunk: AudioChunk): Promise<TranscriptChunk> {
        // Drain all new results since last chunk (avoids timestamp alignment issues)
        const newResults = buffer.slice(lastDrainIndex)
        lastDrainIndex = buffer.length
        const text = newResults.map((r) => r.text).join(" ")
        const avgConfidence =
          newResults.length > 0
            ? newResults.reduce((sum, r) => sum + r.confidence, 0) / newResults.length
            : 0

        return {
          id: uuid(),
          meetingId: chunk.meetingId,
          sequence: chunk.sequence,
          text,
          startTimeMs: chunk.startTimeMs,
          endTimeMs: chunk.endTimeMs,
          confidence: avgConfidence,
          createdAt: new Date().toISOString(),
        }
      },

      assembleTranscript(meetingId: string, chunks: TranscriptChunk[]): Transcript {
        const sorted = [...chunks].sort((a, b) => a.sequence - b.sequence)
        // Collect all text: from drained chunks + undrained buffer
        const undrained = buffer.slice(lastDrainIndex)
        const allText = [
          ...sorted.map((c) => c.text).filter(Boolean),
          ...undrained.map((r) => r.text),
        ].join(" ").trim()
        // Distribute text across chunks so export shows text at each timestamp
        if (allText && sorted.length > 0) {
          const words = allText.split(/\s+/)
          const perChunk = Math.ceil(words.length / sorted.length)
          for (let i = 0; i < sorted.length; i++) {
            sorted[i] = {
              ...sorted[i],
              text: words.slice(i * perChunk, (i + 1) * perChunk).join(" "),
            }
          }
        }
        return {
          id: uuid(),
          meetingId,
          chunks: sorted,
          fullText: allText,
          createdAt: new Date().toISOString(),
        }
      },
    } as TranscriptionService,
  }

  return wrapper
}
