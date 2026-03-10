export interface AudioChunk {
  id: string
  meetingId: string
  sequence: number
  startTimeMs: number
  endTimeMs: number
  source: "system" | "microphone"
  samples?: Float32Array
  sampleRate?: number
  channelCount?: number
  createdAt: string
}
