import { describe, it, expect } from "vitest"
import { createTranscriptionService, createStubBackend } from "../modules/transcription/index.js"
import type { WhisperBackend } from "../modules/transcription/index.js"
import type { AudioChunk } from "../shared/types/audio.js"

function makeChunk(seq: number, meetingId = "m-1"): AudioChunk {
  return {
    id: `ac-${seq}`,
    meetingId,
    sequence: seq,
    startTimeMs: seq * 5000,
    endTimeMs: (seq + 1) * 5000,
    source: "microphone",
    createdAt: new Date().toISOString(),
  }
}

describe("TranscriptionService", () => {
  it("transcribes a chunk and returns a valid TranscriptChunk", async () => {
    const service = createTranscriptionService()
    const result = await service.transcribeChunk(makeChunk(0))

    expect(result.id).toBeTruthy()
    expect(result.meetingId).toBe("m-1")
    expect(result.sequence).toBe(0)
    expect(result.text).toBeTruthy()
    expect(result.startTimeMs).toBe(0)
    expect(result.endTimeMs).toBe(5000)
    expect(result.createdAt).toBeTruthy()
  })

  it("propagates meetingId and sequence from the audio chunk", async () => {
    const service = createTranscriptionService()
    const r1 = await service.transcribeChunk(makeChunk(3, "meeting-abc"))
    const r2 = await service.transcribeChunk(makeChunk(7, "meeting-xyz"))

    expect(r1.meetingId).toBe("meeting-abc")
    expect(r1.sequence).toBe(3)
    expect(r2.meetingId).toBe("meeting-xyz")
    expect(r2.sequence).toBe(7)
  })

  it("assembles transcript with sorted chunks", async () => {
    const service = createTranscriptionService()
    const chunks = await Promise.all([0, 1, 2].map((s) => service.transcribeChunk(makeChunk(s))))
    const transcript = service.assembleTranscript("m-1", chunks)

    expect(transcript.meetingId).toBe("m-1")
    expect(transcript.chunks).toHaveLength(3)
    expect(transcript.fullText).toBeTruthy()
    expect(transcript.chunks[0].sequence).toBe(0)
    expect(transcript.chunks[1].sequence).toBe(1)
    expect(transcript.chunks[2].sequence).toBe(2)
  })

  it("sorts out-of-order chunks when assembling", async () => {
    const service = createTranscriptionService()
    const chunks = await Promise.all([2, 0, 1].map((s) => service.transcribeChunk(makeChunk(s))))
    const transcript = service.assembleTranscript("m-1", chunks)

    expect(transcript.chunks[0].sequence).toBe(0)
    expect(transcript.chunks[1].sequence).toBe(1)
    expect(transcript.chunks[2].sequence).toBe(2)
  })

  it("produces confidence values within 0-1 range that vary per chunk", async () => {
    const service = createTranscriptionService()
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => service.transcribeChunk(makeChunk(i)))
    )
    const confidences = results.map((r) => r.confidence)

    for (const c of confidences) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }

    const unique = new Set(confidences)
    expect(unique.size).toBeGreaterThan(1)
  })

  it("assembles an empty chunk list into an empty transcript", () => {
    const service = createTranscriptionService()
    const transcript = service.assembleTranscript("m-1", [])

    expect(transcript.meetingId).toBe("m-1")
    expect(transcript.chunks).toHaveLength(0)
    expect(transcript.fullText).toBe("")
  })

  it("constructs fullText by joining sorted chunk texts with spaces", async () => {
    const service = createTranscriptionService()
    const chunks = await Promise.all([0, 1, 2].map((s) => service.transcribeChunk(makeChunk(s))))
    const transcript = service.assembleTranscript("m-1", chunks)

    const sorted = [...chunks].sort((a, b) => a.sequence - b.sequence)
    const expected = sorted.map((c) => c.text).join(" ")
    expect(transcript.fullText).toBe(expected)
  })

  it("accepts a custom WhisperBackend", async () => {
    const custom: WhisperBackend = {
      async transcribe() {
        return { text: "custom output", confidence: 0.99 }
      },
    }
    const service = createTranscriptionService(custom)
    const result = await service.transcribeChunk(makeChunk(0))

    expect(result.text).toBe("custom output")
    expect(result.confidence).toBe(0.99)
  })
})
