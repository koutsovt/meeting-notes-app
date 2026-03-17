use tauri::{command, ipc::Channel, AppHandle, Runtime};

use crate::models::*;

#[command]
pub async fn start<R: Runtime>(
    app: AppHandle<R>,
    on_result: Channel<RecognitionResult>,
    config: Option<RecognitionConfig>,
) -> Result<(), String> {
    let config = config.unwrap_or_default();

    let payload = serde_json::json!({
        "onResult": on_result,
        "language": config.language,
        "interimResults": config.interim_results,
        "continuous": config.continuous,
    });

    #[cfg(mobile)]
    {
        use tauri::Manager;
        app.state::<crate::mobile::SpeechRecognizer<R>>()
            .start(payload)
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(mobile))]
    {
        let _ = (app, payload);
    }

    Ok(())
}

#[command]
pub async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(mobile)]
    {
        use tauri::Manager;
        app.state::<crate::mobile::SpeechRecognizer<R>>()
            .stop()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
    }

    Ok(())
}

#[command]
pub async fn check_permissions<R: Runtime>(app: AppHandle<R>) -> Result<PermissionStatus, String> {
    #[cfg(mobile)]
    {
        use tauri::Manager;
        app.state::<crate::mobile::SpeechRecognizer<R>>()
            .check_permissions()
            .map_err(|e| e.to_string())
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        Ok(PermissionStatus {
            microphone: "granted".to_string(),
            speech_recognition: "granted".to_string(),
        })
    }
}

#[command]
pub async fn request_permissions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PermissionStatus, String> {
    #[cfg(mobile)]
    {
        use tauri::Manager;
        app.state::<crate::mobile::SpeechRecognizer<R>>()
            .request_permissions()
            .map_err(|e| e.to_string())
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        Ok(PermissionStatus {
            microphone: "granted".to_string(),
            speech_recognition: "granted".to_string(),
        })
    }
}
