import type { StorageService } from "@shared/services/storage-service.js"
import type { Meeting } from "@shared/types/meeting.js"
import type { Transcript, Speaker } from "@shared/types/transcript.js"
import type { MeetingSummary, LiveNote } from "@shared/types/summary.js"

/**
 * In-memory StorageService for browser context.
 * Replaces SQLite (Node-only) for the web/Tauri frontend.
 */
export function createMemoryStorageService(): StorageService {
  const meetings = new Map<string, Meeting>()
  const transcripts = new Map<string, Transcript>()
  const summaries = new Map<string, MeetingSummary>()
  const speakers = new Map<string, Speaker[]>()
  const liveNotes = new Map<string, LiveNote[]>()

  return {
    createMeeting(meeting: Meeting): void {
      if (meetings.has(meeting.id)) throw new Error(`Meeting ${meeting.id} already exists`)
      meetings.set(meeting.id, { ...meeting })
    },

    getMeeting(id: string): Meeting | null {
      const m = meetings.get(id)
      return m ? { ...m } : null
    },

    updateMeeting(meeting: Meeting): void {
      meetings.set(meeting.id, { ...meeting })
    },

    deleteMeeting(id: string): void {
      meetings.delete(id)
      transcripts.delete(id)
      summaries.delete(id)
      speakers.delete(id)
      liveNotes.delete(id)
    },

    listMeetings(): Meeting[] {
      return [...meetings.values()]
        .map((m) => ({ ...m }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    saveTranscript(transcript: Transcript): void {
      transcripts.set(transcript.meetingId, {
        ...transcript,
        chunks: transcript.chunks.map((c) => ({ ...c })),
      })
    },

    getTranscript(meetingId: string): Transcript | null {
      const t = transcripts.get(meetingId)
      return t ? { ...t, chunks: t.chunks.map((c) => ({ ...c })) } : null
    },

    saveSummary(summary: MeetingSummary): void {
      summaries.set(summary.meetingId, {
        ...summary,
        actionItems: summary.actionItems.map((a) => ({ ...a })),
        decisions: summary.decisions.map((d) => ({ ...d })),
        keyPoints: [...summary.keyPoints],
      })
    },

    getSummary(meetingId: string): MeetingSummary | null {
      const s = summaries.get(meetingId)
      return s
        ? {
            ...s,
            actionItems: s.actionItems.map((a) => ({ ...a })),
            decisions: s.decisions.map((d) => ({ ...d })),
            keyPoints: [...s.keyPoints],
          }
        : null
    },

    saveSpeakers(meetingId: string, spkrs: Speaker[]): void {
      speakers.set(meetingId, spkrs.map((s) => ({ ...s })))
    },

    getSpeakers(meetingId: string): Speaker[] {
      const s = speakers.get(meetingId)
      return s ? s.map((sp) => ({ ...sp })) : []
    },

    saveLiveNote(note: LiveNote): void {
      const arr = liveNotes.get(note.meetingId) ?? []
      arr.push({ ...note, keyPoints: [...note.keyPoints], actionItems: note.actionItems.map((a) => ({ ...a })) })
      liveNotes.set(note.meetingId, arr)
    },

    getLiveNotes(meetingId: string): LiveNote[] {
      const arr = liveNotes.get(meetingId)
      return arr ? arr.map((n) => ({ ...n, keyPoints: [...n.keyPoints], actionItems: n.actionItems.map((a) => ({ ...a })) })) : []
    },

    close(): void {},
  }
}
