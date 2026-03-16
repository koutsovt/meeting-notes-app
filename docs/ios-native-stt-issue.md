# iOS Native Speech Recognition Issue

## Status: Unresolved — using webkitSpeechRecognition fallback

## Problem

`tauri-plugin-stt` (v0.1.1) uses native iOS `SFSpeechRecognizer` via a Swift plugin class.
The Swift code initializes correctly, requests permissions, starts `AVAudioEngine`, and
installs a tap on the input node. However, **no recognition results are ever delivered
to the JavaScript layer**.

The `webkitSpeechRecognition` API (built into iOS WKWebView) works as a fallback but
has lower accuracy than native `SFSpeechRecognizer`.

## Root Cause Analysis

### 1. Plugin JS wrapper has broken platform detection

The plugin's JS API (`tauri-plugin-stt-api`) uses `isMobilePlatform()` to decide
how to register event listeners:

```javascript
// From node_modules/tauri-plugin-stt-api/dist-js/index.js
function isMobilePlatform() {
  // Checks for "iphone"/"ipad" in user agent
  if (w.webkit?.messageHandlers) {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("iphone") || ua.includes("ipad")) {
      return true;
    }
  }
  return false; // <-- Falls through to desktop on iOS WKWebView
}
```

**iOS WKWebView in Tauri does NOT include "iPhone" in the user agent.** It sends a
macOS-like UA. So `isMobilePlatform()` returns `false`, and the JS registers listeners
via the desktop event system (`listen("plugin:stt:result", ...)`) instead of the mobile
channel system (`addPluginListener("stt", "result", ...)`).

The Swift plugin emits events via `self.trigger("result", data:)` which goes through
the **mobile channel system** — so the events never reach the desktop-style listener.

### 2. Direct addPluginListener also failed

We bypassed the plugin's JS wrapper and called `addPluginListener("stt", "result", ...)`
directly. This should have fixed the channel mismatch, but results still didn't arrive.

Possible reasons:
- The Swift plugin's `self.trigger()` may not be compatible with `addPluginListener`
  on this version of Tauri (2.10.x)
- `AVAudioEngine` and `webkitSpeechRecognition` may conflict over the iOS audio session
  (both try to access the microphone). Even though we removed webkitSpeechRecognition
  from the mobile path, previous permission grants may have left the audio session in
  a bad state
- The `AVAudioSession` category `.playAndRecord` with `.defaultToSpeaker` option may
  conflict with how Tauri's WKWebView manages its own audio session
- Without device-level console logs (Xcode debugger attached), we cannot see the
  NSLog output from the Swift plugin to determine where it fails

### 3. No crash — silent failure

The plugin does not crash. `invoke("plugin:stt|start_listening", ...)` resolves
successfully. `invoke("plugin:stt|request_permission", ...)` returns granted permissions.
But no `result` events are ever fired, suggesting the Swift recognition task either:
- Never receives audio buffers from `AVAudioEngine`
- Receives them but `SFSpeechRecognizer` doesn't produce results
- Produces results but `self.trigger()` silently fails to deliver them

## What Works

`webkitSpeechRecognition` in iOS WKWebView works because:
- It uses Apple's server-side speech recognition (requires internet)
- WKWebView handles the audio session internally
- No Tauri plugin channel communication needed — results come via JS callbacks
- Our improved `SpeechBuffer` creates fresh instances on restart (iOS kills sessions frequently)

## Files Involved

| File | Role |
|------|------|
| `apps/desktop-tauri/src/adapters/mobile-transcription.ts` | Native STT adapter (written, not currently used) |
| `apps/desktop-tauri/src/adapters/speech-buffer.ts` | webkitSpeechRecognition adapter (currently used on mobile) |
| `apps/desktop-tauri/src/adapters/mobile-capture.ts` | Timer-based chunk emitter for mobile |
| `apps/desktop-tauri/src/platform/detect.ts` | Platform detection (iOS/Android/macOS/browser) |
| `apps/desktop-tauri/src/create-app.ts` | Wires the correct adapters per platform |
| `apps/desktop-tauri/src-tauri/src/lib.rs` | Registers both audio-recorder and stt plugins |
| `apps/desktop-tauri/src-tauri/capabilities/mobile.json` | STT permissions already configured |
| `apps/desktop-tauri/src-tauri/gen/apple/meeting-notes_iOS/Info.plist` | NSMicrophoneUsageDescription + NSSpeechRecognitionUsageDescription present |

### Plugin source (read-only, from cargo cache)

| File | What it does |
|------|-------------|
| `~/.cargo/registry/src/.../tauri-plugin-stt-0.1.1/ios/Sources/SttPlugin.swift` | Full SFSpeechRecognizer implementation (~620 lines) |
| `~/.cargo/registry/src/.../tauri-plugin-stt-0.1.1/src/mobile.rs` | Rust ↔ Swift bridge via `run_mobile_plugin` |
| `~/.cargo/registry/src/.../tauri-plugin-stt-0.1.1/src/commands.rs` | Tauri command handlers |

## Resolution Options (ranked by likelihood of success)

### Option A: Custom Tauri Swift plugin (recommended)

Build a new plugin from scratch that uses Tauri's `Channel` API instead of
`self.trigger()` for sending results back to JS. The `Channel` API is the
newer, more reliable way to stream data from native to JS on mobile.

Steps:
1. `npx tauri plugin new speech-recognizer`
2. `npx tauri plugin ios init` inside the plugin
3. Copy the SFSpeechRecognizer logic from `SttPlugin.swift`
4. Replace `self.trigger("result", data:)` with a Tauri Channel passed from JS
5. On the JS side, create a `Channel` and pass it to the start command
6. Results flow through the channel directly — no event system needed

Estimated effort: 2-3 hours

### Option B: Fork tauri-plugin-stt JS wrapper

Fix `isMobilePlatform()` in the JS wrapper to detect iOS WKWebView correctly.
Add `navigator.maxTouchPoints > 0` check as we did in `platform/detect.ts`.

This only fixes the listener registration — if `self.trigger()` itself is broken
on iOS, this won't help (and our testing suggests it might be broken).

Estimated effort: 30 minutes (but may not work)

### Option C: Debug with Xcode attached

Run `npx tauri ios dev` with Xcode open and the device selected. Set breakpoints
in `SttPlugin.swift` to see:
- Does `audioEngine.start()` succeed?
- Does the tap callback fire (are buffers being appended)?
- Does `didHypothesizeTranscription` or `didFinishRecognition` fire?
- Does `self.trigger()` execute without error?

This would definitively identify where the chain breaks.

Estimated effort: 1 hour (requires USB-connected device + Xcode)

## How to Switch to Native STT (when fixed)

In `apps/desktop-tauri/src/create-app.ts`, change the mobile branch from:

```typescript
// Current: webkitSpeechRecognition
const speechBuffer = createSpeechBuffer()
// ...
transcription: createWebTranscriptionService(speechBuffer),
```

To:

```typescript
// Native: SFSpeechRecognizer
const mobileStt = createMobileTranscriptionService()
// ...
transcription: mobileStt.service,
```

The `mobile-transcription.ts` adapter is already written and ready. It just needs
the underlying plugin communication to work.
