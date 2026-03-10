export interface TranscriptChunk {
  id: string
  meetingId: string
  sequence: number
  text: string
  startTimeMs: number
  endTimeMs: number
  confidence: number
  speakerId?: string
  createdAt: string
}

export interface Speaker {
  id: string
  label: string
  meetingId: string
  profileId?: string
}

export interface Transcript {
  id: string
  meetingId: string
  chunks: TranscriptChunk[]
  fullText: string
  createdAt: string
}
