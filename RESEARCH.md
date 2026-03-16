# RESEARCH: Mobile Audio Capture Module for Meeting Notes App
Generated: 2026-03-16
Stack: Tauri 2 + React + TypeScript + Rust (existing) — extending to mobile

## DECISION: Tauri 2 Mobile (not React Native)

The project already uses Tauri 2 with React + Rust. Tauri 2 has stable iOS/Android
support. Adding a separate React Native app would mean maintaining two codebases,
two build systems, and duplicating the shared TypeScript modules. Staying in Tauri
reuses the existing frontend, shared types, service interfaces, and Rust backend.

### Why NOT React Native
- Separate codebase, separate build toolchain, no shared Rust backend
- Audio streaming libs are fragmented: `react-native-live-audio-stream` (last published 4 years ago), `expo-audio` (file-based recording, no raw PCM streaming), `@siteed/expo-audio-studio` (active but third-party)
- Would require bridging data back to the Tauri desktop app via network

### Why Tauri 2 Mobile
- Same React frontend, same TypeScript modules, same Rust backend
- `tauri-plugin-audio-recorder` (v0.1) — cross-platform audio recording for Tauri 2.x with iOS + Android support, quality presets (16kHz mono for speech), pause/resume, permission handling
- `tauri-plugin-stt` — cross-platform speech recognition with Vosk (offline) for desktop, native speech APIs on mobile
- Mobile plugin system supports Swift (iOS) and Kotlin (Android) for custom native audio if needed
- Hot-reload on mobile devices/emulators via `npx tauri ios dev` / `npx tauri android dev`

## INSTALL

```bash
# Initialize mobile targets (run from apps/desktop-tauri/src-tauri/)
cd apps/desktop-tauri/src-tauri
npx tauri android init
npx tauri ios init

# Add audio recording plugin (Rust side)
# In apps/desktop-tauri/src-tauri/Cargo.toml:
cargo add tauri-plugin-audio-recorder@0.1

# Add JS bindings (from apps/desktop-tauri/)
cd apps/desktop-tauri
npm install tauri-plugin-audio-recorder-api

# Optional: Speech-to-text plugin
cargo add tauri-plugin-stt@0.1
npm install tauri-plugin-stt-api

# Run on mobile
npx tauri android dev    # Android emulator
npx tauri ios dev        # iOS simulator (macOS only)
```

## DEPENDENCIES

### Rust (Cargo.toml additions)

| crate                          | version | purpose                          |
|--------------------------------|---------|----------------------------------|
| tauri-plugin-audio-recorder    | 0.1     | Cross-platform mic recording     |
| tauri-plugin-stt               | 0.1     | Cross-platform speech-to-text    |

### JavaScript (package.json additions)

| package                            | version | purpose                          |
|------------------------------------|---------|----------------------------------|
| tauri-plugin-audio-recorder-api    | ^0.1    | JS bindings for audio recorder   |
| tauri-plugin-stt-api               | ^0.1    | JS bindings for speech-to-text   |

### Already installed (no changes needed)

| package            | version  | purpose                          |
|--------------------|----------|----------------------------------|
| @tauri-apps/api    | ^2.10.1  | Tauri core JS API                |
| @tauri-apps/cli    | ^2.5.0   | Tauri CLI (build/dev)            |
| react              | ^19.1.0  | UI framework                     |
| typescript         | ^5.7.0   | Type system                      |
| vitest             | ^3.0.0   | Test framework                   |

## AUDIO FORMAT NOTES

| Platform | Output Format | Details                              |
|----------|---------------|--------------------------------------|
| Desktop  | WAV           | 16-bit PCM, direct processing        |
| Android  | M4A/AAC       | MediaRecorder default, needs transcode for Whisper |
| iOS      | M4A/AAC       | AVAudioRecorder default, can output WAV |

For Whisper compatibility, mobile recordings in M4A need transcoding to 16kHz mono WAV.
Use `tauri-plugin-media-toolkit` or a Rust-side FFmpeg binding for conversion.

## CONFIG FILES TO CREATE

### apps/desktop-tauri/src-tauri/capabilities/mobile.json
```json
{
  "identifier": "mobile",
  "platforms": ["android", "iOS"],
  "permissions": [
    "audio-recorder:allow-start-recording",
    "audio-recorder:allow-stop-recording",
    "audio-recorder:allow-pause-recording",
    "audio-recorder:allow-resume-recording",
    "audio-recorder:allow-get-status",
    "audio-recorder:allow-request-permission",
    "audio-recorder:allow-check-permission"
  ]
}
```

