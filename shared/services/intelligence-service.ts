import type { Transcript, TranscriptChunk } from "../types/transcript.js"
import type { MeetingSummary, LiveNote } from "../types/summary.js"

export interface IntelligenceService {
  generateSummary(transcript: Transcript): Promise<MeetingSummary>
  generateLiveNote?(
    meetingId: string,
    recentChunks: TranscriptChunk[],
    previousNote: LiveNote | null
  ): Promise<LiveNote>
}
