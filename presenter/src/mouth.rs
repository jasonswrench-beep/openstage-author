// SPDX-License-Identifier: Apache-2.0
//! Mouth shapes from the sound of a recording: how loud each moment is, and how fast the sound crosses zero, which follows how high-pitched
//! the sound is (a vowel such as "oo" crosses slowly, an "s" quickly). It is a drawing aid, not speech recognition: it needs no words, no language
//! and no model, so it works for any voice. Exact mouth shapes from the speech engine's phonemes are a later, better source for the same track.

use crate::visemes::{self, Word};
use crate::wav::Wav;

/// The shapes, from closed to most open. The editor draws each one.
pub const SHAPES: [&str; 6] = ["closed", "small", "open", "wide", "round", "teeth"];

pub struct Track {
    pub duration_ms: u64,
    pub fps: u32,
    /// Where each run of one shape starts, in milliseconds. The first starts at 0.
    pub runs: Vec<(u64, &'static str)>,
    /// What the shapes follow: "phonemes" (the words the speech engine said, with the sounds it said them with) or "sound" (how loud and how high-pitched).
    pub source: &'static str,
}

/// What one frame of sound looks like: its level in decibels and the rate its sound crosses zero, in cycles per second.
struct Frame {
    db: f32,
    hz: f32,
}

fn frames(wav: &Wav, fps: u32) -> Vec<Frame> {
    let hop = ((wav.rate as f32 / fps as f32).round() as usize).max(8);
    wav.samples
        .chunks(hop)
        .map(|c| {
            let mean = c.iter().map(|x| x * x).sum::<f32>() / c.len() as f32;
            let crossings = c.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count() as f32;
            let seconds = c.len() as f32 / wav.rate as f32;
            Frame { db: 20.0 * mean.sqrt().max(1e-9).log10(), hz: crossings / seconds / 2.0 }
        })
        .collect()
}

/// Which shape a frame of sound gets. `level` is how loud it is between silence and the loudest speech; `rank` is how it compares with the other
/// spoken frames (0 for the quietest, 1 for the loudest), which spreads the shapes out even for a voice that is always loud.
fn pick(f: &Frame, silence_db: f32, loud_db: f32, rank: f32) -> &'static str {
    if f.db <= silence_db {
        return "closed";
    }
    let level = ((f.db - silence_db) / (loud_db - silence_db).max(1.0)).clamp(0.0, 1.0);
    if f.hz >= 1800.0 {
        return if level >= 0.12 { "teeth" } else { "small" };
    }
    if f.hz < 600.0 {
        return if rank >= 0.62 {
            "open"
        } else if rank >= 0.28 {
            "round"
        } else {
            "small"
        };
    }
    if rank >= 0.7 {
        "open"
    } else if rank >= 0.3 {
        "wide"
    } else {
        "small"
    }
}

