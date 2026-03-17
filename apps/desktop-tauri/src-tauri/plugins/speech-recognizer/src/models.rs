use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionConfig {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_true")]
    pub interim_results: bool,
    #[serde(default)]
    pub continuous: bool,
}

fn default_language() -> String {
    "en-US".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionResult {
    pub transcript: String,
    pub is_final: bool,
    pub confidence: f32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub microphone: String,
    pub speech_recognition: String,
}
