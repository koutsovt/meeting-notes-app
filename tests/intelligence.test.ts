import { describe, it, expect } from "vitest"
import { createIntelligenceService, createKeywordLiveBackend } from "../modules/intelligence/index.js"
import type { SummaryBackend, LiveSummaryBackend } from "../modules/intelligence/index.js"
import type { Transcript, TranscriptChunk } from "../shared/types/transcript.js"
import type { LiveNote } from "../shared/types/summary.js"

function makeTranscript(overrides?: Partial<Transcript>): Transcript {
  return {
    id: "t-1",
    meetingId: "m-1",
    chunks: [
      { id: "tc-1", meetingId: "m-1", sequence: 0, text: "We should prioritize the backend.", startTimeMs: 0, endTimeMs: 5000, confidence: 0.9, createdAt: "2026-03-10T10:00:05Z" },
      { id: "tc-2", meetingId: "m-1", sequence: 1, text: "The team agreed on the new architecture.", startTimeMs: 5000, endTimeMs: 10000, confidence: 0.95, createdAt: "2026-03-10T10:00:10Z" },
      { id: "tc-3", meetingId: "m-1", sequence: 2, text: "What is the timeline for delivery?", startTimeMs: 10000, endTimeMs: 15000, confidence: 0.92, createdAt: "2026-03-10T10:00:15Z" },
      { id: "tc-4", meetingId: "m-1", sequence: 3, text: "The project uses TypeScript and Vitest.", startTimeMs: 15000, endTimeMs: 20000, confidence: 0.91, createdAt: "2026-03-10T10:00:20Z" },
    ],
    fullText: "We should prioritize the backend. The team agreed on the new architecture. What is the timeline for delivery? The project uses TypeScript and Vitest.",
    createdAt: "2026-03-10T10:00:20Z",
    ...overrides,
  }
}

function makeEmptyTranscript(): Transcript {
  return {
    id: "t-empty",
    meetingId: "m-empty",
    chunks: [],
    fullText: "",
    createdAt: "2026-03-10T10:00:00Z",
  }
}

function makeSingleChunkTranscript(): Transcript {
  return {
    id: "t-single",
    meetingId: "m-single",
    chunks: [
      { id: "tc-1", meetingId: "m-single", sequence: 0, text: "We need to fix the login bug.", startTimeMs: 0, endTimeMs: 3000, confidence: 0.88, createdAt: "2026-03-10T10:00:03Z" },
    ],
    fullText: "We need to fix the login bug.",
    createdAt: "2026-03-10T10:00:03Z",
  }
}

describe("IntelligenceService", () => {
  it("generates valid MeetingSummary with all required fields", async () => {
    const service = createIntelligenceService()
    const summary = await service.generateSummary(makeTranscript())

    expect(summary.id).toBeTruthy()
    expect(summary.meetingId).toBe("m-1")
    expect(summary.title).toBeTruthy()
    expect(summary.overview).toBeTruthy()
    expect(summary.createdAt).toBeTruthy()
    expect(Array.isArray(summary.actionItems)).toBe(true)
    expect(Array.isArray(summary.decisions)).toBe(true)
    expect(Array.isArray(summary.keyPoints)).toBe(true)
  })

  it("extracts action items from keyword patterns", async () => {
    const service = createIntelligenceService()
    const summary = await service.generateSummary(makeTranscript())

    expect(summary.actionItems.length).toBe(1)
    expect(summary.actionItems[0].description).toContain("should prioritize")
    expect(summary.actionItems[0].id).toBeTruthy()
    expect(summary.actionItems[0].assignee).toBeNull()
    expect(summary.actionItems[0].dueDate).toBeNull()
  })

  it("extracts decisions from keyword patterns", async () => {
    const service = createIntelligenceService()
    const summary = await service.generateSummary(makeTranscript())

    expect(summary.decisions.length).toBe(1)
    expect(summary.decisions[0].description).toContain("agreed")
    expect(summary.decisions[0].id).toBeTruthy()
    expect(summary.decisions[0].madeBy).toBeNull()
  })

  it("excludes questions from key points", async () => {
    const service = createIntelligenceService()
    const summary = await service.generateSummary(makeTranscript())

    for (const point of summary.keyPoints) {
      expect(point).not.toContain("?")
    }
  })

  it("generates key points from informational sentences", async () => {
    const service = createIntelligenceService()
    const summary = await service.generateSummary(makeTranscript())

    expect(summary.keyPoints.length).toBe(1)
    expect(summary.keyPoints[0]).toContain("TypeScript and Vitest")
  })

  it("handles empty transcript", async () => {
    const service = createIntelligenceService()
    const summary = await service.generateSummary(makeEmptyTranscript())

    expect(summary.meetingId).toBe("m-empty")
    expect(summary.title).toBe("Empty Meeting")
    expect(summary.actionItems).toEqual([])
    expect(summary.decisions).toEqual([])
    expect(summary.keyPoints).toEqual([])
  })

  it("handles transcript with only one chunk", async () => {
    const service = createIntelligenceService()
    const summary = await service.generateSummary(makeSingleChunkTranscript())

    expect(summary.meetingId).toBe("m-single")
    expect(summary.actionItems.length).toBe(1)
    expect(summary.actionItems[0].description).toContain("need to")
  })

  it("custom backend injection works", async () => {
    const customBackend: SummaryBackend = {
      async analyze() {
        return {
          title: "Custom Title",
          overview: "Custom Overview",
          actionItems: [],
          decisions: [],
          keyPoints: ["custom point"],
        }
      },
    }

    const service = createIntelligenceService(customBackend)
    const summary = await service.generateSummary(makeTranscript())

    expect(summary.title).toBe("Custom Title")
    expect(summary.overview).toBe("Custom Overview")
    expect(summary.keyPoints).toEqual(["custom point"])
  })

  it("propagates meetingId correctly", async () => {
    const service = createIntelligenceService()
    const transcript = makeTranscript({ meetingId: "m-custom-42" })
    const summary = await service.generateSummary(transcript)

    expect(summary.meetingId).toBe("m-custom-42")
  })

  it("classifies sentence matching both action and decision patterns", async () => {
    const service = createIntelligenceService()
    const transcript: Transcript = {
      id: "t-multi",
      meetingId: "m-multi",
      chunks: [
        { id: "tc-1", meetingId: "m-multi", sequence: 0, text: "We agreed we should refactor the auth module.", startTimeMs: 0, endTimeMs: 5000, confidence: 0.9, createdAt: "2026-03-10T10:00:05Z" },
      ],
      fullText: "We agreed we should refactor the auth module.",
      createdAt: "2026-03-10T10:00:05Z",
    }
    const summary = await service.generateSummary(transcript)

    expect(summary.actionItems.length).toBe(1)
    expect(summary.decisions.length).toBe(1)
    expect(summary.keyPoints.length).toBe(0)
  })

  it("truncates long titles at 80 characters", async () => {
    const service = createIntelligenceService()
    const longSentence = "A".repeat(100) + "."
    const transcript: Transcript = {
      id: "t-long",
      meetingId: "m-long",
      chunks: [
        { id: "tc-1", meetingId: "m-long", sequence: 0, text: longSentence, startTimeMs: 0, endTimeMs: 5000, confidence: 0.9, createdAt: "2026-03-10T10:00:05Z" },
      ],
      fullText: longSentence,
      createdAt: "2026-03-10T10:00:05Z",
    }
    const summary = await service.generateSummary(transcript)

    expect(summary.title.length).toBeLessThanOrEqual(80)
    expect(summary.title).toMatch(/\.\.\.$/)
  })
})

