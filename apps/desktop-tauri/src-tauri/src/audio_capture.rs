use screencapturekit::prelude::*;
use std::sync::{Arc, Mutex};

const SCK_SAMPLE_RATE: u32 = 48000;
const SCK_CHANNEL_COUNT: u32 = 2;
const CHUNK_DURATION_SECS: f64 = 5.0;

/// Accumulated PCM samples from ScreenCaptureKit callbacks.
/// SCK delivers audio asynchronously; we buffer until a 5-second chunk is ready.
pub struct AudioAccumulator {
    buffer: Vec<f32>,
    sample_rate: u32,
    channel_count: u32,
}

impl AudioAccumulator {
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            sample_rate: SCK_SAMPLE_RATE,
            channel_count: SCK_CHANNEL_COUNT,
        }
    }

    /// Append raw PCM f32 samples from a CMSampleBuffer.
    pub fn push_samples(&mut self, samples: &[f32]) {
        self.buffer.extend_from_slice(samples);
    }

    /// Drain all accumulated samples and return them.
    pub fn drain(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.buffer)
    }

    /// Number of seconds of audio currently buffered.
    pub fn buffered_seconds(&self) -> f64 {
        let samples_per_second = self.sample_rate as f64 * self.channel_count as f64;
        if samples_per_second == 0.0 {
            return 0.0;
        }
        self.buffer.len() as f64 / samples_per_second
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn channel_count(&self) -> u32 {
        self.channel_count
    }
}

/// ScreenCaptureKit stream configuration for audio-only capture.
///
/// SCK requires a screen output even for audio-only. We set minimum_frame_interval
/// very high to suppress video frames while capturing full-quality audio.
pub fn create_audio_stream_config() -> SCStreamConfiguration {
    let slow_frame_interval = CMTime::new(1, 1); // 1 fps minimum
    SCStreamConfiguration::new()
        .with_captures_audio(true)
        .with_sample_rate(SCK_SAMPLE_RATE as i32)
        .with_channel_count(SCK_CHANNEL_COUNT as i32)
        .with_excludes_current_process_audio(true)
        .with_width(2)
        .with_height(2)
        .with_minimum_frame_interval(&slow_frame_interval)
}

/// Create a content filter that captures all desktop audio.
///
/// Uses a display-wide filter with no app exclusions.
pub fn create_desktop_audio_filter() -> Result<SCContentFilter, String> {
    let content = SCShareableContent::get()
        .map_err(|e| format!("Failed to get shareable content: {e}"))?;

    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or_else(|| "No displays found".to_string())?;

    Ok(SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build())
}

/// Start the ScreenCaptureKit stream and a background thread that drains
/// accumulated audio every CHUNK_DURATION_SECS and emits Tauri events.
pub fn start_system_capture(
    accumulator: Arc<Mutex<AudioAccumulator>>,
) -> Result<SCStream, String> {
    let filter = create_desktop_audio_filter()?;
    let config = create_audio_stream_config();

    let mut stream = SCStream::new(&filter, &config);

    // Audio output handler — extracts f32 PCM from CMSampleBuffer
    let acc = accumulator.clone();
    stream.add_output_handler(
        move |sample: CMSampleBuffer, of_type: SCStreamOutputType| {
            if of_type != SCStreamOutputType::Audio {
                return;
            }

            if let Some(audio_list) = sample.audio_buffer_list() {
                for buf_ref in &audio_list {
                    let bytes = buf_ref.data();
                    if bytes.is_empty() {
                        continue;
                    }
                    // SCK delivers f32 PCM interleaved
                    let samples: Vec<f32> = bytes
                        .chunks_exact(4)
                        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                        .collect();

                    if let Ok(mut guard) = acc.lock() {
                        guard.push_samples(&samples);
                    }
                }
            }
        },
        SCStreamOutputType::Audio,
    );

    stream
        .start_capture()
        .map_err(|e| format!("Failed to start capture: {e}"))?;

    Ok(stream)
}

/// Managed state for the running capture stream.
pub struct CaptureState {
    pub stream: Option<SCStream>,
    pub accumulator: Arc<Mutex<AudioAccumulator>>,
    pub is_capturing: bool,
    pub meeting_id: Option<String>,
    pub source: String,
    pub sequence: u32,
    pub start_epoch_ms: u64,
}

impl CaptureState {
    pub fn new() -> Self {
        Self {
            stream: None,
            accumulator: Arc::new(Mutex::new(AudioAccumulator::new())),
            is_capturing: false,
            meeting_id: None,
            source: "system".to_string(),
            sequence: 0,
            start_epoch_ms: 0,
        }
    }

    /// Check if enough audio has accumulated for a chunk and drain it.
    pub fn try_drain_chunk(&mut self) -> Option<(Vec<f32>, u32, u32, u32)> {
        let acc = self.accumulator.lock().ok()?;
        if acc.buffered_seconds() < CHUNK_DURATION_SECS {
            return None;
        }
        let sr = acc.sample_rate();
        let ch = acc.channel_count();
        drop(acc);

        let mut acc = self.accumulator.lock().ok()?;
        let samples = acc.drain();
        let seq = self.sequence;
        self.sequence += 1;
        Some((samples, seq, sr, ch))
    }
}
