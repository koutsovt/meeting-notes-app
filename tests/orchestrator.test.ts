import { describe, it, expect, vi, beforeEach } from "vitest"
import { createOrchestrator } from "../apps/desktop-tauri/src/orchestrator/index.js"
import { createStorageService } from "../modules/storage/index.js"
import { createCaptureService } from "../modules/capture/index.js"
import { createTranscriptionService } from "../modules/transcription/index.js"
import { createIntelligenceService, createKeywordLiveBackend } from "../modules/intelligence/index.js"
import { createExportService } from "../modules/export/index.js"
import { createDiarizationService } from "../modules/diarization/index.js"
import type { OrchestratorDeps } from "../apps/desktop-tauri/src/orchestrator/index.js"
import type { AudioChunk } from "../shared/types/audio.js"
import type { TranscriptChunk } from "../shared/types/transcript.js"
import type { LiveNote } from "../shared/types/summary.js"
import type { CaptureService } from "../shared/services/capture-service.js"
import type { IntelligenceService } from "../shared/services/intelligence-service.js"

function makeDeps(): OrchestratorDeps {
  return {
    capture: createCaptureService(),
    transcription: createTranscriptionService(),
    intelligence: createIntelligenceService(),
    storage: createStorageService(":memory:"),
    export: createExportService(),
  }
}

