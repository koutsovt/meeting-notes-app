import { v4 as uuid } from "uuid"
import type { DiarizationService } from "../../shared/services/diarization-service.js"
import type { TranscriptChunk, Speaker } from "../../shared/types/transcript.js"

export interface DiarizationResult {
  speakers: Speaker[]
  assignments: { chunkId: string; speakerId: string }[]
}

export interface DiarizationBackend {
  diarize(meetingId: string, chunks: TranscriptChunk[]): Promise<DiarizationResult>
}

function createStubBackend(): DiarizationBackend {
  return {
    async diarize(meetingId: string, chunks: TranscriptChunk[]): Promise<DiarizationResult> {
      if (chunks.length === 0) return { speakers: [], assignments: [] }

      const speakers: Speaker[] = [
        { id: uuid(), label: "Speaker 1", meetingId },
        { id: uuid(), label: "Speaker 2", meetingId },
      ]

      const assignments = chunks.map((chunk, i) => ({
        chunkId: chunk.id,
        speakerId: speakers[i % 2].id,
      }))

      return { speakers, assignments }
    },
  }
}

export function createDiarizationService(
  backend?: DiarizationBackend,
): DiarizationService {
  const b = backend ?? createStubBackend()

  return {
    async assignSpeakers(meetingId: string, chunks: TranscriptChunk[]) {
      const result = await b.diarize(meetingId, chunks)

      const assignmentMap = new Map(
        result.assignments.map((a) => [a.chunkId, a.speakerId]),
      )

      const updatedChunks = chunks.map((chunk) => ({
        ...chunk,
        speakerId: assignmentMap.get(chunk.id) ?? chunk.speakerId,
      }))

      return { chunks: updatedChunks, speakers: result.speakers }
    },
  }
}