function makeChunks(texts: string[]): TranscriptChunk[] {
  return texts.map((text, i) => ({
    id: `tc-${i}`,
    meetingId: "m-1",
    sequence: i,
    text,
    startTimeMs: i * 5000,
    endTimeMs: (i + 1) * 5000,
    confidence: 0.9,
    createdAt: "2026-03-10T10:00:00Z",
  }))
}

describe("IntelligenceService - Live Notes", () => {
  it("generates a live note from recent chunks", async () => {
    const liveBackend = createKeywordLiveBackend()
    const service = createIntelligenceService(undefined, liveBackend)

    expect(service.generateLiveNote).toBeDefined()

    const chunks = makeChunks([
      "The project uses TypeScript and Vitest.",
      "We should prioritize the backend work.",
    ])

    const note = await service.generateLiveNote!("m-1", chunks, null)

    expect(note.meetingId).toBe("m-1")
    expect(note.sequenceNum).toBe(0)
    expect(note.windowStartMs).toBe(0)
    expect(note.windowEndMs).toBe(10000)
    expect(note.actionItems.length).toBe(1)
    expect(note.actionItems[0].description).toContain("should prioritize")
  })

  it("incremental: new note doesn't duplicate previous keyPoints", async () => {
    const liveBackend = createKeywordLiveBackend()
    const service = createIntelligenceService(undefined, liveBackend)

    const chunks1 = makeChunks(["The project uses TypeScript and Vitest."])
    const note1 = await service.generateLiveNote!("m-1", chunks1, null)
    expect(note1.keyPoints.length).toBe(1)

    const chunks2 = makeChunks([
      "The project uses TypeScript and Vitest.",
      "The deadline is next Friday.",
    ])
    const note2 = await service.generateLiveNote!("m-1", chunks2, note1)

    expect(note2.sequenceNum).toBe(1)
    const duplicates = note2.keyPoints.filter((p) => note1.keyPoints.includes(p))
    expect(duplicates).toHaveLength(0)
  })

  it("empty chunks → empty live note", async () => {
    const liveBackend = createKeywordLiveBackend()
    const service = createIntelligenceService(undefined, liveBackend)

    const note = await service.generateLiveNote!("m-1", [], null)

    expect(note.keyPoints).toEqual([])
    expect(note.actionItems).toEqual([])
    expect(note.windowStartMs).toBe(0)
    expect(note.windowEndMs).toBe(0)
  })

  it("generateLiveNote is undefined when no live backend provided", () => {
    const service = createIntelligenceService()
    expect(service.generateLiveNote).toBeUndefined()
  })
})
