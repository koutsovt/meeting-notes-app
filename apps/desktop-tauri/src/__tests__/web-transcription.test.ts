import { describe, it, expect } from "vitest"
import { createWebTranscriptionService } from "../adapters/web-transcription.js"
import type { SpeechBuffer } from "../adapters/speech-buffer.js"
import type { AudioChunk } from "@shared/types/audio.js"

function mockSpeechBuffer(textMap: Record<string, { text: string; confidence: number }>): SpeechBuffer {
  return {
    start() {},
    stop() {},
    clear() {},
    isRunning() { return true },
    onInterim: null,
    getTextForRange(startMs, endMs) {
      const key = `${startMs}-${endMs}`
      return textMap[key] ?? { text: "(no speech detected)", confidence: 0 }
    },
  }
}

function makeChunk(seq: number): AudioChunk {
  return {
    id: `ac-${seq}`,
    meetingId: "m-1",
    sequence: seq,
    startTimeMs: seq * 5000,
    endTimeMs: (seq + 1) * 5000,
    source: "microphone",
    createdAt: new Date().toISOString(),
  }
}

describe("WebTranscriptionService", () => {
  it("returns recognized text for a chunk's time window", async () => {
    const buffer = mockSpeechBuffer({
      "0-5000": { text: "Hello world", confidence: 0.9 },
    })
    const service = createWebTranscriptionService(buffer)
    const result = await service.transcribeChunk(makeChunk(0))

    expect(result.text).toBe("Hello world")
    expect(result.confidence).toBe(0.9)
    expect(result.meetingId).toBe("m-1")
    expect(result.sequence).toBe(0)
  })

  it("returns no-speech for unrecognized windows", async () => {
    const buffer = mockSpeechBuffer({})
    const service = createWebTranscriptionService(buffer)
    const result = await service.transcribeChunk(makeChunk(0))

    expect(result.text).toBe("(no speech detected)")
    expect(result.confidence).toBe(0)
  })

  it("assembles transcript from chunks", async () => {
    const buffer = mockSpeechBuffer({
      "0-5000": { text: "Hello", confidence: 0.9 },
      "5000-10000": { text: "World", confidence: 0.85 },
    })
    const service = createWebTranscriptionService(buffer)

    const c0 = await service.transcribeChunk(makeChunk(0))
    const c1 = await service.transcribeChunk(makeChunk(1))
    const transcript = service.assembleTranscript("m-1", [c1, c0])

    expect(transcript.chunks[0].sequence).toBe(0)
    expect(transcript.chunks[1].sequence).toBe(1)
    expect(transcript.fullText).toBe("Hello World")
  })
})
