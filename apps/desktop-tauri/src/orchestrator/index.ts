import { v4 as uuid } from "uuid"
import type { CaptureService } from "@shared/services/capture-service.js"
import type { TranscriptionService } from "@shared/services/transcription-service.js"
import type { IntelligenceService } from "@shared/services/intelligence-service.js"
import type { StorageService } from "@shared/services/storage-service.js"
import type { ExportService } from "@shared/services/export-service.js"
import type { DiarizationService } from "@shared/services/diarization-service.js"
import type { AudioChunk } from "@shared/types/audio.js"
import type { TranscriptChunk } from "@shared/types/transcript.js"
import type { Meeting } from "@shared/types/meeting.js"
import type { ExportFormat, ExportResult } from "@shared/types/export.js"
import type { LiveNote } from "@shared/types/summary.js"

export interface OrchestratorDeps {
  capture: CaptureService
  transcription?: TranscriptionService
  intelligence: IntelligenceService
  storage: StorageService
  export: ExportService
  diarization?: DiarizationService
  onBeforeAssemble?: () => Promise<void>
  onTranscriptUpdate?: (chunk: TranscriptChunk) => void
  onLiveNote?: (note: LiveNote) => void
}

export interface Orchestrator {
  startMeeting(title: string): Meeting
  stopMeeting(meetingId: string): Promise<void>
  exportMeeting(meetingId: string, format: ExportFormat): ExportResult
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const chunkBuffers = new Map<string, TranscriptChunk[]>()
  const pendingTranscriptions = new Map<string, Promise<void>[]>()
  const liveNoteCounters = new Map<string, number>()
  const lastLiveNotes = new Map<string, LiveNote | null>()

  const LIVE_NOTE_INTERVAL = 6

  return {
    startMeeting(title: string): Meeting {
      const meeting: Meeting = {
        id: uuid(),
        title,
        status: "recording",
        startedAt: new Date().toISOString(),
        endedAt: null,
        createdAt: new Date().toISOString(),
      }

      deps.storage.createMeeting(meeting)
      chunkBuffers.set(meeting.id, [])
      pendingTranscriptions.set(meeting.id, [])
      liveNoteCounters.set(meeting.id, 0)
      lastLiveNotes.set(meeting.id, null)

      deps.capture.start(meeting.id, (audioChunk: AudioChunk) => {
        if (!deps.transcription) return

        const pending = pendingTranscriptions.get(meeting.id)
        const promise = deps.transcription
          .transcribeChunk(audioChunk)
          .catch((err) => {
            console.error("[orchestrator] transcribeChunk failed:", err)
            return null
          })
          .then((transcriptChunk) => {
            if (!transcriptChunk) return
            chunkBuffers.get(meeting.id)?.push(transcriptChunk)
            deps.onTranscriptUpdate?.(transcriptChunk)

            const count = (liveNoteCounters.get(meeting.id) ?? 0) + 1
            liveNoteCounters.set(meeting.id, count)

            if (deps.intelligence.generateLiveNote && count % LIVE_NOTE_INTERVAL === 0) {
              const allChunks = chunkBuffers.get(meeting.id) ?? []
              const recentChunks = allChunks.slice(-LIVE_NOTE_INTERVAL)
              const previous = lastLiveNotes.get(meeting.id) ?? null

              deps.intelligence.generateLiveNote(meeting.id, recentChunks, previous)
                .then((note) => {
                  lastLiveNotes.set(meeting.id, note)
                  deps.storage.saveLiveNote(note)
                  deps.onLiveNote?.(note)
                })
                .catch((err) => {
                  console.error("[orchestrator] generateLiveNote failed:", err)
                })
            }
          })
        pending?.push(promise)
      })

      return meeting
    },

    async stopMeeting(meetingId: string): Promise<void> {
      deps.capture.stop()

      const pending = pendingTranscriptions.get(meetingId) ?? []
      await Promise.all(pending)

      const meeting = deps.storage.getMeeting(meetingId)
      if (!meeting) throw new Error(`Meeting ${meetingId} not found`)

      meeting.status = "processing"
      meeting.endedAt = new Date().toISOString()
      deps.storage.updateMeeting(meeting)

      if (deps.onBeforeAssemble) {
        await deps.onBeforeAssemble()
      }

      if (deps.transcription) {
        let chunks = chunkBuffers.get(meetingId) ?? []

        if (deps.diarization) {
          const result = await deps.diarization.assignSpeakers(meetingId, chunks)
          chunks = result.chunks
          deps.storage.saveSpeakers(meetingId, result.speakers)
        }

        const transcript = deps.transcription.assembleTranscript(meetingId, chunks)

        if (deps.diarization) {
          const speakerMap = new Map(
            (deps.storage.getSpeakers(meetingId)).map((s) => [s.id, s.label]),
          )
          const labeledParts = transcript.chunks.map((chunk) => {
            const label = chunk.speakerId ? speakerMap.get(chunk.speakerId) : undefined
            return label ? `[${label}]: ${chunk.text}` : chunk.text
          })
          transcript.fullText = labeledParts.join(" ")
        }

        deps.storage.saveTranscript(transcript)

        console.log("[orchestrator] Generating AI summary for", transcript.fullText.length, "chars...")
        try {
          const summary = await deps.intelligence.generateSummary(transcript)
          deps.storage.saveSummary(summary)
          console.log("[orchestrator] AI summary generated:", summary.title)
        } catch (err) {
          console.error("[orchestrator] AI summary failed:", err)
          // Fall back: save a minimal summary so export still works
          const { v4: uuid } = await import("uuid")
          deps.storage.saveSummary({
            id: uuid(),
            meetingId,
            title: "Meeting Notes",
            overview: transcript.fullText.substring(0, 200),
            actionItems: [],
            decisions: [],
            keyPoints: [],
            createdAt: new Date().toISOString(),
          })
        }
      }

      meeting.status = "completed"
      deps.storage.updateMeeting(meeting)

      chunkBuffers.delete(meetingId)
      pendingTranscriptions.delete(meetingId)
      liveNoteCounters.delete(meetingId)
      lastLiveNotes.delete(meetingId)
    },

    exportMeeting(meetingId: string, format: ExportFormat): ExportResult {
      const meeting = deps.storage.getMeeting(meetingId)
      if (!meeting) throw new Error(`Meeting ${meetingId} not found`)

      const transcript = deps.storage.getTranscript(meetingId)
      if (!transcript) throw new Error(`Transcript for meeting ${meetingId} not found`)

      const summary = deps.storage.getSummary(meetingId)
      if (!summary) throw new Error(`Summary for meeting ${meetingId} not found`)

      return deps.export.export(meeting, transcript, summary, format)
    },
  }
}
