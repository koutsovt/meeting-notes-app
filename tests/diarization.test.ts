import { describe, it, expect } from "vitest"
import { createDiarizationService } from "../modules/diarization/index.js"
import type { DiarizationBackend } from "../modules/diarization/index.js"
import type { TranscriptChunk } from "../shared/types/transcript.js"

function makeChunks(count: number): TranscriptChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tc-${i}`,
    meetingId: "m-1",
    sequence: i,
    text: `Chunk ${i} text`,
    startTimeMs: i * 5000,
    endTimeMs: (i + 1) * 5000,
    confidence: 0.9,
    createdAt: "2026-03-10T10:00:00Z",
  }))
}

describe("DiarizationService", () => {
  it("stub assigns speakers in round-robin across chunks", async () => {
    const service = createDiarizationService()
    const chunks = makeChunks(4)
    const result = await service.assignSpeakers("m-1", chunks)

    expect(result.speakers).toHaveLength(2)
    expect(result.chunks).toHaveLength(4)

    expect(result.chunks[0].speakerId).toBe(result.speakers[0].id)
    expect(result.chunks[1].speakerId).toBe(result.speakers[1].id)
    expect(result.chunks[2].speakerId).toBe(result.speakers[0].id)
    expect(result.chunks[3].speakerId).toBe(result.speakers[1].id)
  })

  it("handles empty chunks", async () => {
    const service = createDiarizationService()
    const result = await service.assignSpeakers("m-1", [])

    expect(result.speakers).toHaveLength(0)
    expect(result.chunks).toHaveLength(0)
  })

  it("custom backend injection works", async () => {
    const customBackend: DiarizationBackend = {
      async diarize(meetingId, chunks) {
        const speaker = { id: "custom-speaker", label: "Alice", meetingId }
        return {
          speakers: [speaker],
          assignments: chunks.map((c) => ({ chunkId: c.id, speakerId: "custom-speaker" })),
        }
      },
    }

    const service = createDiarizationService(customBackend)
    const chunks = makeChunks(3)
    const result = await service.assignSpeakers("m-1", chunks)

    expect(result.speakers).toHaveLength(1)
    expect(result.speakers[0].label).toBe("Alice")
    expect(result.chunks.every((c) => c.speakerId === "custom-speaker")).toBe(true)
  })

  it("speaker labels include meeting id", async () => {
    const service = createDiarizationService()
    const chunks = makeChunks(2)
    const result = await service.assignSpeakers("m-42", chunks)

    for (const speaker of result.speakers) {
      expect(speaker.meetingId).toBe("m-42")
    }
  })
})
