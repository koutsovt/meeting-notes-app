use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_speech_recognizer);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<SpeechRecognizer<R>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_speech_recognizer)?;
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("com.app.speechrecognizer", "SpeechRecognizerPlugin")?;
    Ok(SpeechRecognizer(handle))
}

pub struct SpeechRecognizer<R: Runtime>(pub(crate) PluginHandle<R>);

impl<R: Runtime> SpeechRecognizer<R> {
    pub fn start(&self, payload: serde_json::Value) -> Result<(), Box<dyn std::error::Error>> {
        self.0
            .run_mobile_plugin::<()>("start", payload)
            .map_err(|e| e.into())
    }

    pub fn stop(&self) -> Result<(), Box<dyn std::error::Error>> {
        self.0
            .run_mobile_plugin::<()>("stop", ())
            .map_err(|e| e.into())
    }

    pub fn check_permissions(
        &self,
    ) -> Result<crate::models::PermissionStatus, Box<dyn std::error::Error>> {
        self.0
            .run_mobile_plugin("checkPermissions", ())
            .map_err(|e| e.into())
    }

    pub fn request_permissions(
        &self,
    ) -> Result<crate::models::PermissionStatus, Box<dyn std::error::Error>> {
        self.0
            .run_mobile_plugin("requestPermissions", ())
            .map_err(|e| e.into())
    }
}
