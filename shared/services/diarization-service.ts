import type { TranscriptChunk, Speaker } from "../types/transcript.js"

export interface DiarizationService {
  assignSpeakers(meetingId: string, chunks: TranscriptChunk[]): Promise<{
    chunks: TranscriptChunk[]
    speakers: Speaker[]
  }>
}
