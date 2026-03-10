use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
use std::path::Path;
use std::sync::Arc;

/// Whisper model sizes and their recommended use cases.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub enum WhisperModel {
    TinyEn,
    BaseEn,
    SmallEn,
}

impl WhisperModel {
    pub fn filename(&self) -> &str {
        match self {
            WhisperModel::TinyEn => "ggml-tiny.en.bin",
            WhisperModel::BaseEn => "ggml-base.en.bin",
            WhisperModel::SmallEn => "ggml-small.en.bin",
        }
    }
}

/// Runtime-configurable transcription parameters.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptionConfig {
    /// "greedy" or "beam_search"
    pub strategy: String,
    /// best_of for greedy, beam_size for beam search
    pub best_of: i32,
    /// Number of CPU threads (0 = auto)
    pub n_threads: i32,
    /// Initial decoding temperature (0.0 = deterministic)
    pub temperature: f32,
    /// Temperature increment on fallback
    pub temperature_inc: f32,
    /// Entropy threshold for segment filtering (higher = more permissive)
    pub entropy_thold: f32,
    /// Log probability threshold
    pub logprob_thold: f32,
    /// No-speech probability threshold
    pub no_speech_thold: f32,
    /// Language code ("en", "auto", etc.)
    pub language: String,
    /// Initial prompt to prime the decoder with domain vocabulary
    pub initial_prompt: String,
    /// Suppress blank outputs at the beginning
    pub suppress_blank: bool,
    /// Suppress non-speech tokens
    pub suppress_nst: bool,
    /// Enable tinydiarize speaker turn detection
    pub tdrz_enable: bool,
}

impl Default for TranscriptionConfig {
    fn default() -> Self {
        Self {
            strategy: "greedy".to_string(),
            best_of: 5,
            n_threads: 0,
            temperature: 0.0,
            temperature_inc: 0.2,
            entropy_thold: 2.4,
            logprob_thold: -1.0,
            no_speech_thold: 0.6,
            language: "en".to_string(),
            initial_prompt: String::new(),
            suppress_blank: true,
            suppress_nst: false,
            tdrz_enable: true,
        }
    }
}

/// Result of transcribing an audio chunk.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub confidence: f32,
    pub segments: Vec<TranscriptionSegment>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TranscriptionSegment {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub confidence: f32,
    pub no_speech_prob: f32,
    pub speaker_turn_next: bool,
}

/// Managed whisper.cpp context.
/// Thread-safe: WhisperContext is loaded once and shared via Arc.
/// Each transcription call creates its own WhisperState.
pub struct WhisperEngine {
    context: Arc<WhisperContext>,
}

impl WhisperEngine {
    /// Load a whisper model from disk.
    ///
    /// The model file must be a ggml-format .bin file.
    /// With the `metal` feature enabled, inference runs on Apple GPU.
    pub fn new(model_path: &Path) -> Result<Self, String> {
        if !model_path.exists() {
            return Err(format!("Model file not found: {}", model_path.display()));
        }

        let params = WhisperContextParameters::default();
        let context = WhisperContext::new_with_params(
            model_path.to_str().ok_or("Invalid model path encoding")?,
            params,
        )
        .map_err(|e| format!("Failed to load whisper model: {e}"))?;

        Ok(Self {
            context: Arc::new(context),
        })
    }

