/// Resample audio from source sample rate to 16kHz mono for whisper.cpp.
///
/// ScreenCaptureKit outputs 48kHz stereo. whisper.cpp requires 16kHz mono f32.
/// Uses the rubato crate for high-quality sinc resampling.

use rubato::{SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction, Resampler};

const WHISPER_SAMPLE_RATE: usize = 16000;

/// Convert interleaved stereo to mono by averaging channels.
pub fn stereo_to_mono(interleaved: &[f32], channel_count: u32) -> Vec<f32> {
    if channel_count == 1 {
        return interleaved.to_vec();
    }

    let ch = channel_count as usize;
    let frame_count = interleaved.len() / ch;
    let mut mono = Vec::with_capacity(frame_count);

    for i in 0..frame_count {
        let mut sum = 0.0f32;
        for c in 0..ch {
            sum += interleaved[i * ch + c];
        }
        mono.push(sum / ch as f32);
    }

    mono
}

/// Resample mono audio from `source_rate` to 16kHz using sinc interpolation.
///
/// Returns 16kHz mono f32 samples ready for whisper.cpp.
pub fn resample_to_16k(mono_samples: &[f32], source_rate: u32) -> Result<Vec<f32>, String> {
    let source = source_rate as usize;

    if source == WHISPER_SAMPLE_RATE {
        return Ok(mono_samples.to_vec());
    }

    if mono_samples.is_empty() {
        return Ok(Vec::new());
    }

    // Tuned for speech: shorter filter is faster with minimal quality loss
    let params = SincInterpolationParameters {
        sinc_len: 64,
        f_cutoff: 0.92,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 128,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = WHISPER_SAMPLE_RATE as f64 / source as f64;
    let chunk_size = source; // 1 second of input

    let mut resampler = SincFixedIn::<f32>::new(
        ratio,
        2.0, // max relative output size
        params,
        chunk_size,
        1, // mono
    )
    .map_err(|e| format!("Failed to create resampler: {e}"))?;

    let mut output = Vec::new();
    let mut offset = 0;

    while offset < mono_samples.len() {
        let end = (offset + chunk_size).min(mono_samples.len());
        let mut chunk = mono_samples[offset..end].to_vec();

        // Pad last chunk to full size
        if chunk.len() < chunk_size {
            chunk.resize(chunk_size, 0.0);
        }

        let input = vec![chunk];
        let resampled = resampler
            .process(&input, None)
            .map_err(|e| format!("Resample error: {e}"))?;

        if let Some(channel) = resampled.first() {
            output.extend_from_slice(channel);
        }

        offset += chunk_size;
    }

    Ok(output)
}

/// Full pipeline: interleaved multi-channel at source_rate → 16kHz mono f32.
pub fn prepare_for_whisper(
    interleaved: &[f32],
    source_rate: u32,
    channel_count: u32,
) -> Result<Vec<f32>, String> {
    let mono = stereo_to_mono(interleaved, channel_count);
    resample_to_16k(&mono, source_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stereo_to_mono_averages_channels() {
        let stereo = vec![0.5, -0.5, 1.0, 0.0, 0.2, 0.8];
        let mono = stereo_to_mono(&stereo, 2);
        assert_eq!(mono.len(), 3);
        assert!((mono[0] - 0.0).abs() < f32::EPSILON);
        assert!((mono[1] - 0.5).abs() < f32::EPSILON);
        assert!((mono[2] - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn mono_passthrough() {
        let input = vec![0.1, 0.2, 0.3];
        let output = stereo_to_mono(&input, 1);
        assert_eq!(input, output);
    }

    #[test]
    fn resample_already_16k_is_passthrough() {
        let input = vec![0.1; 16000];
        let output = resample_to_16k(&input, 16000).unwrap();
        assert_eq!(input, output);
    }

    #[test]
    fn resample_48k_to_16k_reduces_length() {
        let input = vec![0.1; 48000]; // 1 second at 48kHz
        let output = resample_to_16k(&input, 48000).unwrap();
        // Should be approximately 16000 samples (1 second at 16kHz)
        let ratio = output.len() as f64 / 16000.0;
        assert!(ratio > 0.9 && ratio < 1.1, "Expected ~16000 samples, got {}", output.len());
    }

    #[test]
    fn empty_input_returns_empty() {
        let output = resample_to_16k(&[], 48000).unwrap();
        assert!(output.is_empty());
    }
}
