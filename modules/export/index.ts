import type { ExportService } from "../../shared/services/export-service.js"
import type { ExportFormat, ExportResult } from "../../shared/types/export.js"
import type { Meeting } from "../../shared/types/meeting.js"
import type { Transcript } from "../../shared/types/transcript.js"
import type { MeetingSummary } from "../../shared/types/summary.js"

export function createExportService(): ExportService {
  return {
    export(meeting: Meeting, transcript: Transcript, summary: MeetingSummary, format: ExportFormat): ExportResult {
      const content = format === "markdown"
        ? toMarkdown(meeting, transcript, summary)
        : toJson(meeting, transcript, summary)

      const ext = format === "markdown" ? "md" : "json"
      const slug = meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")

      return {
        meetingId: meeting.id,
        format,
        content,
        filename: `${slug}-${meeting.id.slice(0, 8)}.${ext}`,
        createdAt: new Date().toISOString(),
      }
    },
  }
}

function toMarkdown(meeting: Meeting, transcript: Transcript, summary: MeetingSummary): string {
  const lines: string[] = []

  lines.push(`# ${summary.title}`)
  lines.push("")
  lines.push(`**Meeting:** ${meeting.title}`)
  lines.push(`**Date:** ${meeting.startedAt}`)
  lines.push(`**Status:** ${meeting.status}`)
  lines.push("")

  lines.push("## Overview")
  lines.push(summary.overview)
  lines.push("")

  if (summary.keyPoints.length > 0) {
    lines.push("## Key Points")
    for (const point of summary.keyPoints) {
      lines.push(`- ${point}`)
    }
    lines.push("")
  }

  if (summary.actionItems.length > 0) {
    lines.push("## Action Items")
    for (const item of summary.actionItems) {
      const assignee = item.assignee ? ` (${item.assignee})` : ""
      lines.push(`- [ ] ${item.description}${assignee}`)
    }
    lines.push("")
  }

  if (summary.decisions.length > 0) {
    lines.push("## Decisions")
    for (const decision of summary.decisions) {
      lines.push(`- ${decision.description}`)
    }
    lines.push("")
  }

  lines.push("## Transcript")
  for (const chunk of transcript.chunks) {
    const ts = formatTime(chunk.startTimeMs)
    if (chunk.speakerId) {
      lines.push(`**[${ts}] ${chunk.speakerId}:** ${chunk.text}`)
    } else {
      lines.push(`**[${ts}]** ${chunk.text}`)
    }
  }
  lines.push("")

  return lines.join("\n")
}

function toJson(meeting: Meeting, transcript: Transcript, summary: MeetingSummary): string {
  return JSON.stringify({ meeting, transcript, summary }, null, 2)
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
