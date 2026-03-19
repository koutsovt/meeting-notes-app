# Meeting Notes App

Offline macOS desktop app: captures meeting audio (ScreenCaptureKit), transcribes via whisper.cpp (Metal GPU), detects speakers, generates summaries & action items, exports to Markdown/JSON.

## Architecture

```
capture → transcription → diarization → intelligence → storage → export
```

UI (React/Tauri) communicates only with the App Orchestrator. Modules are independent.
Ports-and-adapters pattern: `shared/services/` defines abstract ports, `modules/` provides implementations, `apps/desktop-tauri/src/adapters/` provides platform-specific adapters (web, Tauri desktop, mobile).

## Project Structure

```
apps/desktop-tauri/              # Tauri 2 app — React 19 frontend + Rust backend
  src/                           #   React components, hooks, entry points
    adapters/                    #   Platform adapters (web/tauri/mobile capture & transcription)
    orchestrator/                #   Meeting session orchestration
    platform/                    #   Platform detection (macOS/iOS/browser)
    __tests__/                   #   Frontend unit tests (jsdom)
  src-tauri/                     #   Rust: audio capture, whisper-rs, resampling
    plugins/speech-recognizer/   #   Custom Tauri plugin (Rust + Swift/iOS)
modules/                         # Independent service modules (one index.ts each)
  capture/                       #   Audio capture abstraction
  transcription/                 #   Whisper transcription
  diarization/                   #   Speaker identification (tinydiarize)
  intelligence/                  #   Summary + live notes generation
  storage/                       #   Meeting persistence (better-sqlite3)
  export/                        #   Markdown / JSON export
shared/                          # Shared contracts consumed by all modules
  types/                         #   Data types (audio, meeting, transcript, summary, export)
  services/                      #   Service interfaces (one per module)
tests/                           # Integration tests (one per module + orchestrator)
```

## Tech Stack

| Layer         | Tech                                       |
|---------------|--------------------------------------------|
| UI            | React 19 + TypeScript 5.7                  |
| Desktop       | Tauri 2 (Rust edition 2024)                |
| Bundler       | Vite 6                                     |
| Audio         | ScreenCaptureKit → rubato 0.16 (resample)  |
| Transcription | whisper.cpp via whisper-rs 0.16 (Metal GPU) |
| Speakers      | tinydiarize                                |
| AI            | @kenkaiiii/gg-ai                           |
| Storage       | better-sqlite3                             |
| Testing       | Vitest 3 + Testing Library 16              |
| Dev fallback  | Web Speech API                             |

## Commands

```bash
npm install                  # Install root deps
npm run build                # tsc (typecheck + compile)
npm test                     # vitest run (root integration tests)

cd apps/desktop-tauri
npm run dev                  # Vite dev server (localhost:1420)
npm run tauri dev            # Native Tauri dev
npm test                     # vitest run (frontend tests)
```

## Rules

- Modules must remain independent — no cross-module imports
- UI communicates only through the App Orchestrator
- All module APIs defined via shared service interfaces in `shared/services/`
- All data types defined in `shared/types/` — modules consume, never redefine
- One `index.ts` per module — single entry point
- Path aliases: `@shared` → `shared/`, `@modules` → `modules/`
- Rust structs crossing IPC must use `#[serde(rename_all = "camelCase")]`
- TS interfaces for Tauri IPC use camelCase field names

## Quality Checks (Zero Tolerance)

```bash
# Typecheck — must pass with zero errors (ignore whisper-rs-sys build artifacts)
npx tsc --noEmit

# Tests — all must pass
npx vitest run

# Frontend tests
cd apps/desktop-tauri && npx vitest run

# No dead code, no commented-out code, no console.logs
# No unused imports, no placeholder/stub implementations
# No TODOs left behind — finish the work or state what's incomplete
```
