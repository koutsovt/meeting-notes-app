import type { AudioChunk } from "../types/audio.js"

export type AudioChunkHandler = (chunk: AudioChunk) => void

export interface CaptureService {
  start(meetingId: string, onChunk: AudioChunkHandler): void
  stop(): void
  isCapturing(): boolean
}
