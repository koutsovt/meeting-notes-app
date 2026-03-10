import { v4 as uuid } from "uuid"
import type { TranscriptionService } from "../../shared/services/transcription-service.js"
import type { AudioChunk } from "../../shared/types/audio.js"
import type { TranscriptChunk, Transcript } from "../../shared/types/transcript.js"

/**
 * Seam where whisper.cpp (or any native binding) plugs in.
 * Implement this interface to swap in a real backend.
 */
export interface WhisperBackend {
  transcribe(audio: AudioChunk): Promise<{ text: string; confidence: number }>
}

const STUB_PHRASES = [
  "Let's discuss the project timeline.",
  "I think we should prioritize the backend work.",
  "The deadline is next Friday.",
  "Can someone take notes on the action items?",
  "We need to review the budget allocation.",
  "Let's schedule a follow-up meeting.",
  "The client requested changes to the design.",
  "Testing should begin by end of week.",
]

/**
 * Stub backend returning fake transcription text.
 */
export function createStubBackend(): WhisperBackend {
  return {
    async transcribe(audio: AudioChunk): Promise<{ text: string; confidence: number }> {
      const text = STUB_PHRASES[audio.sequence % STUB_PHRASES.length]
      const confidence = 0.88 + Math.random() * 0.1
      return { text, confidence: Math.round(confidence * 1000) / 1000 }
    },
  }
}

/**
 * Factory for TranscriptionService.
 * Pass a WhisperBackend to use real whisper.cpp; omit for stub.
 */
export function createTranscriptionService(
  backend: WhisperBackend = createStubBackend()
): TranscriptionService {
  return {
    async transcribeChunk(chunk: AudioChunk): Promise<TranscriptChunk> {
      const result = await backend.transcribe(chunk)
      return {
        id: uuid(),
        meetingId: chunk.meetingId,
        sequence: chunk.sequence,
        text: result.text,
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
