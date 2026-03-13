import { useState, useRef, useCallback, useEffect } from "react"
import { createApp, requestMicPermission, isTauri, loadWhisperModel } from "./create-app.js"
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
          <h1 className="app-name">meeting notes</h1>
          <span className="version">v0.1.0</span>
        </header>
        <div className="panel">
          <div className="row">
            <span className="label">Microphone</span>
            <span className="badge badge-processing">Requesting...</span>
          </div>
        </div>
      </div>
    )
  }

  if (appState === "denied") {
    return (
      <div className="app">
        <header className="title-bar">
          <h1 className="app-name">meeting notes</h1>
          <span className="version">v0.1.0</span>
        </header>
        <div className="panel">
          <div className="row">
            <span className="label">{isTauri() ? "Setup" : "Microphone"}</span>
            <span className="badge badge-denied">Error</span>
          </div>
        </div>
        <p className="error">
          {permissionError}
        </p>
      </div>
    )
  }

  return <MeetingUI app={appRef.current!} />
}

function LiveTranscript({ chunks, interim }: { chunks: TranscriptChunk[]; interim: string }) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [chunks, interim])

  return (
    <div className="panel">
      <div className="section-header">Live Transcript</div>
      <div className="transcript-scroll">
        {chunks.length === 0 && !interim ? (
          <span className="dim">Listening...</span>
        ) : (
          <>
            {chunks.map((c) => <pre key={c.id} style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{c.text}</pre>)}
            {interim && <span className="interim">{interim}</span>}
          </>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function LiveNotes({ notes }: { notes: LiveNote[] }) {
  const latest = notes[notes.length - 1]

  return (
    <div className="panel">
      <div className="section-header">Live Notes</div>
      <ul className="note-list">
        {latest.keyPoints.map((kp, i) => (
          <li key={i}>{kp}</li>
        ))}
      </ul>
      {latest.actionItems.length > 0 && (
        <>
          <div className="section-header">Action Items</div>
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
  )
}

function MeetingRow({
  meeting,
  onExport,
  onDelete,
}: {
  meeting: Meeting
  onExport: (id: string, format: "markdown" | "json") => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="row">
      <span className="label">{meeting.title}</span>
      <div className="row-right row-actions">
        <span className="badge badge-done">{meeting.status}</span>
        <button className="btn btn-sm" onClick={() => onExport(meeting.id, "markdown")}>MD</button>
        <button className="btn btn-sm" onClick={() => onExport(meeting.id, "json")}>JSON</button>
        <button className="btn btn-sm btn-delete" onClick={() => onDelete(meeting.id)}>×</button>
      </div>
    </div>
  )
}

function ExportPreview({ result, onDownload }: { result: ExportResult; onDownload: () => void }) {
  return (
    <div className="panel">
      <div className="section-header-row">
        <span className="section-header">Export: {result.filename}</span>
        <button className="btn btn-sm" onClick={onDownload}>Download</button>
      </div>
      <pre className="export-content">{result.content}</pre>
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isRecording = activeMeeting !== null

  const refreshMeetings = useCallback(() => {
    setMeetings(app.storage.listMeetings())
  }, [app])

  // Wire live callbacks
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

  // Load meetings on mount
  useEffect(() => {
    refreshMeetings()
  }, [refreshMeetings])

  // Timer — no reset here, moved to handleStart
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

  const handleDownload = useCallback(() => {
    if (!exportResult) return
    const blob = new Blob([exportResult.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = exportResult.filename
    a.click()
    URL.revokeObjectURL(url)
  }, [exportResult])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }

  return (
    <div className="app">
      <header className="title-bar">
        <h1 className="app-name">meeting notes</h1>
        <span className="version">v0.1.0</span>
      </header>

      <div className="panel">
        <div className="row">
          <span className="label">Meeting</span>
          <div className="row-right">
            {!isRecording ? (
              <button className="btn btn-action" onClick={handleStart} disabled={processing}>
                Start
              </button>
            ) : (
              <button className="btn btn-danger" onClick={handleStop} disabled={processing}>
                {processing ? "Processing..." : "Stop"}
              </button>
            )}
          </div>
        </div>

        <div className="row">
          <span className="label">Microphone</span>
          <div className="row-right">
            <span className="badge badge-granted">Granted</span>
          </div>
        </div>

        <div className="row">
          <span className="label">Model</span>
          <div className="row-right">
            {isTauri() ? (
              <select
                value={currentModel}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={isRecording || modelLoading}
                className="model-select"
              >
                <option value="tiny.en">tiny.en (75 MB)</option>
                <option value="base.en">base.en (142 MB)</option>
                <option value="small.en">small.en (466 MB)</option>
              </select>
            ) : (
              <span className="mono">Web Speech API</span>
            )}
            {modelLoading && <span className="badge badge-processing">Loading...</span>}
          </div>
        </div>

        <div className="row">
          <span className="label">Status</span>
          <div className="row-right">
            {isRecording ? (
              <span className="badge badge-recording">Recording</span>
            ) : processing ? (
              <span className="badge badge-processing">Processing</span>
            ) : (
              <span className="badge badge-idle">Idle</span>
            )}
          </div>
        </div>

        <div className="row">
          <span className="label">Duration</span>
          <div className="row-right">
            <span className="mono">{formatTime(elapsed)}</span>
          </div>
        </div>
      </div>

      {(isRecording || liveChunks.length > 0) && <LiveTranscript chunks={liveChunks} interim={interimText} />}
      {liveNotes.length > 0 && <LiveNotes notes={liveNotes} />}

      {error && <p className="error">{error}</p>}

      <div className="panel">
        <div className="section-header">Completed Meetings</div>
        {meetings.length === 0 ? (
          <div className="row">
            <span className="label dim">No meetings yet</span>
          </div>
        ) : (
          meetings.map((m) => (
            <MeetingRow key={m.id} meeting={m} onExport={handleExport} onDelete={handleDelete} />
          ))
        )}
      </div>

      {exportResult && <ExportPreview result={exportResult} onDownload={handleDownload} />}

      <footer className="footer">
        <span className="dim">{isTauri() ? `whisper.cpp ${currentModel} · Metal GPU` : "Web Speech API (browser-native)"}</span>
      </footer>
    </div>
  )
}
