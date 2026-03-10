import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createStorageService } from "../modules/storage/index.js"
import type { StorageService } from "../shared/services/storage-service.js"
import type { Meeting } from "../shared/types/meeting.js"
import type { Transcript } from "../shared/types/transcript.js"
import type { Speaker } from "../shared/types/transcript.js"
import type { MeetingSummary, LiveNote } from "../shared/types/summary.js"

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m-1",
    title: "Test Meeting",
    status: "recording",
    startedAt: "2026-03-10T10:00:00Z",
    endedAt: null,
    createdAt: "2026-03-10T10:00:00Z",
    ...overrides,
  }
}

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    id: "t-1",
    meetingId: "m-1",
    chunks: [
      { id: "tc-1", meetingId: "m-1", sequence: 0, text: "Hello", startTimeMs: 0, endTimeMs: 5000, confidence: 0.95, createdAt: "2026-03-10T10:00:05Z" },
      { id: "tc-2", meetingId: "m-1", sequence: 1, text: "World", startTimeMs: 5000, endTimeMs: 10000, confidence: 0.9, createdAt: "2026-03-10T10:00:10Z" },
    ],
    fullText: "Hello World",
    createdAt: "2026-03-10T10:00:10Z",
    ...overrides,
  }
}

function makeSummary(overrides: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    id: "s-1",
    meetingId: "m-1",
    title: "Test Summary",
    overview: "A test meeting overview",
    actionItems: [{ id: "a-1", description: "Do something", assignee: null, dueDate: null }],
    decisions: [{ id: "d-1", description: "Decided X", madeBy: null }],
    keyPoints: ["Point 1"],
    createdAt: "2026-03-10T10:01:00Z",
    ...overrides,
  }
}