describe("Orchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("runs the full meeting flow: start → capture → stop → export", async () => {
    const orchestrator = createOrchestrator(makeDeps())

    const meeting = orchestrator.startMeeting("Integration Test Meeting")
    expect(meeting.status).toBe("recording")

    vi.advanceTimersByTime(15000)
    vi.useRealTimers()

    await orchestrator.stopMeeting(meeting.id)

    const result = orchestrator.exportMeeting(meeting.id, "markdown")
    expect(result.format).toBe("markdown")
    expect(result.content).toMatch(/^# .+/m)
    expect(result.filename).toMatch(/\.md$/)
  })

  it("exports as json", async () => {
    vi.useRealTimers()
    const orchestrator = createOrchestrator(makeDeps())

    const meeting = orchestrator.startMeeting("JSON Export Test")
    await orchestrator.stopMeeting(meeting.id)

    const result = orchestrator.exportMeeting(meeting.id, "json")
    const parsed = JSON.parse(result.content)
    expect(parsed.meeting.title).toBe("JSON Export Test")
    expect(parsed.meeting.status).toBe("completed")
  })

  it("throws on export of nonexistent meeting", () => {
    vi.useRealTimers()
    const orchestrator = createOrchestrator(makeDeps())
    expect(() => orchestrator.exportMeeting("nonexistent", "markdown")).toThrow("Meeting nonexistent not found")
  })

  it("throws on stopMeeting with nonexistent id", async () => {
    vi.useRealTimers()
    const deps = makeDeps()
    // Use a capture that won't throw on stop
    const mockCapture: CaptureService = {
      start: () => {},
      stop: () => {},
      isCapturing: () => false,
    }
    const orchestrator = createOrchestrator({ ...deps, capture: mockCapture })

    await expect(orchestrator.stopMeeting("nonexistent")).rejects.toThrow("Meeting nonexistent not found")
  })

  it("degrades gracefully with fallback summary when intelligence fails", async () => {
    vi.useRealTimers()
    const deps = makeDeps()
    const failingIntelligence: IntelligenceService = {
      generateSummary: () => Promise.reject(new Error("LLM unavailable")),
    }
    const orchestrator = createOrchestrator({ ...deps, intelligence: failingIntelligence })

    const meeting = orchestrator.startMeeting("Failing Meeting")
    await orchestrator.stopMeeting(meeting.id)

    const saved = deps.storage.getMeeting(meeting.id)!
    expect(saved.status).toBe("completed")

    const summary = deps.storage.getSummary(meeting.id)!
    expect(summary.title).toBe("Meeting Notes")
    expect(summary.actionItems).toEqual([])
    expect(summary.decisions).toEqual([])
    expect(summary.keyPoints).toEqual([])
  })

  it("throws when starting a second meeting while capture is active", async () => {
    vi.useRealTimers()
    const orchestrator = createOrchestrator(makeDeps())

    orchestrator.startMeeting("First")
    expect(() => orchestrator.startMeeting("Second")).toThrow("Capture already in progress")
  })

  it("drains in-flight transcriptions before assembling transcript", async () => {
    vi.useRealTimers()
    const deps = makeDeps()

    // Controllable capture: fires callback immediately on start, then stops
    let capturedHandler: ((chunk: AudioChunk) => void) | null = null
    const manualCapture: CaptureService = {
      start(_meetingId, onChunk) { capturedHandler = onChunk },
      stop() {},
      isCapturing() { return true },
    }

    // Slow transcription — resolves after 50ms
    const originalTranscribe = deps.transcription.transcribeChunk.bind(deps.transcription)
    deps.transcription.transcribeChunk = async (chunk) => {
      await new Promise<void>((r) => setTimeout(r, 50))
      return originalTranscribe(chunk)
    }

    const orchestrator = createOrchestrator({ ...deps, capture: manualCapture })
    const meeting = orchestrator.startMeeting("Drain Test")

    // Fire a chunk manually
    capturedHandler!({
      id: "ac-manual",
      meetingId: meeting.id,
      sequence: 0,
      startTimeMs: 0,
      endTimeMs: 5000,
      source: "microphone",
      createdAt: new Date().toISOString(),
    })

    // stopMeeting must await the in-flight 50ms transcription
    await orchestrator.stopMeeting(meeting.id)

    const result = orchestrator.exportMeeting(meeting.id, "json")
    const parsed = JSON.parse(result.content)
    expect(parsed.transcript.chunks).toHaveLength(1)
  })

  it("fires onTranscriptUpdate callback per chunk", async () => {
    vi.useRealTimers()
    const deps = makeDeps()
    const updates: TranscriptChunk[] = []

    let capturedHandler: ((chunk: AudioChunk) => void) | null = null
    const manualCapture: CaptureService = {
      start(_meetingId, onChunk) { capturedHandler = onChunk },
      stop() {},
      isCapturing() { return true },
    }

    const orchestrator = createOrchestrator({
      ...deps,
      capture: manualCapture,
      onTranscriptUpdate: (chunk) => updates.push(chunk),
    })

    const meeting = orchestrator.startMeeting("Callback Test")

    capturedHandler!({
      id: "ac-1", meetingId: meeting.id, sequence: 0,
      startTimeMs: 0, endTimeMs: 5000, source: "microphone",
      createdAt: new Date().toISOString(),
    })
    capturedHandler!({
      id: "ac-2", meetingId: meeting.id, sequence: 1,
      startTimeMs: 5000, endTimeMs: 10000, source: "microphone",
      createdAt: new Date().toISOString(),
    })

    await orchestrator.stopMeeting(meeting.id)
    expect(updates).toHaveLength(2)
  })

  it("fires onLiveNote callback every 6 chunks", async () => {
    vi.useRealTimers()
    const deps = makeDeps()
    const liveNotes: LiveNote[] = []

    let capturedHandler: ((chunk: AudioChunk) => void) | null = null
    const manualCapture: CaptureService = {
      start(_meetingId, onChunk) { capturedHandler = onChunk },
      stop() {},
      isCapturing() { return true },
    }

    const intelligence = createIntelligenceService(undefined, createKeywordLiveBackend())

    const orchestrator = createOrchestrator({
      ...deps,
      capture: manualCapture,
      intelligence,
      onLiveNote: (note) => liveNotes.push(note),
    })

    const meeting = orchestrator.startMeeting("Live Note Test")

    // Fire 7 chunks — should trigger live note after chunk 6
    for (let i = 0; i < 7; i++) {
      capturedHandler!({
        id: `ac-${i}`, meetingId: meeting.id, sequence: i,
        startTimeMs: i * 5000, endTimeMs: (i + 1) * 5000, source: "microphone",
        createdAt: new Date().toISOString(),
      })
      // Wait for transcription promise to resolve
      await new Promise<void>((r) => setTimeout(r, 10))
    }

    await orchestrator.stopMeeting(meeting.id)
    expect(liveNotes.length).toBeGreaterThanOrEqual(1)
  })

  it("diarization runs on stop when service provided", async () => {
    vi.useRealTimers()
    const deps = makeDeps()

    let capturedHandler: ((chunk: AudioChunk) => void) | null = null
    const manualCapture: CaptureService = {
      start(_meetingId, onChunk) { capturedHandler = onChunk },
      stop() {},
      isCapturing() { return true },
    }

    const diarization = createDiarizationService()

    const orchestrator = createOrchestrator({
      ...deps,
      capture: manualCapture,
      diarization,
    })

    const meeting = orchestrator.startMeeting("Diarization Test")

    capturedHandler!({
      id: "ac-1", meetingId: meeting.id, sequence: 0,
      startTimeMs: 0, endTimeMs: 5000, source: "microphone",
      createdAt: new Date().toISOString(),
    })
    capturedHandler!({
      id: "ac-2", meetingId: meeting.id, sequence: 1,
      startTimeMs: 5000, endTimeMs: 10000, source: "microphone",
      createdAt: new Date().toISOString(),
    })

    await orchestrator.stopMeeting(meeting.id)

    const speakers = deps.storage.getSpeakers(meeting.id)
    expect(speakers).toHaveLength(2)

    const transcript = deps.storage.getTranscript(meeting.id)!
    expect(transcript.chunks[0].speakerId).toBeTruthy()
    expect(transcript.chunks[1].speakerId).toBeTruthy()
    expect(transcript.fullText).toContain("[Speaker")
  })

  it("backward compat: no callbacks/diarization → existing behavior unchanged", async () => {
    vi.useRealTimers()
    const orchestrator = createOrchestrator(makeDeps())

    const meeting = orchestrator.startMeeting("Compat Test")
    await orchestrator.stopMeeting(meeting.id)

    const result = orchestrator.exportMeeting(meeting.id, "json")
    const parsed = JSON.parse(result.content)
    expect(parsed.meeting.status).toBe("completed")
  })
})
