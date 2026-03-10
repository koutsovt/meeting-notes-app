import type { ExportFormat, ExportResult } from "../types/export.js"
import type { Meeting } from "../types/meeting.js"
import type { Transcript } from "../types/transcript.js"
import type { MeetingSummary } from "../types/summary.js"

export interface ExportService {
  export(
    meeting: Meeting,
    transcript: Transcript,
    summary: MeetingSummary,
    format: ExportFormat
  ): ExportResult
}
