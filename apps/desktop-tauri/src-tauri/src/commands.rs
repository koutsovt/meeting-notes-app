use crate::audio_capture::{self, CaptureState};
use crate::audio_resample;
use crate::transcription::{TranscriptionConfig, TranscriptionResult, TranscriptionState, WhisperModel};
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

pub type SharedCaptureState = Arc<Mutex<CaptureState>>;

/// Audio chunk payload emitted to the frontend via Tauri events.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioChunkEvent {
    pub id: String,
    pub meeting_id: String,
    pub sequence: u32,
    pub start_time_ms: u64,
    pub end_time_ms: u64,
    pub source: String,
    pub sample_rate: u32,
    pub channel_count: u32,
    pub samples_base64: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCaptureArgs {
    pub meeting_id: String,
    pub source: String,
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Start capturing system audio via ScreenCaptureKit.
///
/// Emits `audio-chunk` events to the frontend as audio accumulates.
#[tauri::command]
pub async fn start_capture(
    args: StartCaptureArgs,
    capture_state: State<'_, SharedCaptureState>,
    app: AppHandle,
) -> Result<(), String> {
    let accumulator;
    {
        let mut state = capture_state
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;

        if state.is_capturing {
            return Err("Capture already in progress".to_string());
        }

        state.meeting_id = Some(args.meeting_id.clone());
        state.source = args.source.clone();
        state.sequence = 0;
        state.start_epoch_ms = epoch_ms();

        // Start the ScreenCaptureKit stream
        let stream = audio_capture::start_system_capture(state.accumulator.clone())?;
        state.stream = Some(stream);
        state.is_capturing = true;
        accumulator = state.accumulator.clone();
    }

    // Spawn a background thread that periodically drains audio and emits events
    let capture_state_clone = Arc::clone(capture_state.inner());
    std::thread::Builder::new()
        .name("audio-chunk-emitter".to_string())
        .spawn(move || {
            chunk_emitter_loop(capture_state_clone, accumulator, app, args.meeting_id, args.source);
        })
        .map_err(|e| format!("Failed to spawn emitter thread: {e}"))?;

    Ok(())
}

fn chunk_emitter_loop(
    capture_state: Arc<Mutex<CaptureState>>,
    _accumulator: Arc<Mutex<audio_capture::AudioAccumulator>>,
    app: AppHandle,
    meeting_id: String,
    source: String,
) {
    const POLL_INTERVAL_MS: u64 = 500;
    const CHUNK_DURATION_MS: u64 = 15000;

    loop {
        std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));

        let chunk_data = {
            let mut state = match capture_state.lock() {
                Ok(s) => s,
                Err(_) => break,
            };

            if !state.is_capturing {
                break;
            }

            state.try_drain_chunk()
        };

        if let Some((samples, seq, sample_rate, channel_count)) = chunk_data {
            let samples_base64 = f32_to_base64(&samples);
            let event = AudioChunkEvent {
                id: uuid::Uuid::new_v4().to_string(),
                meeting_id: meeting_id.clone(),
                sequence: seq,
                start_time_ms: seq as u64 * CHUNK_DURATION_MS,
                end_time_ms: (seq as u64 + 1) * CHUNK_DURATION_MS,
                source: source.clone(),
                sample_rate,
                channel_count,
                samples_base64,
                created_at: {
                    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
                    format!("{}Z", d.as_secs())
                },
            };

            if app.emit("audio-chunk", event).is_err() {
                break;
            }
        }
    }
}

/// Stop the active capture stream.
#[tauri::command]
pub async fn stop_capture(
    capture_state: State<'_, SharedCaptureState>,
) -> Result<(), String> {
    let mut state = capture_state
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;

    if !state.is_capturing {
        return Err("Capture is not in progress".to_string());
    }

    // Stop the SCStream
    if let Some(ref stream) = state.stream {
        let _ = stream.stop_capture();
    }
    state.stream = None;
    state.is_capturing = false;
    state.meeting_id = None;

    Ok(())
}

/// Transcribe a 16kHz mono f32 audio buffer using whisper.cpp.
#[tauri::command]
pub async fn transcribe_audio(
    samples_base64: String,
    transcription_state: State<'_, Mutex<TranscriptionState>>,
) -> Result<TranscriptionResult, String> {
    let state = transcription_state
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;

    let engine = state
        .engine
        .as_ref()
        .ok_or_else(|| "Whisper model not loaded. Call load_model first.".to_string())?;

    let bytes = base64_decode(&samples_base64)?;
    let samples = bytes_to_f32(&bytes);

    engine.transcribe(&samples, &state.config)
}

/// Load a whisper model from the app's models directory.
#[tauri::command]
pub async fn load_model(
    model: String,
    app: AppHandle,
    transcription_state: State<'_, Mutex<TranscriptionState>>,
) -> Result<(), String> {
    let whisper_model = match model.as_str() {
        "tiny.en" => WhisperModel::TinyEn,
        "base.en" => WhisperModel::BaseEn,
        "small.en" => WhisperModel::SmallEn,
        _ => return Err(format!("Unknown model: {model}. Use tiny.en, base.en, or small.en")),
    };

    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?
        .join("models");

    let mut state = transcription_state
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;

    state.model = whisper_model;
    state.load_model(&models_dir)
}

/// Update transcription configuration at runtime.
#[tauri::command]
pub fn set_transcription_config(
    config: TranscriptionConfig,
    transcription_state: State<'_, Mutex<TranscriptionState>>,
) -> Result<(), String> {
    let mut state = transcription_state
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    state.config = config;
    Ok(())
}

/// Get current transcription configuration.
#[tauri::command]
pub fn get_transcription_config(
    transcription_state: State<'_, Mutex<TranscriptionState>>,
) -> Result<TranscriptionConfig, String> {
    let state = transcription_state
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    Ok(state.config.clone())
}

/// Get current capture status.
#[tauri::command]
pub fn capture_status(
    capture_state: State<'_, SharedCaptureState>,
) -> Result<bool, String> {
    let state = capture_state
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    Ok(state.is_capturing)
}

/// Check if the whisper model is loaded and ready.
#[tauri::command]
pub fn model_status(
    transcription_state: State<'_, Mutex<TranscriptionState>>,
) -> Result<bool, String> {
    let state = transcription_state
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    Ok(state.engine.is_some())
}

/// Prepare raw audio for whisper: stereo 48kHz → mono 16kHz.
#[tauri::command]
pub fn prepare_audio(
    samples_base64: String,
    source_rate: u32,
    channel_count: u32,
) -> Result<String, String> {
    let bytes = base64_decode(&samples_base64)?;
    let samples = bytes_to_f32(&bytes);
    let prepared = audio_resample::prepare_for_whisper(&samples, source_rate, channel_count)?;
    Ok(f32_to_base64(&prepared))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {e}"))
}

fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn f32_to_base64(samples: &[f32]) -> String {
    use base64::Engine;
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    base64::engine::general_purpose::STANDARD.encode(&bytes)
}
