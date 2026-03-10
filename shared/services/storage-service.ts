import type { Meeting } from "../types/meeting.js"
import type { Transcript } from "../types/transcript.js"
import type { Speaker } from "../types/transcript.js"
import type { MeetingSummary } from "../types/summary.js"
import type { LiveNote } from "../types/summary.js"

export interface StorageService {
  createMeeting(meeting: Meeting): void
  getMeeting(id: string): Meeting | null
  updateMeeting(meeting: Meeting): void
  deleteMeeting(id: string): void
  listMeetings(): Meeting[]

  saveTranscript(transcript: Transcript): void
  getTranscript(meetingId: string): Transcript | null

  saveSummary(summary: MeetingSummary): void
  getSummary(meetingId: string): MeetingSummary | null

  saveSpeakers(meetingId: string, speakers: Speaker[]): void
  getSpeakers(meetingId: string): Speaker[]

  saveLiveNote(note: LiveNote): void
  getLiveNotes(meetingId: string): LiveNote[]

  close(): void
}