describe("StorageService", () => {
  let storage: StorageService

  beforeEach(() => {
    storage = createStorageService(":memory:")
  })

  afterEach(() => {
    storage.close()
  })

  describe("meetings", () => {
    it("creates and retrieves a meeting", () => {
      const meeting = makeMeeting()
      storage.createMeeting(meeting)
      expect(storage.getMeeting("m-1")).toEqual(meeting)
    })

    it("updates a meeting status and endedAt", () => {
      storage.createMeeting(makeMeeting())
      const updated = makeMeeting({ status: "completed", endedAt: "2026-03-10T11:00:00Z" })
      storage.updateMeeting(updated)
      const result = storage.getMeeting("m-1")
      expect(result?.status).toBe("completed")
      expect(result?.endedAt).toBe("2026-03-10T11:00:00Z")
    })

    it("lists meetings in descending creation order", () => {
      storage.createMeeting(makeMeeting({ id: "m-1", createdAt: "2026-03-10T09:00:00Z" }))
      storage.createMeeting(makeMeeting({ id: "m-2", title: "Later", createdAt: "2026-03-10T10:00:00Z" }))
      const list = storage.listMeetings()
      expect(list).toHaveLength(2)
      expect(list[0].id).toBe("m-2")
      expect(list[1].id).toBe("m-1")
    })

    it("returns null for missing meeting", () => {
      expect(storage.getMeeting("nonexistent")).toBeNull()
    })

    it("rejects duplicate meeting id", () => {
      storage.createMeeting(makeMeeting())
      expect(() => storage.createMeeting(makeMeeting())).toThrow()
    })

    it("rejects invalid status", () => {
      expect(() =>
        storage.createMeeting(makeMeeting({ status: "invalid" as Meeting["status"] }))
      ).toThrow()
    })

    it("deletes a meeting and its related data", () => {
      storage.createMeeting(makeMeeting())
      storage.saveTranscript(makeTranscript())
      storage.saveSummary(makeSummary())

      storage.deleteMeeting("m-1")

      expect(storage.getMeeting("m-1")).toBeNull()
      expect(storage.getTranscript("m-1")).toBeNull()
      expect(storage.getSummary("m-1")).toBeNull()
    })

    it("deleteMeeting is a no-op for missing id", () => {
      expect(() => storage.deleteMeeting("nonexistent")).not.toThrow()
    })
  })

  describe("transcripts", () => {
    it("saves and retrieves a transcript with chunks", () => {
      storage.createMeeting(makeMeeting())
      storage.saveTranscript(makeTranscript())
      const result = storage.getTranscript("m-1")
      expect(result).not.toBeNull()
      expect(result!.chunks).toHaveLength(2)
      expect(result!.fullText).toBe("Hello World")
    })

    it("returns chunks in sequence order", () => {
      storage.createMeeting(makeMeeting())
      storage.saveTranscript(makeTranscript())
      const result = storage.getTranscript("m-1")!
      expect(result.chunks[0].sequence).toBe(0)
      expect(result.chunks[1].sequence).toBe(1)
    })

    it("overwrites transcript on re-save", () => {
      storage.createMeeting(makeMeeting())
      storage.saveTranscript(makeTranscript())
      storage.saveTranscript(makeTranscript({
        id: "t-2",
        fullText: "Updated text",
        chunks: [
          { id: "tc-3", meetingId: "m-1", sequence: 0, text: "Updated", startTimeMs: 0, endTimeMs: 3000, confidence: 0.99, createdAt: "2026-03-10T10:01:00Z" },
        ],
      }))
      const result = storage.getTranscript("m-1")!
      expect(result.id).toBe("t-2")
      expect(result.fullText).toBe("Updated text")
      expect(result.chunks).toHaveLength(1)
    })

    it("returns null for missing transcript", () => {
      expect(storage.getTranscript("nonexistent")).toBeNull()
    })

    it("rejects transcript for nonexistent meeting (FK constraint)", () => {
      expect(() => storage.saveTranscript(makeTranscript({ meetingId: "no-such-meeting" }))).toThrow()
    })
  })

  describe("summaries", () => {
    it("saves and retrieves a summary", () => {
      storage.createMeeting(makeMeeting())
      storage.saveSummary(makeSummary())
      const result = storage.getSummary("m-1")
      expect(result).not.toBeNull()
      expect(result!.actionItems).toHaveLength(1)
      expect(result!.decisions).toHaveLength(1)
      expect(result!.keyPoints).toEqual(["Point 1"])
    })

    it("overwrites summary on re-save", () => {
      storage.createMeeting(makeMeeting())
      storage.saveSummary(makeSummary())
      storage.saveSummary(makeSummary({
        id: "s-2",
        overview: "New overview",
        actionItems: [],
        keyPoints: ["A", "B"],
      }))
      const result = storage.getSummary("m-1")!
      expect(result.id).toBe("s-2")
      expect(result.overview).toBe("New overview")
      expect(result.actionItems).toHaveLength(0)
      expect(result.keyPoints).toEqual(["A", "B"])
    })

    it("returns null for missing summary", () => {
      expect(storage.getSummary("nonexistent")).toBeNull()
    })

    it("preserves actionItem fields through JSON round-trip", () => {
      storage.createMeeting(makeMeeting())
      storage.saveSummary(makeSummary({
        actionItems: [{ id: "a-1", description: "Task", assignee: "Alice", dueDate: "2026-03-15" }],
      }))
      const result = storage.getSummary("m-1")!
      expect(result.actionItems[0].assignee).toBe("Alice")
      expect(result.actionItems[0].dueDate).toBe("2026-03-15")
    })

    it("rejects summary for nonexistent meeting (FK constraint)", () => {
      expect(() => storage.saveSummary(makeSummary({ meetingId: "no-such-meeting" }))).toThrow()
    })
  })

  describe("speakers", () => {
    it("saves and retrieves speakers", () => {
      storage.createMeeting(makeMeeting())
      const speakers: Speaker[] = [
        { id: "sp-1", label: "Speaker 1", meetingId: "m-1" },
        { id: "sp-2", label: "Speaker 2", meetingId: "m-1" },
      ]
      storage.saveSpeakers("m-1", speakers)
      const result = storage.getSpeakers("m-1")
      expect(result).toHaveLength(2)
      expect(result[0].label).toBe("Speaker 1")
      expect(result[1].label).toBe("Speaker 2")
    })

    it("returns empty array for meeting with no speakers", () => {
      storage.createMeeting(makeMeeting())
      expect(storage.getSpeakers("m-1")).toEqual([])
    })

    it("cascade delete includes speakers", () => {
      storage.createMeeting(makeMeeting())
      storage.saveSpeakers("m-1", [{ id: "sp-1", label: "Speaker 1", meetingId: "m-1" }])
      storage.deleteMeeting("m-1")
      expect(storage.getSpeakers("m-1")).toEqual([])
    })
  })

  describe("live notes", () => {
    it("saves and retrieves live notes", () => {
      storage.createMeeting(makeMeeting())
      const note: LiveNote = {
        id: "ln-1",
        meetingId: "m-1",
        sequenceNum: 0,
        keyPoints: ["Point A"],
        actionItems: [{ id: "a-1", description: "Do X", assignee: null, dueDate: null }],
        windowStartMs: 0,
        windowEndMs: 30000,
        createdAt: "2026-03-10T10:00:30Z",
      }
      storage.saveLiveNote(note)
      const result = storage.getLiveNotes("m-1")
      expect(result).toHaveLength(1)
      expect(result[0].keyPoints).toEqual(["Point A"])
      expect(result[0].actionItems).toHaveLength(1)
      expect(result[0].windowStartMs).toBe(0)
      expect(result[0].windowEndMs).toBe(30000)
    })

    it("returns live notes ordered by sequence_num", () => {
      storage.createMeeting(makeMeeting())
      storage.saveLiveNote({ id: "ln-2", meetingId: "m-1", sequenceNum: 1, keyPoints: ["B"], actionItems: [], windowStartMs: 30000, windowEndMs: 60000, createdAt: "2026-03-10T10:01:00Z" })
      storage.saveLiveNote({ id: "ln-1", meetingId: "m-1", sequenceNum: 0, keyPoints: ["A"], actionItems: [], windowStartMs: 0, windowEndMs: 30000, createdAt: "2026-03-10T10:00:30Z" })
      const result = storage.getLiveNotes("m-1")
      expect(result[0].sequenceNum).toBe(0)
      expect(result[1].sequenceNum).toBe(1)
    })

    it("returns empty array for meeting with no live notes", () => {
      storage.createMeeting(makeMeeting())
      expect(storage.getLiveNotes("m-1")).toEqual([])
    })

    it("cascade delete includes live notes", () => {
      storage.createMeeting(makeMeeting())
      storage.saveLiveNote({ id: "ln-1", meetingId: "m-1", sequenceNum: 0, keyPoints: [], actionItems: [], windowStartMs: 0, windowEndMs: 30000, createdAt: "2026-03-10T10:00:30Z" })
      storage.deleteMeeting("m-1")
      expect(storage.getLiveNotes("m-1")).toEqual([])
    })
  })

  describe("transcript chunks with speaker_id", () => {
    it("persists speakerId on transcript chunks", () => {
      storage.createMeeting(makeMeeting())
      const transcript = makeTranscript({
        chunks: [
          { id: "tc-1", meetingId: "m-1", sequence: 0, text: "Hello", startTimeMs: 0, endTimeMs: 5000, confidence: 0.95, speakerId: "sp-1", createdAt: "2026-03-10T10:00:05Z" },
        ],
      })
      storage.saveTranscript(transcript)
      const result = storage.getTranscript("m-1")!
      expect(result.chunks[0].speakerId).toBe("sp-1")
    })

    it("handles chunks without speakerId", () => {
      storage.createMeeting(makeMeeting())
      storage.saveTranscript(makeTranscript())
      const result = storage.getTranscript("m-1")!
      expect(result.chunks[0].speakerId).toBeUndefined()
    })
  })
})
