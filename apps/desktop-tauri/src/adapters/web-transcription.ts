import { v4 as uuid } from "uuid"
import type { TranscriptionService } from "@shared/services/transcription-service.js"
import type { AudioChunk } from "@shared/types/audio.js"
import type { TranscriptChunk, Transcript } from "@shared/types/transcript.js"
import type { SpeechBuffer } from "./speech-buffer.js"

/**
 * Real browser transcription service.
 * Reads recognized text from the shared SpeechBuffer for each chunk's time window.
 */
export function createWebTranscriptionService(
  speechBuffer: SpeechBuffer,
): TranscriptionService {
  return {
    async transcribeChunk(chunk: AudioChunk): Promise<TranscriptChunk> {
      const result = speechBuffer.getTextForRange(chunk.startTimeMs, chunk.endTimeMs)

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