### apps/desktop-tauri/src-tauri/Info.plist (iOS permissions)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSMicrophoneUsageDescription</key>
  <string>Meeting Notes needs microphone access to record meeting audio.</string>
</dict>
</plist>
```

### Android permissions (AndroidManifest.xml additions)
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
```

## PROJECT STRUCTURE

```
apps/desktop-tauri/
  src/
    adapters/
      tauri-capture.ts              # Existing — desktop ScreenCaptureKit
      tauri-transcription.ts        # Existing — desktop Whisper
      mobile-capture.ts             # NEW — mobile mic via audio-recorder plugin
      mobile-transcription.ts       # NEW — mobile STT via stt plugin or server
    platform/
      detect.ts                     # NEW — detect mobile vs desktop at runtime
  src-tauri/
    src/
      lib.rs                        # Add audio-recorder plugin init
      audio_capture.rs              # Existing — desktop ScreenCaptureKit
      mobile_audio.rs               # NEW — mobile-specific Rust commands if needed
    capabilities/
      default.json                  # Existing — desktop permissions
      mobile.json                   # NEW — mobile permissions
    gen/
      android/                      # Auto-generated by `tauri android init`
      apple/                        # Auto-generated by `tauri ios init`
modules/
  capture/
    index.ts                        # Existing — extend AudioBackend for mobile
shared/
  types/
    audio.ts                        # Extend source: "system" | "microphone" | "mobile"
```

## SETUP STEPS

1. Run `npx tauri android init` and `npx tauri ios init` in `apps/desktop-tauri/src-tauri/`
2. Add `tauri-plugin-audio-recorder` to Cargo.toml and register in `lib.rs`
3. Install `tauri-plugin-audio-recorder-api` JS bindings
4. Create `capabilities/mobile.json` with audio recording permissions
5. Add iOS `Info.plist` microphone permission description
6. Add Android `RECORD_AUDIO` permission to AndroidManifest
7. Create `mobile-capture.ts` adapter implementing `CaptureService` interface
8. Create `platform/detect.ts` to detect mobile vs desktop at runtime
9. Update `create-app.ts` to select mobile adapter when on mobile
10. Test with `npx tauri android dev` and `npx tauri ios dev`

## KEY PATTERNS

- **Adapter pattern**: New `mobile-capture.ts` implements the same `CaptureService` interface as desktop — the orchestrator doesn't know the difference
- **Platform detection**: Use `@tauri-apps/api` to detect mobile vs desktop at runtime, select the right adapter in `create-app.ts`
- **File-based capture on mobile**: Unlike desktop's real-time PCM streaming, mobile records to a file (M4A), then processes it. The mobile adapter should chunk completed recordings into `AudioChunk` objects for the pipeline
- **Quality preset**: Use `Low` preset (16kHz mono) on mobile — matches Whisper's expected input format and saves battery
- **Background recording**: iOS requires foreground service or background audio mode; Android requires `FOREGROUND_SERVICE` permission
- **Existing module independence**: The capture module's `AudioBackend` interface already abstracts the audio source — mobile becomes another backend implementation

## ALTERNATIVE: Custom Tauri Mobile Plugin

If `tauri-plugin-audio-recorder` doesn't support raw PCM streaming (only file output),
create a custom Tauri plugin using Swift (AVAudioEngine for iOS) and Kotlin (AudioRecord
for Android) that streams PCM chunks via Tauri events — matching the desktop pattern.
Tauri's plugin system supports this via `plugin android init` / `plugin ios init`.

## SOURCES

- https://v2.tauri.app/blog/tauri-20/ — Tauri 2 stable release, mobile support
- https://v2.tauri.app/develop/plugins/develop-mobile/ — Mobile plugin development
- https://crates.io/crates/tauri-plugin-audio-recorder — Audio recorder plugin
- https://crates.io/crates/tauri-plugin-stt — Speech-to-text plugin
- https://github.com/brenogonzaga/tauri-plugin-audio-recorder — Plugin source
- https://tasukehub.com/articles/tauri-v2-mobile-guide-2025 — Tauri v2 mobile guide
- https://docs.expo.dev/versions/latest/sdk/audio/ — expo-audio (rejected alternative)
- https://www.npmjs.com/package/@siteed/expo-audio-studio — Expo audio studio (rejected)
- https://www.npmjs.com/package/react-native-live-audio-stream — RN live audio (rejected, 4yr stale)
