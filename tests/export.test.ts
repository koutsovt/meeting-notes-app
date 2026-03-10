import { describe, it, expect } from "vitest"
import { createExportService } from "../modules/export/index.js"
import type { Meeting } from "../shared/types/meeting.js"
import type { Transcript } from "../shared/types/transcript.js"
import type { MeetingSummary } from "../shared/types/summary.js"

const meeting: Meeting = {
  id: "m-1",
  title: "Sprint Planning",
  status: "completed",
  startedAt: "2026-03-10T10:00:00Z",
  endedAt: "2026-03-10T11:00:00Z",
  createdAt: "2026-03-10T10:00:00Z",
}

const transcript: Transcript = {
  id: "t-1",
  meetingId: "m-1",
  chunks: [
    { id: "tc-1", meetingId: "m-1", sequence: 0, text: "Let's plan the sprint.", startTimeMs: 0, endTimeMs: 5000, confidence: 0.9, createdAt: "2026-03-10T10:00:05Z" },
  ],
  fullText: "Let's plan the sprint.",
  createdAt: "2026-03-10T10:00:05Z",
}

const summary: MeetingSummary = {
  id: "s-1",
  meetingId: "m-1",
  title: "Sprint Planning Summary",
  overview: "Discussed sprint priorities.",
  actionItems: [{ id: "a-1", description: "Create tickets", assignee: "Alice", dueDate: null }],
  decisions: [{ id: "d-1", description: "Use React", madeBy: "Team" }],
  keyPoints: ["Sprint starts Monday"],
  createdAt: "2026-03-10T11:00:00Z",
}

describe("ExportService", () => {
  it("exports as markdown", () => {
    const service = createExportService()
    const result = service.export(meeting, transcript, summary, "markdown")

    expect(result.format).toBe("markdown")
    expect(result.filename).toMatch(/\.md$/)
    expect(result.content).toContain("# Sprint Planning Summary")
    expect(result.content).toContain("## Action Items")
    expect(result.content).toContain("Create tickets")
    expect(result.content).toContain("## Transcript")
    expect(result.content).toContain("[00:00]")
  })

  it("exports as json", () => {
    const service = createExportService()
    const result = service.export(meeting, transcript, summary, "json")

    expect(result.format).toBe("json")
    expect(result.filename).toMatch(/\.json$/)
    const parsed = JSON.parse(result.content)
    expect(parsed.meeting.id).toBe("m-1")
    expect(parsed.transcript.fullText).toBe("Let's plan the sprint.")
    expect(parsed.summary.actionItems).toHaveLength(1)
  })

  it("sets meetingId and createdAt on ExportResult", () => {
    const service = createExportService()
    const result = service.export(meeting, transcript, summary, "markdown")

    expect(result.meetingId).toBe("m-1")
    expect(result.createdAt).toBeTruthy()
    expect(new Date(result.createdAt).toISOString()).toBe(result.createdAt)
  })

  it("handles unicode characters in title for filename", () => {
    const service = createExportService()
    const unicodeMeeting: Meeting = { ...meeting, title: "Reunión de equipo 日本語" }
    const result = service.export(unicodeMeeting, transcript, summary, "markdown")

    expect(result.filename).toMatch(/\.md$/)
    expect(result.filename).not.toMatch(/[^\x20-\x7E.]/)
  })

  it("renders markdown without optional sections when empty", () => {
    const service = createExportService()
    const emptySummary: MeetingSummary = {
      ...summary,
      actionItems: [],
      decisions: [],
      keyPoints: [],
    }
    const result = service.export(meeting, transcript, emptySummary, "markdown")

    expect(result.content).not.toContain("## Action Items")
    expect(result.content).not.toContain("## Decisions")
    expect(result.content).not.toContain("## Key Points")
    expect(result.content).toContain("## Overview")
    expect(result.content).toContain("## Transcript")
  })

  it("renders markdown with empty transcript", () => {
    const service = createExportService()
    const emptyTranscript: Transcript = {
      id: "t-empty",
      meetingId: "m-1",
      chunks: [],
      fullText: "",
      createdAt: "2026-03-10T10:00:00Z",
    }
    const result = service.export(meeting, emptyTranscript, summary, "markdown")

    expect(result.content).toContain("## Transcript")
    expect(result.content).not.toContain("[00:00]")
  })

  it("renders speaker labels in transcript when speakerId is set", () => {
    const service = createExportService()
    const diarizedTranscript: Transcript = {
      id: "t-1",
      meetingId: "m-1",
      chunks: [
        { id: "tc-1", meetingId: "m-1", sequence: 0, text: "Let's plan the sprint.", startTimeMs: 0, endTimeMs: 5000, confidence: 0.9, speakerId: "Speaker 1", createdAt: "2026-03-10T10:00:05Z" },
        { id: "tc-2", meetingId: "m-1", sequence: 1, text: "Sounds good.", startTimeMs: 5000, endTimeMs: 10000, confidence: 0.9, createdAt: "2026-03-10T10:00:10Z" },
      ],
      fullText: "[Speaker 1]: Let's plan the sprint. Sounds good.",
      createdAt: "2026-03-10T10:00:10Z",
    }
    const result = service.export(meeting, diarizedTranscript, summary, "markdown")

    expect(result.content).toContain("**[00:00] Speaker 1:** Let's plan the sprint.")
    expect(result.content).toContain("**[00:05]** Sounds good.")
  })
})
