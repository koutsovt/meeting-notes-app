export type MeetingStatus = "recording" | "processing" | "completed" | "failed"

export interface Meeting {
  id: string
  title: string
  status: MeetingStatus
  startedAt: string
  endedAt: string | null
  createdAt: string
}
