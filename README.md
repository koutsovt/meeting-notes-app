# Meeting Notes

A macOS desktop app that captures meeting audio locally, transcribes with whisper.cpp, detects speakers, and generates structured notes — all offline.

## What it does

- Captures system audio from Teams, Zoom, or any meeting app via ScreenCaptureKit
- Transcribes in real-time using whisper.cpp with Metal GPU acceleration
- Detects speaker turns (tinydiarize)
- Generates live notes with key points and action items
- Exports to Markdown or JSON

## Quick Start

```bash
# Install dependencies
npm install

# Dev mode (browser, uses Web Speech API)
cd apps/desktop-tauri
npm run dev
# Open http://localhost:1420

# Native mode (Tauri, uses whisper.cpp)
# Requires a whisper model in ~/Library/Application Support/meeting-notes/models/
cd apps/desktop-tauri
npm run tauri dev
```

### Whisper Models

Download a GGML model and place it in the app data directory:

```bash
mkdir -p ~/Library/Application\ Support/meeting-notes/models
# Pick one:
curl -L -o ~/Library/Application\ Support/meeting-notes/models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny.en | 75 MB | Fastest | Basic |
| base.en | 142 MB | Fast | Good (default) |
| small.en | 466 MB | Moderate | Best |

## Architecture

```
Teams/Zoom audio → ScreenCaptureKit (48kHz)
  → Rust resample (16kHz) → whisper.cpp (Metal GPU)
  → Speaker turns → Summary → Export
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Testing

```bash
# All tests (root + desktop-tauri)
npx vitest run
cd apps/desktop-tauri && npx vitest run
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React + TypeScript |
| Desktop | Tauri 2 |
| Audio capture | ScreenCaptureKit (macOS) |
| Transcription | whisper.cpp via whisper-rs (Metal) |
| Resampling | rubato (Rust) |
| Speaker detection | tinydiarize (whisper.cpp built-in) |
| Dev fallback | Web Speech API |

## Project Structure

```
apps/desktop-tauri/     # Tauri app (React frontend + Rust backend)
modules/                # Independent service modules
  capture/              # Audio capture abstraction
  intelligence/         # Summary + live notes
  export/               # Markdown/JSON export
  storage/              # Meeting persistence
  diarization/          # Speaker identification
shared/                 # Shared types and service interfaces
tests/                  # Integration tests
```
