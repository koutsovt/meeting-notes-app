import { useState, useRef, useCallback, useEffect } from "react"
import { createApp, requestMicPermission, isTauri, loadWhisperModel, getApiKey, setApiKey } from "./create-app.js"
import type { App as AppInstance } from "./create-app.js"
import type { Meeting } from "@shared/types/meeting.js"
import type { ExportResult } from "@shared/types/export.js"
import type { TranscriptChunk } from "@shared/types/transcript.js"
import type { LiveNote } from "@shared/types/summary.js"
import "./App.css"

type AppState = "requesting" | "denied" | "ready"

export function App() {
  const [appState, setAppState] = useState<AppState>("requesting")
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const appRef = useRef<AppInstance | null>(null)

  useEffect(() => {
    async function init() {
      try {
        const stream = await requestMicPermission()
        const app = await createApp(stream)
        appRef.current = app
        setAppState("ready")
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error("App init failed:", msg)
        setPermissionError(msg)
        setAppState("denied")
      }
    }
    init()
  }, [])

  if (appState === "requesting") {
    return (
      <div className="app">
        <header className="title-bar">
          <h1 className="app-name">Synolo</h1>
          <span className="version">v0.1.0</span>
        </header>
        <div className="card">
          <div className="card-body">
            <div className="record-section">
              <div className="record-status">Initializing...</div>
              <span className="badge badge-processing">Requesting microphone</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (appState === "denied") {
    return (
      <div className="app">
        <header className="title-bar">
          <h1 className="app-name">Synolo</h1>
          <span className="version">v0.1.0</span>
        </header>
        <div className="error-banner">
          {permissionError}
        </div>
      </div>
    )
  }

  return <MeetingUI app={appRef.current!} />
}

function LiveTranscript({ chunks, interim, isRecording }: { chunks: TranscriptChunk[]; interim: string; isRecording: boolean }) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [chunks, interim])

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Live Transcript</span>
        {isRecording && <span className="badge badge-recording">Live</span>}
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <div className="transcript-scroll">
          {chunks.length === 0 && !interim ? (
            <span className="dim">Listening...</span>
          ) : (
            <>
              {chunks.map((c) => <p key={c.id} style={{ margin: 0, lineHeight: 1.7 }}>{c.text}</p>)}
              {interim && <span className="interim">{interim}</span>}
            </>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  )
}

function LiveNotes({ notes }: { notes: LiveNote[] }) {
  const latest = notes[notes.length - 1]

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Live Notes</span>
        <span className="badge badge-active">AI</span>
      </div>
      <div className="card-body">
        <ul className="note-list">
          {latest.keyPoints.map((kp, i) => (
            <li key={i}>{kp}</li>
          ))}
        </ul>
        {latest.actionItems.length > 0 && (
          <>
            <div className="card-title" style={{ marginTop: 12, marginBottom: 8 }}>Action Items</div>
            <ul className="note-list">
              {latest.actionItems.map((a) => (
                <li key={a.id}>
                  {a.description}
                  {a.assignee ? ` (${a.assignee})` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function ExportPreview({ result, onDownload }: { result: ExportResult; onDownload: () => void }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Export: {result.filename}</span>
        <button className="btn btn-sm" onClick={onDownload}>Download</button>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        <pre className="export-content">{result.content}</pre>
      </div>
    </div>
  )
}

function MeetingUI({ app }: { app: AppInstance }) {
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [liveChunks, setLiveChunks] = useState<TranscriptChunk[]>([])
  const [liveNotes, setLiveNotes] = useState<LiveNote[]>([])
  const [interimText, setInterimText] = useState("")
  const [currentModel, setCurrentModel] = useState("small.en")
  const [modelLoading, setModelLoading] = useState(false)
  const [apiKey, setApiKeyState] = useState("")
  const hasAI = apiKey.length > 0

  useEffect(() => {
    getApiKey().then(setApiKeyState)
  }, [])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isRecording = activeMeeting !== null

  const refreshMeetings = useCallback(() => {
    setMeetings(app.storage.listMeetings())
  }, [app])

  useEffect(() => {
    app.onTranscriptUpdate = (chunk) => {
      setInterimText("")
      setLiveChunks((prev) => [...prev, chunk])
    }
    app.onLiveNote = (note) => setLiveNotes((prev) => [...prev, note])
    app.onInterimText = (text) => setInterimText(text)
    return () => {
      app.onTranscriptUpdate = null
      app.onLiveNote = null
      app.onInterimText = null
    }
  }, [app])

  useEffect(() => {
    refreshMeetings()
  }, [refreshMeetings])

  useEffect(() => {
    if (activeMeeting) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [activeMeeting])

  const handleModelChange = useCallback(async (model: string) => {
    if (!isTauri() || isRecording || modelLoading) return
    try {
      setModelLoading(true)
      setError(null)
      await loadWhisperModel(model)
      setCurrentModel(model)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setModelLoading(false)
    }
  }, [isRecording, modelLoading])

  const handleStart = useCallback(() => {
    try {
      setError(null)
      setExportResult(null)
      setElapsed(0)
      setLiveChunks([])
      setLiveNotes([])
      setInterimText("")
      const title = `Meeting ${new Date().toLocaleString()}`
      const meeting = app.orchestrator.startMeeting(title)
      setActiveMeeting(meeting)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [app])

  const handleStop = useCallback(async () => {
    if (!activeMeeting) return
    try {
      setError(null)
      setProcessing(true)
      await app.orchestrator.stopMeeting(activeMeeting.id)
      setActiveMeeting(null)
      refreshMeetings()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProcessing(false)
    }
  }, [app, activeMeeting, refreshMeetings])

  const handleExport = useCallback(
    (meetingId: string, format: "markdown" | "json") => {
      try {
        setError(null)
        const result = app.orchestrator.exportMeeting(meetingId, format)
        setExportResult(result)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [app]
  )

  const handleDelete = useCallback(
    (meetingId: string) => {
      app.storage.deleteMeeting(meetingId)
      refreshMeetings()
      setExportResult(null)
    },
    [app, refreshMeetings]
  )

  const handleDownload = useCallback(async () => {
    if (!exportResult) return
    const blob = new Blob([exportResult.content], { type: "text/plain" })
    const file = new File([blob], exportResult.filename, { type: "text/plain" })

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: exportResult.filename })
      } catch {
        // User cancelled share
      }
    } else {
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }
  }, [exportResult])

  const handleSaveApiKey = useCallback(async () => {
    const input = document.getElementById("api-key-input") as HTMLInputElement
    const val = input?.value?.trim()
    if (val) {
      await setApiKey(val)
      setApiKeyState(val)
      setError("API key saved — restart app to activate AI summaries")
    }
  }, [])

  const handleClearApiKey = useCallback(async () => {
    await setApiKey("")
    setApiKeyState("")
    setTimeout(() => window.location.reload(), 100)
  }, [])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  return (
    <div className="app">
      <header className="title-bar">
        <h1 className="app-name">Synolo</h1>
        <span className="version">v0.1.0</span>
      </header>

      {/* ── Record section ──────────────── */}
      <div className="record-section">
        <div className="record-timer">{formatTime(elapsed)}</div>
        <button
          className={`record-btn ${isRecording ? "record-btn-stop" : "record-btn-start"}`}
          onClick={isRecording ? handleStop : handleStart}
          disabled={processing}
        >
          {isRecording ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8" /></svg>
          )}
        </button>
        <div className="record-status">
          {processing ? "Processing..." : isRecording ? "Recording" : "Ready"}
        </div>
      </div>

      {/* ── Settings card ───────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Settings</span>
          <span className={`badge ${hasAI ? "badge-active" : "badge-idle"}`}>
            {hasAI ? "AI On" : "AI Off"}
          </span>
        </div>
        <div className="card-body">
          <div className="row">
            <span className="row-label">Microphone</span>
            <span className="badge badge-recording">Granted</span>
          </div>

          {isTauri() && (
            <div className="row">
              <span className="row-label">Model</span>
              <div className="row-value">
                <select
                  className="select"
                  value={currentModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={isRecording || modelLoading}
                >
                  <option value="tiny.en">tiny.en</option>
                  <option value="base.en">base.en</option>
                  <option value="small.en">small.en</option>
                </select>
                {modelLoading && <span className="badge badge-processing">Loading</span>}
              </div>
            </div>
          )}

          <div className="row">
            <span className="row-label">AI Summary</span>
            <div className="row-value">
              {hasAI ? (
                <>
                  <span className="badge badge-active">Active</span>
                  <button className="btn btn-icon" onClick={handleClearApiKey}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </>
              ) : (
                <>
                  <input className="input" id="api-key-input" type="password" placeholder="API key" style={{ width: 120 }} />
                  <button className="btn btn-sm btn-primary" onClick={handleSaveApiKey}>Save</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Live transcript ──────────────── */}
      {(isRecording || liveChunks.length > 0) && (
        <LiveTranscript chunks={liveChunks} interim={interimText} isRecording={isRecording} />
      )}

      {/* ── Live notes ──────────────────── */}
      {liveNotes.length > 0 && <LiveNotes notes={liveNotes} />}

      {/* ── Error banner ────────────────── */}
      {error && <div className="error-banner">{error}</div>}

      {/* ── Meetings list ───────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Meetings</span>
          <span className="badge badge-idle">{meetings.length}</span>
        </div>
        <div className="card-body">
          {meetings.length === 0 ? (
            <p className="dim" style={{ fontSize: "0.85rem" }}>No meetings yet</p>
          ) : (
            meetings.map((m) => (
              <div key={m.id} className="meeting-card">
                <div>
                  <div className="meeting-title">{m.title}</div>
                  <div className="meeting-meta">
                    {m.status} · {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ""}
                  </div>
                </div>
                <div className="meeting-actions">
                  <button className="btn btn-sm" onClick={() => handleExport(m.id, "markdown")}>MD</button>
                  <button className="btn btn-sm" onClick={() => handleExport(m.id, "json")}>JSON</button>
                  <button className="btn btn-icon" onClick={() => handleDelete(m.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Export preview ───────────────── */}
      {exportResult && <ExportPreview result={exportResult} onDownload={handleDownload} />}

      {/* ── Footer ──────────────────────── */}
      <footer className="footer">
        <span className="dim">
          {isTauri() ? `whisper.cpp ${currentModel} · Metal GPU` : "Web Speech API (browser-native)"}
        </span>
      </footer>
    </div>
  )
}
