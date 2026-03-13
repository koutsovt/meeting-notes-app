import { invoke } from "@tauri-apps/api/core"
import { v4 as uuid } from "uuid"
import type { TranscriptionService } from "@shared/services/transcription-service.js"
import type { AudioChunk } from "@shared/types/audio.js"
import type { TranscriptChunk, Transcript } from "@shared/types/transcript.js"

interface RustTranscriptionResult {
  text: string
  confidence: number
  segments: { text: string; start_ms: number; end_ms: number; confidence: number; no_speech_prob: number; speaker_turn_next: boolean }[]
}

export interface TranscriptionConfig {
  strategy: "greedy" | "beam_search"
  best_of: number
  n_threads: number
  temperature: number
  temperature_inc: number
  entropy_thold: number
  logprob_thold: number
  no_speech_thold: number
  language: string
  initial_prompt: string
  suppress_blank: boolean
  suppress_nst: boolean
  tdrz_enable: boolean
}

export async function setTranscriptionConfig(config: Partial<TranscriptionConfig>): Promise<void> {
  const current: TranscriptionConfig = await invoke("get_transcription_config")
  await invoke("set_transcription_config", { config: { ...current, ...config } })
}

export async function getTranscriptionConfig(): Promise<TranscriptionConfig> {
  return invoke("get_transcription_config")
}

/**
 * Tauri-native transcription service.
 * Sends PCM audio to the Rust whisper.cpp backend via Tauri commands.
 *
 * Audio flow:
 *   AudioChunk.samples (48kHz stereo) → prepare_audio (Rust resample) → transcribe_audio (Rust whisper)
 */
export function createTauriTranscriptionService(): TranscriptionService {
  return {
    async transcribeChunk(chunk: AudioChunk): Promise<TranscriptChunk> {
      if (!chunk.samples || chunk.samples.length === 0) {
        return {
          id: uuid(),
          meetingId: chunk.meetingId,
          sequence: chunk.sequence,
          text: "(no audio data)",
          startTimeMs: chunk.startTimeMs,
          endTimeMs: chunk.endTimeMs,
          confidence: 0,
          createdAt: new Date().toISOString(),
        }
      }

      const rawBase64 = float32ToBase64(chunk.samples)

      // Resample in Rust: 48kHz stereo → 16kHz mono
      const preparedBase64: string = await invoke("prepare_audio", {
        samplesBase64: rawBase64,
        sourceRate: chunk.sampleRate ?? 48000,
        channelCount: chunk.channelCount ?? 2,
      })

      // Transcribe in Rust via whisper.cpp
      const result: RustTranscriptionResult = await invoke("transcribe_audio", {
        samplesBase64: preparedBase64,
      })

      // Detect speaker turns from:
      // 1. tinydiarize flag
      // 2. timestamp gap > 800ms between segments
      // 3. whisper dash prefix ("- text") which indicates a new speaker
      let text = ""
      let currentSpeaker = 0
      if (result.segments.length > 0) {
        text = `[Speaker ${currentSpeaker + 1}]: `
        for (let si = 0; si < result.segments.length; si++) {
          const seg = result.segments[si]
          let segText = seg.text.trim()

          // Whisper inserts "- " prefix for speaker changes
          const hasDashPrefix = segText.startsWith("- ") || segText.startsWith("−")
          if (hasDashPrefix) {
            if (si > 0) {
              currentSpeaker++
            }
            text += si > 0 ? `\n[Speaker ${currentSpeaker + 1}]: ` : ""
            segText = segText.replace(/^[-−]\s*/, "")
          }

          text += segText

          // Check for speaker turn: tinydiarize flag, gap, or short interjection pattern
          const nextSeg = result.segments[si + 1]
          const hasGap = nextSeg && (nextSeg.start_ms - seg.end_ms) > 800
          const segDuration = seg.end_ms - seg.start_ms
          const isShortInterjection = segDuration < 2000 && nextSeg && (nextSeg.end_ms - nextSeg.start_ms) > 3000
          if (seg.speaker_turn_next || hasGap || isShortInterjection) {
            currentSpeaker++
            text += `\n[Speaker ${currentSpeaker + 1}]: `
          }
        }
        text = text.trim()
      }

      return {
        id: uuid(),
        meetingId: chunk.meetingId,
        sequence: chunk.sequence,
        text: text || "(no speech detected)",
        startTimeMs: chunk.startTimeMs,
        endTimeMs: chunk.endTimeMs,
        confidence: result.confidence,
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
  }
}

function float32ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
