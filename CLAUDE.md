# Meeting Notes App

Offline macOS desktop app: captures meeting audio (ScreenCaptureKit), transcribes via whisper.cpp (Metal GPU), detects speakers, generates summaries & action items, exports to Markdown/JSON.

## Architecture

```
capture → transcription → diarization → intelligence → storage → export
```

UI (React/Tauri) communicates only with the App Orchestrator. Modules are independent.

## Project Structure

```
apps/desktop-tauri/          # Tauri 2 app — React 19 frontend + Rust backend
  src/                       #   React components, hooks, pages
  src-tauri/                 #   Rust: audio capture, whisper-rs, resampling
modules/                     # Independent service modules (one index.ts each)
  capture/                   #   Audio capture abstraction
  transcription/             #   Whisper transcription
  diarization/               #   Speaker identification (tinydiarize)
  intelligence/              #   Summary + live notes generation
  storage/                   #   Meeting persistence (better-sqlite3)
  export/                    #   Markdown / JSON export
shared/                      # Shared contracts consumed by all modules
  types/                     #   Data types (audio, meeting, transcript, summary, export)
  services/                  #   Service interfaces (one per module)
  prompts/                   #   LLM prompt templates (empty)
  utils/                     #   Shared utilities (empty)
tests/                       # Integration tests (one per module + orchestrator)
docs/architecture/           # Design docs
```

## Tech Stack

| Layer          | Tech                                      |
|----------------|-------------------------------------------|
| UI             | React 19 + TypeScript 5.7                 |
| Desktop        | Tauri 2                                   |
| Audio          | ScreenCaptureKit → rubato (Rust resample) |
| Transcription  | whisper.cpp via whisper-rs (Metal)         |
| Speakers       | tinydiarize                               |
| Storage        | better-sqlite3                            |
| Testing        | Vitest 3 + Testing Library                |
| Dev fallback   | Web Speech API                            |

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

## Quality Checks (Zero Tolerance)

```bash
# Typecheck — must pass with zero errors
npx tsc --noEmit

# Tests — all must pass
npx vitest run

# Frontend tests
cd apps/desktop-tauri && npx vitest run

# No dead code, no commented-out code, no console.logs
# No unused imports, no placeholder/stub implementations
# No TODOs left behind — finish the work or state what's incomplete
```
