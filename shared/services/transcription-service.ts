import type { AudioChunk } from "../types/audio.js"
import type { TranscriptChunk, Transcript } from "../types/transcript.js"

export interface TranscriptionService {
  transcribeChunk(chunk: AudioChunk): Promise<TranscriptChunk>
  assembleTranscript(meetingId: string, chunks: TranscriptChunk[]): Transcript
}
