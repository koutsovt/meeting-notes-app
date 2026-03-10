export interface AudioChunk {
  id: string
  meetingId: string
  sequence: number
  startTimeMs: number
  endTimeMs: number
  source: "system" | "microphone"
  createdAt: string
}
