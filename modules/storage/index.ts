import Database from "better-sqlite3"
import type { StorageService } from "../../shared/services/storage-service.js"
import type { Meeting } from "../../shared/types/meeting.js"
import type { Transcript, TranscriptChunk, Speaker } from "../../shared/types/transcript.js"
import type { MeetingSummary, ActionItem, Decision, LiveNote } from "../../shared/types/summary.js"

export function createStorageService(dbPath: string = ":memory:"): StorageService {
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  initSchema(db)

  return {
    createMeeting(meeting: Meeting): void {
      db.prepare(`
        INSERT INTO meetings (id, title, status, started_at, ended_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(meeting.id, meeting.title, meeting.status, meeting.startedAt, meeting.endedAt, meeting.createdAt)
    },

    getMeeting(id: string): Meeting | null {
      const row = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as MeetingRow | undefined
      return row ? toMeeting(row) : null
    },

    updateMeeting(meeting: Meeting): void {
      db.prepare(`
        UPDATE meetings SET title = ?, status = ?, started_at = ?, ended_at = ?, created_at = ?
        WHERE id = ?
      `).run(meeting.title, meeting.status, meeting.startedAt, meeting.endedAt, meeting.createdAt, meeting.id)
    },

    deleteMeeting(id: string): void {
      const del = db.transaction(() => {
        db.prepare("DELETE FROM live_notes WHERE meeting_id = ?").run(id)
        db.prepare("DELETE FROM speakers WHERE meeting_id = ?").run(id)
        db.prepare("DELETE FROM transcript_chunks WHERE meeting_id = ?").run(id)
        db.prepare("DELETE FROM transcripts WHERE meeting_id = ?").run(id)
        db.prepare("DELETE FROM summaries WHERE meeting_id = ?").run(id)
        db.prepare("DELETE FROM meetings WHERE id = ?").run(id)
      })
      del()
    },

    listMeetings(): Meeting[] {
      const rows = db.prepare("SELECT * FROM meetings ORDER BY created_at DESC").all() as MeetingRow[]
      return rows.map(toMeeting)
    },

    saveTranscript(transcript: Transcript): void {
      const insertTranscript = db.prepare(`
        INSERT OR REPLACE INTO transcripts (id, meeting_id, full_text, created_at)
        VALUES (?, ?, ?, ?)
      `)
      const deleteOldChunks = db.prepare("DELETE FROM transcript_chunks WHERE meeting_id = ?")
      const insertChunk = db.prepare(`
        INSERT INTO transcript_chunks (id, meeting_id, sequence, text, start_time_ms, end_time_ms, confidence, speaker_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const saveAll = db.transaction(() => {
        insertTranscript.run(transcript.id, transcript.meetingId, transcript.fullText, transcript.createdAt)
        deleteOldChunks.run(transcript.meetingId)
        for (const chunk of transcript.chunks) {
          insertChunk.run(chunk.id, chunk.meetingId, chunk.sequence, chunk.text, chunk.startTimeMs, chunk.endTimeMs, chunk.confidence, chunk.speakerId ?? null, chunk.createdAt)
        }
      })
      saveAll()
    },

    getTranscript(meetingId: string): Transcript | null {
      const row = db.prepare("SELECT * FROM transcripts WHERE meeting_id = ?").get(meetingId) as TranscriptRow | undefined
      if (!row) return null

      const chunkRows = db.prepare("SELECT * FROM transcript_chunks WHERE meeting_id = ? ORDER BY sequence").all(meetingId) as TranscriptChunkRow[]
      return {
        id: row.id,
        meetingId: row.meeting_id,
        fullText: row.full_text,
        chunks: chunkRows.map(toTranscriptChunk),
        createdAt: row.created_at,
      }
    },

    saveSummary(summary: MeetingSummary): void {
      db.prepare(`
        INSERT OR REPLACE INTO summaries (id, meeting_id, title, overview, action_items, decisions, key_points, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        summary.id,
        summary.meetingId,
        summary.title,
        summary.overview,
        JSON.stringify(summary.actionItems),
        JSON.stringify(summary.decisions),
        JSON.stringify(summary.keyPoints),
        summary.createdAt
      )
    },

    getSummary(meetingId: string): MeetingSummary | null {
      const row = db.prepare("SELECT * FROM summaries WHERE meeting_id = ?").get(meetingId) as SummaryRow | undefined
      if (!row) return null
      return {
        id: row.id,
        meetingId: row.meeting_id,
        title: row.title,
        overview: row.overview,
        actionItems: JSON.parse(row.action_items) as ActionItem[],
        decisions: JSON.parse(row.decisions) as Decision[],
        keyPoints: JSON.parse(row.key_points) as string[],
        createdAt: row.created_at,
      }
    },

    saveSpeakers(meetingId: string, speakers: Speaker[]): void {
      const insert = db.prepare(`
        INSERT OR REPLACE INTO speakers (id, meeting_id, label, profile_id)
        VALUES (?, ?, ?, ?)
      `)
      const saveAll = db.transaction(() => {
        for (const speaker of speakers) {
          insert.run(speaker.id, meetingId, speaker.label, speaker.profileId ?? null)
        }
      })
      saveAll()
    },

    getSpeakers(meetingId: string): Speaker[] {
      const rows = db.prepare("SELECT * FROM speakers WHERE meeting_id = ? ORDER BY label").all(meetingId) as SpeakerRow[]
      return rows.map(toSpeaker)
    },

    saveLiveNote(note: LiveNote): void {
      db.prepare(`
        INSERT OR REPLACE INTO live_notes (id, meeting_id, sequence_num, key_points, action_items, window_start_ms, window_end_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        note.id,
        note.meetingId,
        note.sequenceNum,
        JSON.stringify(note.keyPoints),
        JSON.stringify(note.actionItems),
        note.windowStartMs,
        note.windowEndMs,
        note.createdAt,
      )
    },

    getLiveNotes(meetingId: string): LiveNote[] {
      const rows = db.prepare("SELECT * FROM live_notes WHERE meeting_id = ? ORDER BY sequence_num").all(meetingId) as LiveNoteRow[]
      return rows.map(toLiveNote)
    },

    close(): void {
      db.close()
    },
  }
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('recording', 'processing', 'completed', 'failed')),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id),
      full_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      sequence INTEGER NOT NULL,
      text TEXT NOT NULL,
      start_time_ms INTEGER NOT NULL,
      end_time_ms INTEGER NOT NULL,
      confidence REAL NOT NULL,
      speaker_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(meeting_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS speakers (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      label TEXT NOT NULL,
      profile_id TEXT,
      UNIQUE(meeting_id, label)
    );

    CREATE TABLE IF NOT EXISTS live_notes (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      sequence_num INTEGER NOT NULL,
      key_points TEXT NOT NULL,
      action_items TEXT NOT NULL,
      window_start_ms INTEGER NOT NULL,
      window_end_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(meeting_id, sequence_num)
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id),
      title TEXT NOT NULL,
      overview TEXT NOT NULL,
      action_items TEXT NOT NULL,
      decisions TEXT NOT NULL,
      key_points TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
}

interface MeetingRow {
  id: string; title: string; status: string; started_at: string; ended_at: string | null; created_at: string
}
interface TranscriptRow {
  id: string; meeting_id: string; full_text: string; created_at: string
}
interface TranscriptChunkRow {
  id: string; meeting_id: string; sequence: number; text: string; start_time_ms: number; end_time_ms: number; confidence: number; speaker_id: string | null; created_at: string
}
interface SummaryRow {
  id: string; meeting_id: string; title: string; overview: string; action_items: string; decisions: string; key_points: string; created_at: string
}
interface SpeakerRow {
  id: string; meeting_id: string; label: string; profile_id: string | null
}
interface LiveNoteRow {
  id: string; meeting_id: string; sequence_num: number; key_points: string; action_items: string; window_start_ms: number; window_end_ms: number; created_at: string
}

function toMeeting(row: MeetingRow): Meeting {
  return { id: row.id, title: row.title, status: row.status as Meeting["status"], startedAt: row.started_at, endedAt: row.ended_at, createdAt: row.created_at }
}

function toTranscriptChunk(row: TranscriptChunkRow): TranscriptChunk {
  const chunk: TranscriptChunk = { id: row.id, meetingId: row.meeting_id, sequence: row.sequence, text: row.text, startTimeMs: row.start_time_ms, endTimeMs: row.end_time_ms, confidence: row.confidence, createdAt: row.created_at }
  if (row.speaker_id) chunk.speakerId = row.speaker_id
  return chunk
}

function toSpeaker(row: SpeakerRow): Speaker {
  const speaker: Speaker = { id: row.id, label: row.label, meetingId: row.meeting_id }
  if (row.profile_id) speaker.profileId = row.profile_id
  return speaker
}

function toLiveNote(row: LiveNoteRow): LiveNote {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    sequenceNum: row.sequence_num,
    keyPoints: JSON.parse(row.key_points) as string[],
    actionItems: JSON.parse(row.action_items) as ActionItem[],
    windowStartMs: row.window_start_ms,
    windowEndMs: row.window_end_ms,
    createdAt: row.created_at,
  }
}