    /// Transcribe 16kHz mono f32 PCM audio with the given config.
    pub fn transcribe(
        &self,
        audio_16k_mono: &[f32],
        config: &TranscriptionConfig,
    ) -> Result<TranscriptionResult, String> {
        if audio_16k_mono.is_empty() {
            return Ok(TranscriptionResult {
                text: String::new(),
                confidence: 0.0,
                segments: Vec::new(),
            });
        }

        let mut state = self
            .context
            .create_state()
            .map_err(|e| format!("Failed to create whisper state: {e}"))?;

        let mut params = match config.strategy.as_str() {
            "beam_search" => FullParams::new(SamplingStrategy::BeamSearch {
                beam_size: config.best_of.max(1),
                patience: -1.0,
            }),
            _ => FullParams::new(SamplingStrategy::Greedy {
                best_of: config.best_of.max(1),
            }),
        };

        // Core settings
        params.set_print_special(false);
        params.set_print_realtime(false);
        params.set_print_progress(false);
        params.set_single_segment(false);

        // Threading
        if config.n_threads > 0 {
            params.set_n_threads(config.n_threads);
        }

        // Temperature & fallback
        params.set_temperature(config.temperature);
        params.set_temperature_inc(config.temperature_inc);

        // Filtering thresholds
        params.set_entropy_thold(config.entropy_thold);
        params.set_logprob_thold(config.logprob_thold);
        params.set_no_speech_thold(config.no_speech_thold);

        // Suppression
        params.set_suppress_blank(config.suppress_blank);
        params.set_suppress_nst(config.suppress_nst);

        // Language
        let lang = if config.language == "auto" {
            params.set_detect_language(true);
            None
        } else {
            Some(config.language.as_str())
        };
        params.set_language(lang);

        // Initial prompt for domain vocabulary priming
        if !config.initial_prompt.is_empty() {
            params.set_initial_prompt(&config.initial_prompt);
        }

        // Enable token-level timestamps for real confidence scoring
        params.set_token_timestamps(true);

        // Speaker turn detection (tinydiarize)
        if config.tdrz_enable {
            params.set_tdrz_enable(true);
        }

        state
            .full(params, audio_16k_mono)
            .map_err(|e| format!("Whisper inference failed: {e}"))?;

        let n_segments = state.full_n_segments();

        let mut full_text = String::new();
        let mut segments = Vec::new();
        let mut total_confidence = 0.0f32;
        let mut total_tokens = 0usize;

        for i in 0..n_segments {
            let segment = match state.get_segment(i) {
                Some(seg) => seg,
                None => continue,
            };

            let no_speech_prob = segment.no_speech_probability();

            // Skip segments that are likely silence/noise
            if no_speech_prob > config.no_speech_thold {
                continue;
            }

            let text = segment
                .to_str_lossy()
                .map_err(|e| format!("Failed to get segment {i} text: {e}"))?;

            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }

            // Compute real per-segment confidence from token probabilities
            let n_tokens = segment.n_tokens();
            let mut seg_confidence = 0.0f32;
            let mut token_count = 0usize;

            for t in 0..n_tokens {
                if let Some(token) = segment.get_token(t) {
                    let p = token.token_probability();
                    if p > 0.0 {
                        seg_confidence += p;
                        token_count += 1;
                    }
                }
            }

            let avg_confidence = if token_count > 0 {
                seg_confidence / token_count as f32
            } else {
                0.0
            };

            total_confidence += seg_confidence;
            total_tokens += token_count;

            let t0 = segment.start_timestamp();
            let t1 = segment.end_timestamp();

            if !full_text.is_empty() {
                full_text.push(' ');
            }
            full_text.push_str(trimmed);

            let speaker_turn_next = segment.next_segment_speaker_turn();

            segments.push(TranscriptionSegment {
                text: trimmed.to_string(),
                start_ms: t0 * 10,
                end_ms: t1 * 10,
                confidence: avg_confidence,
                no_speech_prob,
                speaker_turn_next,
            });
        }

        let overall_confidence = if total_tokens > 0 {
            total_confidence / total_tokens as f32
        } else {
            0.0
        };

        Ok(TranscriptionResult {
            text: full_text,
            confidence: overall_confidence,
            segments,
        })
    }
}

/// Managed state for the transcription engine.
pub struct TranscriptionState {
    pub engine: Option<WhisperEngine>,
    pub model: WhisperModel,
    pub config: TranscriptionConfig,
}

impl TranscriptionState {
    pub fn new() -> Self {
        Self {
            engine: None,
            model: WhisperModel::BaseEn,
            config: TranscriptionConfig::default(),
        }
    }

    /// Initialize the engine with a model file.
    pub fn load_model(&mut self, models_dir: &Path) -> Result<(), String> {
        let model_path = models_dir.join(self.model.filename());
        self.engine = Some(WhisperEngine::new(&model_path)?);
        Ok(())
    }
}
