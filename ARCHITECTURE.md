# Architecture

## Overview

Meeting Notes is a macOS desktop app built with Tauri (Rust + TypeScript/React). It captures meeting audio, transcribes it locally via whisper.cpp, detects speaker turns, generates summaries, and exports structured notes.

```
┌─────────────────────────────────────────────────────────┐
│                    Desktop UI (React)                    │
│   App.tsx  ─── MeetingUI ─── LiveTranscript/LiveNotes   │
└────────────────────┬────────────────────────────────────┘
                     │ callbacks
┌────────────────────▼────────────────────────────────────┐
│                App Orchestrator (TypeScript)             │
│   startMeeting → capture → transcribe → intelligence    │
│   stopMeeting  → diarize → assemble → storage → export  │
└───┬──────────┬──────────┬──────────┬──────────┬─────────┘
    │          │          │          │          │
┌───▼──┐ ┌────▼───┐ ┌────▼────┐ ┌──▼───┐ ┌───▼────┐
│Capture│ │Transcr.│ │Intelli. │ │Store │ │ Export │
└───┬───┘ └────┬───┘ └─────────┘ └──────┘ └────────┘
    │          │
    │    ┌─────▼──────────────────────────────────┐
    │    │         Tauri IPC (invoke/events)       │
    │    └─────┬──────────────────────────────────┘
    │          │
┌───▼──────────▼──────────────────────────────────┐
│              Rust Backend (src-tauri/)            │
│  ScreenCaptureKit ──► Resample ──► Whisper.cpp   │
│  (48kHz stereo)      (16kHz mono)   (Metal GPU)  │
│                                    + tinydiarize  │
└──────────────────────────────────────────────────┘
```

## Audio Pipeline

### System Audio Capture (Teams, Zoom, etc.)

```
macOS System Audio
  │
  ▼
ScreenCaptureKit (audio_capture.rs)
  - Display-wide filter, captures all desktop audio
  - Excludes own process audio
  - 48kHz stereo f32 PCM
  │
  ▼
AudioAccumulator (ring buffer)
  - Collects samples from SCK callbacks
  - Background thread polls every 500ms
  │
  ▼ (every 5 seconds)
audio-chunk Tauri event
  - Base64-encoded f32 samples
  - Sent to TypeScript via IPC
  │
  ▼
Resample (audio_resample.rs)
  - 48kHz stereo → 16kHz mono
  - Sinc interpolation (rubato crate)
  │
  ▼
Whisper.cpp (transcription.rs)
  - Metal GPU acceleration
  - Greedy best_of=5 or beam search
  - tinydiarize speaker turn detection
  - Real token-level confidence
  - Entropy/no-speech filtering
  │
  ▼
TranscriptChunk with speaker turns
```

### Browser Fallback (Web Speech API)

When running in dev mode without Tauri:

```
Microphone (getUserMedia)
  │
  ▼
SpeechBuffer (speech-buffer.ts)
  - Web Speech API (interimResults=true)
  - Stores final results with timestamps
  - Emits interim text for live display
  │
  ▼
WebTranscriptionService
  - Reads text for time ranges
  - Maps to TranscriptChunk format
```

## Module Structure

```
meeting-notes-app/
├── apps/
│   └── desktop-tauri/
│       ├── src/                    # TypeScript/React frontend
│       │   ├── App.tsx             # UI components
│       │   ├── App.css             # Styles
│       │   ├── create-app.ts       # App factory, wires services
│       │   ├── orchestrator/       # Meeting lifecycle management
│       │   ├── adapters/
│       │   │   ├── web-capture.ts          # Browser mic capture
│       │   │   ├── web-transcription.ts    # Web Speech API
│       │   │   ├── tauri-capture.ts        # SCK via Tauri IPC
│       │   │   ├── tauri-transcription.ts  # Whisper via Tauri IPC
│       │   │   └── speech-buffer.ts        # Shared speech recognition buffer
│       │   ├── storage-memory.ts   # In-memory storage
│       │   └── __tests__/          # Component and unit tests
│       └── src-tauri/              # Rust backend
│           └── src/
│               ├── lib.rs              # Tauri app setup
│               ├── commands.rs         # IPC command handlers
│               ├── audio_capture.rs    # ScreenCaptureKit integration
│               ├── audio_resample.rs   # 48kHz→16kHz resampling
│               └── transcription.rs    # Whisper.cpp engine
├── modules/
│   ├── capture/            # Capture service (generic)
│   ├── intelligence/       # Summary + live notes generation
│   ├── export/             # Markdown/JSON export
│   ├── storage/            # Persistent storage
│   └── diarization/        # Speaker identification
├── shared/
│   ├── types/              # Shared TypeScript interfaces
│   │   ├── audio.ts        # AudioChunk
│   │   ├── transcript.ts   # TranscriptChunk, Speaker
│   │   ├── meeting.ts      # Meeting
│   │   ├── summary.ts      # MeetingSummary, LiveNote, ActionItem
│   │   └── export.ts       # ExportResult
│   └── services/           # Service interfaces
│       ├── capture-service.ts
│       ├── transcription-service.ts
│       ├── intelligence-service.ts
│       ├── storage-service.ts
│       ├── export-service.ts
│       └── diarization-service.ts
└── tests/                  # Integration tests
```

## Key Design Decisions

### Modules are independent
Each module (capture, transcription, intelligence, storage, export, diarization) has no dependencies on other modules. They communicate only through shared types.

### Dual capture paths
- **Native (Tauri)**: ScreenCaptureKit → Rust resampling → whisper.cpp. Used in production.
- **Web (Browser)**: getUserMedia → Web Speech API. Used in dev/preview mode.

### Mutable callback pattern
`create-app.ts` creates an `App` object with mutable callback fields (`onTranscriptUpdate`, `onLiveNote`, `onInterimText`). React components set these in `useEffect` hooks. This avoids re-creating the orchestrator when callbacks change.

### tinydiarize for speaker turns
Whisper.cpp's built-in tinydiarize provides basic speaker turn detection without requiring a separate model. Each transcription segment includes `speaker_turn_next: bool`. The diarization module assigns sequential speaker labels based on these turn markers.

## Whisper Configuration

Runtime-configurable via `TranscriptionConfig` (Rust) / `setTranscriptionConfig()` (TypeScript):

| Parameter | Default | Description |
|-----------|---------|-------------|
| strategy | greedy | "greedy" or "beam_search" |
| best_of | 5 | Candidates for greedy, beam width for beam search |
| n_threads | 0 (auto) | CPU threads for decoding |
| temperature | 0.0 | Decoding temperature (0 = deterministic) |
| temperature_inc | 0.2 | Temperature increment on fallback |
| entropy_thold | 2.4 | Entropy threshold for hallucination filtering |
| logprob_thold | -1.0 | Log probability threshold |
| no_speech_thold | 0.6 | No-speech probability threshold |
| language | "en" | Language code or "auto" for detection |
| initial_prompt | "" | Domain vocabulary priming |
| suppress_blank | true | Suppress blank outputs |
| suppress_nst | false | Suppress non-speech tokens |
| tdrz_enable | true | Speaker turn detection |

## macOS Permissions

Required entitlements (`Entitlements.plist`):
- `com.apple.security.app-sandbox` — App sandbox
- `com.apple.security.device.audio-input` — Microphone access
- `com.apple.security.screen-capture` — ScreenCaptureKit (system audio)
