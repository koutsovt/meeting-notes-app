export interface ActionItem {
  id: string
  description: string
  assignee: string | null
  dueDate: string | null
}

export interface Decision {
  id: string
  description: string
  madeBy: string | null
}

export interface MeetingSummary {
  id: string
  meetingId: string
  title: string
  overview: string
  actionItems: ActionItem[]
  decisions: Decision[]
  keyPoints: string[]
  createdAt: string
}

export interface LiveNote {
  id: string
  meetingId: string
  sequenceNum: number
  keyPoints: string[]
  actionItems: ActionItem[]
  windowStartMs: number
  windowEndMs: number
  createdAt: string
}
