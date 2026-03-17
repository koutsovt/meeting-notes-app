#[cfg(target_os = "macos")]
mod audio_capture;
#[cfg(target_os = "macos")]
mod audio_resample;
#[cfg(target_os = "macos")]
mod commands;
#[cfg(target_os = "macos")]
mod transcription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_audio_recorder::init())
        .plugin(tauri_plugin_speech_recognizer::init())
        .plugin(tauri_plugin_keychain::init());

    #[cfg(target_os = "macos")]
    {
        use std::sync::{Arc, Mutex};
        builder = builder
            .manage(Arc::new(Mutex::new(audio_capture::CaptureState::new())))
            .manage(Mutex::new(transcription::TranscriptionState::new()))
            .invoke_handler(tauri::generate_handler![
                commands::start_capture,
                commands::stop_capture,
                commands::transcribe_audio,
                commands::load_model,
                commands::capture_status,
                commands::model_status,
                commands::prepare_audio,
                commands::set_transcription_config,
                commands::get_transcription_config,
            ]);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
