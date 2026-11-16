// SPDX-License-Identifier: Apache-2.0
//! Reads a WAV file into mono samples between -1 and 1. Only what narration audio needs: PCM of 8, 16, 24 or 32 bits, or 32 or 64 bit floats,
//! with any number of channels. Anything else is refused with a sentence, never a panic: the bytes come from a file on the author's computer.

/// The most audio read at once (a narration of an hour at 48 kHz in 16 bits is about 350 MB, so this is for a clip, not a lecture).
pub const MAX_BYTES: usize = 300 * 1024 * 1024;

pub struct Wav {
    pub rate: u32,
    pub samples: Vec<f32>,
}

fn u16_at(b: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?))
}

pub fn parse(bytes: &[u8]) -> Result<Wav, String> {
    if bytes.len() > MAX_BYTES {
        return Err("That audio file is too large to read.".into());
    }
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("That is not a WAV audio file.".into());
    }
    let mut at = 12;
    let mut format: Option<(u16, u16, u32, u16)> = None; // tag, channels, rate, bits
    let mut data: Option<&[u8]> = None;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let declared = u32_at(bytes, at + 4).unwrap_or(0) as usize;
        let start = at + 8;
        let end = start.saturating_add(declared).min(bytes.len());
        let body = &bytes[start..end];
        if id == b"fmt " {
            if body.len() < 16 {
                return Err("The audio file's format is cut short.".into());
            }
            let mut tag = u16_at(body, 0).unwrap_or(0);
            if tag == 0xFFFE && body.len() >= 26 {
                tag = u16_at(body, 24).unwrap_or(0); // the extensible format names the real one inside
            }
            format = Some((tag, u16_at(body, 2).unwrap_or(0), u32_at(body, 4).unwrap_or(0), u16_at(body, 14).unwrap_or(0)));
        } else if id == b"data" {
            data = Some(body);
            break;
        }
        at = start.saturating_add(declared).saturating_add(declared & 1);
    }
    let (tag, channels, rate, bits) = format.ok_or("The audio file has no format.")?;
    let data = data.ok_or("The audio file has no sound in it.")?;
    if channels == 0 || channels > 8 {
        return Err("The audio file has an odd number of channels.".into());
    }
    if rate < 4000 || rate > 384_000 {
        return Err("The audio file has an odd sample rate.".into());
    }
    let width = (bits / 8) as usize;
    let ok = matches!((tag, bits), (1, 8) | (1, 16) | (1, 24) | (1, 32) | (3, 32) | (3, 64));
    if !ok {
        return Err(format!("This kind of audio file is not supported (format {tag}, {bits} bits)."));
    }
    let frame = width * channels as usize;
    let frames = data.len() / frame;
    let mut samples = Vec::with_capacity(frames);
    for f in 0..frames {
        let mut sum = 0.0f32;
        for c in 0..channels as usize {
            let o = f * frame + c * width;
            let v = match (tag, bits) {
                (1, 8) => (data[o] as f32 - 128.0) / 128.0,
                (1, 16) => i16::from_le_bytes([data[o], data[o + 1]]) as f32 / 32768.0,
                (1, 24) => (i32::from_le_bytes([0, data[o], data[o + 1], data[o + 2]]) >> 8) as f32 / 8_388_608.0,
                (1, 32) => i32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]) as f32 / 2_147_483_648.0,
                (3, 32) => f32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]),
                _ => f64::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3], data[o + 4], data[o + 5], data[o + 6], data[o + 7]]) as f32,
            };
            sum += if v.is_finite() { v } else { 0.0 };
        }
        samples.push((sum / channels as f32).clamp(-1.0, 1.0));
    }
    Ok(Wav { rate, samples })
}

/// A WAV file of 16-bit mono samples, for the tests.
#[cfg(test)]
pub fn make_pcm16(rate: u32, samples: &[f32]) -> Vec<u8> {
    let data: Vec<u8> = samples.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_16_bit_mono() {
        let wav = parse(&make_pcm16(24000, &[0.0, 0.5, -0.5, 1.0])).unwrap();
        assert_eq!(wav.rate, 24000);
        assert_eq!(wav.samples.len(), 4);
        assert!((wav.samples[1] - 0.5).abs() < 0.001 && (wav.samples[2] + 0.5).abs() < 0.001);
    }

    #[test]
    fn mixes_channels_and_reads_other_widths() {
        // 8-bit stereo: left full, right silent -> half
        let mut b = make_pcm16(8000, &[]);
        b[22] = 2; // channels
        b[34] = 8; // bits
        b.truncate(44);
        b.extend_from_slice(&[255, 128]);
        let n = b.len() as u32 - 8;
        b[4..8].copy_from_slice(&n.to_le_bytes());
        b[40..44].copy_from_slice(&2u32.to_le_bytes());
        let wav = parse(&b).unwrap();
        assert_eq!(wav.samples.len(), 1);
        assert!((wav.samples[0] - 0.4961).abs() < 0.01);
    }

    #[test]
    fn refuses_what_is_not_audio_without_panicking() {
        assert!(parse(b"").is_err());
        assert!(parse(b"RIFF....WAVE").is_err());
        assert!(parse(&[0u8; 100]).is_err());
        let mut cut = make_pcm16(24000, &[0.1; 10]);
        cut.truncate(30);
        assert!(parse(&cut).is_err());
        let mut odd = make_pcm16(24000, &[0.1; 10]);
        odd[34] = 12; // 12 bits
        assert!(parse(&odd).is_err());
    }

    #[test]
    fn a_data_size_that_runs_past_the_file_reads_what_is_there() {
        let mut b = make_pcm16(24000, &[0.25; 10]);
        b[40..44].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        assert_eq!(parse(&b).unwrap().samples.len(), 10);
    }
}
