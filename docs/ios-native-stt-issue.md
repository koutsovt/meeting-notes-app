# iOS Native Speech Recognition

## Status: Resolved ✅

Native `SFSpeechRecognizer` works on iOS via a custom Tauri plugin (`speech-recognizer`)
that uses the `Channel` API for reliable Swift → JS result delivery.

## What Was Wrong

`tauri-plugin-stt` (v0.1.1) used `self.trigger("result", data:)` to send recognition
results from Swift to JS. This relies on the Plugin base class listener system which
silently failed on iOS WKWebView in Tauri 2.x — events were emitted but never received.

Two root causes:
1. **Broken platform detection** — the plugin's JS wrapper checked the user agent for
   "iphone"/"ipad", but iOS WKWebView in Tauri sends a macOS-like UA, so listeners
   registered via the desktop event system instead of the mobile channel system.
2. **`self.trigger()` unreliable** — even after bypassing the JS wrapper and calling
   `addPluginListener` directly, results still didn't arrive.

## How It Was Fixed

Built a custom plugin at `apps/desktop-tauri/src-tauri/plugins/speech-recognizer/` that
passes a Tauri `Channel` as a command argument to `start()`. The Swift code calls
`channel.send(data)` directly — no event system involved.

```
JS: new Channel() → invoke("plugin:speech-recognizer|start", { onResult: channel })
     ↓
Rust: fn start(on_result: Channel<RecognitionResult>) → run_mobile_plugin("start", payload)
     ↓
Swift: parses Channel from args → SFSpeechRecognizer results → channel.send(data)
     ↓
JS: channel.onmessage fires with each result
```

## Key Files

| File | Role |
|------|------|
| `src-tauri/plugins/speech-recognizer/ios/Sources/SpeechRecognizerPlugin.swift` | SFSpeechRecognizer + Channel-based delivery |
| `src-tauri/plugins/speech-recognizer/src/lib.rs` | Plugin registration |
| `src-tauri/plugins/speech-recognizer/src/mobile.rs` | Rust ↔ Swift bridge |
| `src-tauri/plugins/speech-recognizer/src/commands.rs` | Tauri commands (start, stop, permissions) |
| `src/adapters/mobile-transcription.ts` | JS adapter using Channel API |
| `src/create-app.ts` | Wires native STT on mobile, Whisper on desktop |

## Notes

- `tauri-plugin-stt` was removed from the project (Cargo.toml, lib.rs, capabilities)
- Transcription is optional — the orchestrator works without it
- The `webkitSpeechRecognition` fallback (`speech-buffer.ts`) still exists for browser dev mode
