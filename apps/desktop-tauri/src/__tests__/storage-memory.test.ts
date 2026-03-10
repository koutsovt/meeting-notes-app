import { describe, it, expect, beforeEach } from "vitest"
import { createMemoryStorageService } from "../storage-memory.js"
import type { StorageService } from "@shared/services/storage-service.js"
import type { Meeting } from "@shared/types/meeting.js"
import type { Transcript } from "@shared/types/transcript.js"
import type { MeetingSummary } from "@shared/types/summary.js"

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m-1",
    title: "Test",
    status: "recording",
    startedAt: "2026-03-10T10:00:00Z",
    endedAt: null,
    createdAt: "2026-03-10T10:00:00Z",
    ...overrides,
  }
}

function makeTranscript(): Transcript {
  return {
    id: "t-1",
    meetingId: "m-1",
    chunks: [
      { id: "tc-1", meetingId: "m-1", sequence: 0, text: "Hi", startTimeMs: 0, endTimeMs: 5000, confidence: 0.9, createdAt: "2026-03-10T10:00:05Z" },
    ],
    fullText: "Hi",
    createdAt: "2026-03-10T10:00:05Z",
  }
}

function makeSummary(): MeetingSummary {
  return {
    id: "s-1",
    meetingId: "m-1",
    title: "Summary",
    overview: "Overview",
    actionItems: [{ id: "a-1", description: "Do it", assignee: null, dueDate: null }],
    decisions: [],
    keyPoints: ["Key"],
    createdAt: "2026-03-10T10:01:00Z",
  }
}

describe("MemoryStorageService", () => {
  let storage: StorageService

  beforeEach(() => {
    storage = createMemoryStorageService()
  })

  it("creates and retrieves a meeting", () => {
    storage.createMeeting(makeMeeting())
    expect(storage.getMeeting("m-1")).toEqual(makeMeeting())
  })

  it("returns null for missing meeting", () => {
    expect(storage.getMeeting("x")).toBeNull()
  })

  it("updates a meeting", () => {
    storage.createMeeting(makeMeeting())
    storage.updateMeeting(makeMeeting({ status: "completed", endedAt: "2026-03-10T11:00:00Z" }))
    expect(storage.getMeeting("m-1")?.status).toBe("completed")
  })

  it("lists meetings in descending order", () => {
    storage.createMeeting(makeMeeting({ id: "m-1", createdAt: "2026-03-10T09:00:00Z" }))
    storage.createMeeting(makeMeeting({ id: "m-2", createdAt: "2026-03-10T10:00:00Z" }))
    const list = storage.listMeetings()
    expect(list[0].id).toBe("m-2")
  })

  it("rejects duplicate meeting", () => {
    storage.createMeeting(makeMeeting())
    expect(() => storage.createMeeting(makeMeeting())).toThrow()
  })

  it("deletes a meeting and related data", () => {
    storage.createMeeting(makeMeeting())
    storage.saveTranscript(makeTranscript())
    storage.saveSummary(makeSummary())
    storage.deleteMeeting("m-1")
    expect(storage.getMeeting("m-1")).toBeNull()
    expect(storage.getTranscript("m-1")).toBeNull()
    expect(storage.getSummary("m-1")).toBeNull()
  })

  it("saves and retrieves transcript", () => {
    storage.createMeeting(makeMeeting())
    storage.saveTranscript(makeTranscript())
    const t = storage.getTranscript("m-1")!
    expect(t.chunks).toHaveLength(1)
    expect(t.fullText).toBe("Hi")
  })

  it("saves and retrieves summary", () => {
    storage.createMeeting(makeMeeting())
    storage.saveSummary(makeSummary())
    const s = storage.getSummary("m-1")!
    expect(s.actionItems).toHaveLength(1)
    expect(s.keyPoints).toEqual(["Key"])
  })

  it("returns copies, not references", () => {
    storage.createMeeting(makeMeeting())
    const a = storage.getMeeting("m-1")!
    a.title = "mutated"
    expect(storage.getMeeting("m-1")!.title).toBe("Test")
  })
})
