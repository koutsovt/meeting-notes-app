export type ExportFormat = "markdown" | "json"

export interface ExportResult {
  meetingId: string
  format: ExportFormat
  content: string
  filename: string
  createdAt: string
}