/// The most common of three neighbours, so one odd frame does not make the mouth flick.
fn steady(shapes: &[&'static str]) -> Vec<&'static str> {
    (0..shapes.len())
        .map(|i| {
            let (a, b, c) = (shapes[i.saturating_sub(1)], shapes[i], shapes[(i + 1).min(shapes.len() - 1)]);
            if a == c && a != b {
                a
            } else {
                b
            }
        })
        .collect()
}

pub fn track(wav: &Wav, fps: u32) -> Track {
    let fps = fps.clamp(5, 60);
    let duration_ms = (wav.samples.len() as u64 * 1000) / wav.rate as u64;
    let all = frames(wav, fps);
    if all.is_empty() {
        return Track { duration_ms, fps, runs: vec![(0, "closed")], source: "sound" };
    }
    let mut sorted: Vec<f32> = all.iter().map(|f| f.db).collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let loud = sorted[((sorted.len() - 1) as f32 * 0.95) as usize];
    let silence = (loud - 30.0).max(-60.0);
    let mut voiced: Vec<f32> = all.iter().map(|f| f.db).filter(|d| *d > silence).collect();
    voiced.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = |db: f32| -> f32 { voiced.partition_point(|x| *x < db) as f32 / voiced.len().max(1) as f32 };
    let raw: Vec<&'static str> = if loud <= -55.0 { vec!["closed"; all.len()] } else { all.iter().map(|f| pick(f, silence, loud, rank(f.db))).collect() };
    let smooth = steady(&raw);
    let mut runs: Vec<(u64, &'static str)> = Vec::new();
    for (i, shape) in smooth.iter().enumerate() {
        if runs.last().map(|r| r.1) != Some(*shape) {
            runs.push((i as u64 * 1000 / fps as u64, *shape));
        }
    }
    Track { duration_ms, fps, runs, source: "sound" }
}

/// Mouth shapes from the words a speech engine said and the phonemes it said them with, kept honest by the sound: wherever the audio is quiet the mouth is closed, and
/// if the sound is not where the words say it should be (the words are for other audio), nothing is made and the caller uses `track`, which follows the sound alone.
pub fn track_with_words(wav: &Wav, fps: u32, words: &[Word]) -> Option<Track> {
    let fps = fps.clamp(5, 60);
    let all = frames(wav, fps);
    if all.is_empty() || words.is_empty() {
        return None;
    }
    let mut sorted: Vec<f32> = all.iter().map(|f| f.db).collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let loud = sorted[((sorted.len() - 1) as f32 * 0.95) as usize];
    if loud <= -55.0 {
        return None;
    }
    let silence = (loud - 30.0).max(-60.0);
    let segs = visemes::segments(words);
    if segs.is_empty() {
        return None;
    }
    // Is the voice where the words say it is? Frames of speech with no word within a tenth of a second mean the words are for something else.
    let step = 1000.0 / fps as f32;
    let (mut voiced, mut matched, mut at) = (0usize, 0usize, 0usize);
    for (i, f) in all.iter().enumerate() {
        if f.db <= silence {
            continue;
        }
        voiced += 1;
        let ms = (i as f32 + 0.5) * step;
        while at < segs.len() && segs[at].end_ms + 100.0 < ms {
            at += 1;
        }
        if at < segs.len() && segs[at].start_ms - 100.0 <= ms {
            matched += 1;
        }
    }
    if voiced == 0 || (matched as f32) / (voiced as f32) < 0.75 {
        return None;
    }
    let shapes = visemes::frames(&segs, fps, all.len());
    let duration_ms = (wav.samples.len() as u64 * 1000) / wav.rate as u64;
    let mut runs: Vec<(u64, &'static str)> = Vec::new();
    for (i, f) in all.iter().enumerate() {
        let shape = if f.db <= silence { "closed" } else { shapes[i] };
        if runs.last().map(|r| r.1) != Some(shape) {
            runs.push((i as u64 * 1000 / fps as u64, shape));
        }
    }
    Some(Track { duration_ms, fps, runs, source: "phonemes" })
}

impl Track {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "durationMs": self.duration_ms,
            "fps": self.fps,
            "shapes": SHAPES,
            "source": self.source,
            "runs": self.runs.iter().map(|(t, s)| serde_json::json!([t, s])).collect::<Vec<_>>(),
        })
    }

    /// The shape showing at a moment.
    #[cfg(test)]
    pub fn at(&self, ms: u64) -> &'static str {
        self.runs.iter().take_while(|r| r.0 <= ms).last().map(|r| r.1).unwrap_or("closed")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wav::{make_pcm16, parse};

    fn tone(hz: f32, amp: f32, seconds: f32, rate: u32) -> Vec<f32> {
        (0..(seconds * rate as f32) as usize).map(|i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / rate as f32).sin()).collect()
    }

    fn noise(amp: f32, seconds: f32, rate: u32) -> Vec<f32> {
        let mut s: u32 = 12345;
        (0..(seconds * rate as f32) as usize)
            .map(|_| {
                s = s.wrapping_mul(1664525).wrapping_add(1013904223);
                amp * ((s >> 8) as f32 / 8_388_608.0 - 1.0)
            })
            .collect()
    }

    fn of(samples: &[f32]) -> Track {
        track(&parse(&make_pcm16(24000, samples)).unwrap(), 25)
    }

    #[test]
    fn silence_is_a_closed_mouth() {
        let t = of(&vec![0.0; 24000]);
        assert_eq!(t.runs, vec![(0, "closed")]);
        assert_eq!(t.duration_ms, 1000);
    }

    #[test]
    fn a_loud_low_sound_opens_the_mouth_and_a_hissing_one_shows_teeth() {
        let mut s = tone(200.0, 0.5, 1.0, 24000);
        s.extend(noise(0.4, 1.0, 24000));
        let t = of(&s);
        assert_eq!(t.at(500), "open");
        assert_eq!(t.at(1500), "teeth");
    }

    #[test]
    fn a_softer_low_sound_rounds_the_lips_and_pauses_close_the_mouth() {
        let mut s = tone(200.0, 0.5, 0.5, 24000);
        s.extend(tone(200.0, 0.15, 0.5, 24000));
        s.extend(tone(200.0, 0.05, 0.5, 24000));
        s.extend(vec![0.0; 12000]);
        s.extend(tone(200.0, 0.5, 0.5, 24000));
        let t = of(&s);
        assert_eq!(t.at(250), "open", "the loudest part of the speech");
        assert_eq!(t.at(750), "round", "a middle level on a low sound");
        assert_eq!(t.at(1250), "small", "the quietest speech");
        assert_eq!(t.at(1750), "closed", "a pause");
        assert_eq!(t.at(2250), "open");
    }

    #[test]
    fn one_odd_frame_does_not_flick_the_mouth() {
        let shapes = ["open", "open", "closed", "open", "open"];
        assert_eq!(steady(&shapes), vec!["open"; 5]);
    }

    #[test]
    fn a_very_quiet_recording_stays_closed_and_the_runs_start_at_zero_and_rise() {
        let t = of(&tone(200.0, 0.0005, 1.0, 24000));
        assert_eq!(t.runs, vec![(0, "closed")]);
        let mut s = tone(200.0, 0.5, 0.3, 24000);
        s.extend(vec![0.0; 7200]);
        s.extend(tone(200.0, 0.5, 0.3, 24000));
        let t = of(&s);
        assert_eq!(t.runs[0].0, 0);
        assert!(t.runs.windows(2).all(|w| w[0].0 < w[1].0 && w[0].1 != w[1].1), "{:?}", t.runs);
    }

    fn word(start: f32, end: f32, phonemes: &str) -> Word {
        Word { start, end, phonemes: phonemes.to_string() }
    }

    #[test]
    fn the_mouth_follows_the_words_where_there_are_some_and_the_sound_keeps_it_honest() {
        // one second of speech, then a pause of half a second, then another second
        let mut s = tone(200.0, 0.5, 1.0, 24000);
        s.extend(vec![0.0; 12000]);
        s.extend(tone(200.0, 0.5, 1.0, 24000));
        let sound = parse(&make_pcm16(24000, &s)).unwrap();
        let words = [word(0.0, 0.5, "ma"), word(0.5, 1.0, "ɑ"), word(1.5, 2.0, "u"), word(2.0, 2.5, "i")];
        let t = track_with_words(&sound, 25, &words).unwrap();
        assert_eq!(t.source, "phonemes");
        assert_eq!(t.at(10), "closed", "the lips of the m");
        assert_eq!(t.at(300), "open", "the vowel");
        assert_eq!(t.at(700), "open");
        assert_eq!(t.at(1250), "closed", "a pause, and the sound agrees");
        assert_eq!(t.at(1700), "round");
        assert_eq!(t.at(2200), "wide");
        assert_eq!(t.runs[0].0, 0);
        assert_eq!(t.duration_ms, 2500);
    }

    #[test]
    fn where_the_sound_is_quiet_the_mouth_is_shut_whatever_the_words_say() {
        let mut s = tone(200.0, 0.5, 0.5, 24000);
        s.extend(vec![0.0; 12000]);
        s.extend(tone(200.0, 0.5, 0.5, 24000));
        let sound = parse(&make_pcm16(24000, &s)).unwrap();
        let t = track_with_words(&sound, 25, &[word(0.0, 1.5, "ɑɑɑɑ")]).unwrap();
        assert_eq!(t.at(750), "closed", "the words go on through a silence the sound does not");
        assert_ne!(t.at(250), "closed");
    }

    #[test]
    fn words_that_are_for_other_audio_are_not_used() {
        let sound = parse(&make_pcm16(24000, &tone(200.0, 0.5, 3.0, 24000))).unwrap();
        assert!(track_with_words(&sound, 25, &[word(0.0, 0.5, "a")]).is_none(), "speech for three seconds, words for half of one");
        assert!(track_with_words(&sound, 25, &[word(5.0, 6.0, "a")]).is_none(), "words after the audio has ended");
        assert!(track_with_words(&sound, 25, &[]).is_none());
        assert!(track_with_words(&sound, 25, &[word(0.0, 3.0, "")]).is_none(), "words with no sounds");
        let silent = parse(&make_pcm16(24000, &vec![0.0; 24000])).unwrap();
        assert!(track_with_words(&silent, 25, &[word(0.0, 1.0, "a")]).is_none());
    }

    #[test]
    fn the_json_says_what_the_shapes_follow() {
        assert_eq!(of(&tone(200.0, 0.5, 0.5, 24000)).to_json()["source"], "sound");
    }

    #[test]
    fn the_json_names_every_shape_and_every_run() {
        let j = of(&tone(200.0, 0.5, 0.5, 24000)).to_json();
        assert_eq!(j["fps"], 25);
        assert_eq!(j["shapes"].as_array().unwrap().len(), 6);
        assert!(j["runs"][0][1].is_string());
    }
}
