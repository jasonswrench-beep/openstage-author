// SPDX-License-Identifier: Apache-2.0
//! Mouth shapes from the words a speech engine said, each with the phonemes it said it with and when it started and ended. A word's time is shared among its
//! phonemes by weight (a vowel is held longer than a consonant), each phoneme is a mouth shape, and each picture of the clip gets the shape that most of it shows,
//! with a lean toward the shapes that are easy to miss and show most when they are missing: lips together for p, b and m, and teeth for f, v and s. The eleven shapes
//! and what each is for are listed with `mouth::SHAPES`.
//!
//! The phonemes are written as the engine writes them. Kokoro's are IPA with a few single capital letters for diphthongs (A for "ay" as in "day", I for "eye",
//! O for "oh", W for "ow", Y for "oy", Q for the British "oh"); stress and length marks are skipped. A symbol that is not known is skipped, never guessed.

pub struct Word {
    /// Seconds from the start of the audio.
    pub start: f32,
    pub end: f32,
    pub phonemes: String,
}

/// One mouth shape, held for a stretch of the audio.
#[derive(Debug, Clone, PartialEq)]
pub struct Seg {
    pub start_ms: f32,
    pub end_ms: f32,
    pub shape: &'static str,
}

/// A mouth shape and how long it is held, compared with the others in its word.
type Part = (f32, &'static str);

// How long each kind of sound is held, compared with the others in its word. Measured on a real voice (the Windows one, which reports every phoneme's own length): a vowel and
// a liquid or nasal last about the same, a fricative longer, a stop shorter. A vowel is a little longer here, because a neural voice holds the vowels it stresses.
const VOWEL: f32 = 1.5;
const HALF_VOWEL: f32 = 0.9;
const SONORANT: f32 = 1.2;
const FRICATIVE: f32 = 1.6;
const STOP: f32 = 0.9;

/// The parts one phoneme is made of (a diphthong has two), or nothing for a mark that is not a sound.
fn parts(c: char) -> &'static [Part] {
    match c {
        // lips together
        'p' | 'b' => &[(STOP, "closed")],
        'm' => &[(SONORANT, "closed")],
        // the upper teeth on the lower lip
        'f' | 'v' => &[(FRICATIVE, "fv")],
        // the teeth together, the lips apart
        's' | 'z' => &[(FRICATIVE, "teeth")],
        // the tongue showing: between the teeth for th, behind the upper ones for l
        'θ' | 'ð' => &[(FRICATIVE, "tongue")],
        'l' | 'ɫ' | 'ɭ' | 'ʎ' => &[(SONORANT, "tongue")],
        // lips pushed forward, the teeth close
        'ʃ' | 'ʒ' | 'ʧ' | 'ʤ' => &[(FRICATIVE, "sh")],
        // lips pushed forward and small
        'w' | 'ɥ' => &[(SONORANT, "pucker")],
        // the tongue and the back of the mouth: a small opening
        't' | 'd' | 'k' | 'g' | 'ɡ' | 'ʔ' | 'c' | 'q' => &[(STOP, "small")],
        'n' | 'r' | 'ɹ' | 'ɾ' | 'ɻ' | 'ŋ' | 'j' | 'ɲ' | 'ɳ' | 'ʁ' | 'ʀ' => &[(SONORANT, "small")],
        'h' | 'x' | 'ɣ' | 'ç' => &[(FRICATIVE, "small")],
        // vowels with the mouth open wide
        'ɑ' | 'a' | 'ɐ' | 'ɒ' | 'ɶ' => &[(VOWEL, "open")],
        // vowels with the mouth half open
        'æ' | 'ɛ' | 'ʌ' => &[(VOWEL, "mid")],
        // vowels with the lips spread
        'e' | 'i' | 'ɪ' | 'ᵻ' | 'y' | 'ɨ' | 'ɩ' => &[(VOWEL, "wide")],
        // vowels with the lips rounded into an "o"
        'ɔ' | 'o' | 'ɵ' | 'ø' | 'œ' => &[(VOWEL, "round")],
        // vowels with the lips pushed forward and small
        'u' | 'ʊ' | 'ʉ' | 'ɯ' => &[(VOWEL, "pucker")],
        // the neutral vowel and the r-coloured ones
        'ə' | 'ɚ' | 'ɝ' | 'ᵊ' | 'ɜ' | 'ɘ' => &[(VOWEL, "small")],
        // Kokoro's diphthongs, each a move from one shape to another
        'A' => &[(HALF_VOWEL, "mid"), (HALF_VOWEL, "wide")],
        'I' => &[(HALF_VOWEL, "open"), (HALF_VOWEL, "wide")],
        'O' => &[(HALF_VOWEL, "round"), (HALF_VOWEL, "pucker")],
        'Q' => &[(HALF_VOWEL, "small"), (HALF_VOWEL, "pucker")],
        'W' => &[(HALF_VOWEL, "open"), (HALF_VOWEL, "pucker")],
        'Y' => &[(HALF_VOWEL, "round"), (HALF_VOWEL, "wide")],
        _ => &[],
    }
}

/// The shapes a word's phonemes make, in order, each with its weight.
pub fn shapes_of(phonemes: &str) -> Vec<Part> {
    phonemes.chars().flat_map(|c| parts(c).iter().copied()).collect()
}

/// Every shape of every word, laid on the time line. Words that are out of order or that overlap are put in order and each cut where the next begins.
pub fn segments(words: &[Word]) -> Vec<Seg> {
    let mut sorted: Vec<&Word> = words.iter().collect();
    sorted.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    for (i, w) in sorted.iter().enumerate() {
        let start = w.start * 1000.0;
        let mut end = w.end * 1000.0;
        if let Some(next) = sorted.get(i + 1) {
            end = end.min(next.start * 1000.0);
        }
        let shapes = shapes_of(&w.phonemes);
        let total: f32 = shapes.iter().map(|p| p.0).sum();
        if shapes.is_empty() || total <= 0.0 || end <= start {
            continue;
        }
        let mut at = start;
        for (weight, shape) in shapes {
            let next = at + (end - start) * weight / total;
            out.push(Seg { start_ms: at, end_ms: next, shape });
            at = next;
        }
    }
    out
}

/// How much each shape is favoured when a picture shows two of them for much the same time: the ones that are missed most when they are missing.
fn lean(shape: &str) -> f32 {
    match shape {
        "closed" => 1.7,
        "teeth" | "fv" => 1.25,
        "tongue" => 1.15,
        "round" | "pucker" | "sh" => 1.1,
        _ => 1.0,
    }
}

/// A pause longer than this closes the mouth; a shorter gap between words leaves it a little open.
const PAUSE_MS: f32 = 120.0;

/// The shape of each picture of a clip `frames` long at `fps` pictures a second.
pub fn frames(segs: &[Seg], fps: u32, frames: usize) -> Vec<&'static str> {
    let step = 1000.0 / fps as f32;
    let mut at = 0;
    (0..frames)
        .map(|f| {
            let (t0, t1) = (f as f32 * step, (f + 1) as f32 * step);
            while at < segs.len() && segs[at].end_ms <= t0 {
                at += 1;
            }
            let mut score = [0.0f32; crate::mouth::SHAPES.len()];
            let mut covered = 0.0;
            let mut i = at.min(segs.len());
            while i < segs.len() && segs[i].start_ms < t1 {
                let overlap = (segs[i].end_ms.min(t1) - segs[i].start_ms.max(t0)).max(0.0);
                covered += overlap;
                if let Some(k) = crate::mouth::SHAPES.iter().position(|s| *s == segs[i].shape) {
                    score[k] += overlap * lean(segs[i].shape);
                }
                i += 1;
            }
            if covered >= step * 0.5 {
                let best = (0..crate::mouth::SHAPES.len()).max_by(|a, b| score[*a].partial_cmp(&score[*b]).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(0);
                return crate::mouth::SHAPES[best];
            }
            // between words: a pause shuts the mouth, a short gap leaves it a little open
            let prev = segs[..at.min(segs.len())].last().map(|s| s.end_ms);
            let next = segs.get(at).map(|s| s.start_ms);
            match (prev, next) {
                (Some(p), Some(n)) if n - p < PAUSE_MS => "small",
                _ => "closed",
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(start: f32, end: f32, phonemes: &str) -> Word {
        Word { start, end, phonemes: phonemes.to_string() }
    }

    #[test]
    fn a_word_is_a_run_of_shapes_and_marks_that_are_not_sounds_are_skipped() {
        let names: Vec<&str> = shapes_of("wˈɛlkəm").iter().map(|p| p.1).collect();
        assert_eq!(names, vec!["pucker", "mid", "tongue", "small", "small", "closed"]);
        assert_eq!(shapes_of("ˈˌː .-'").len(), 0, "stress, length and spacing are not sounds");
        assert_eq!(shapes_of("§¶ø").len(), 1, "a symbol that is not known is skipped, never guessed");
        assert!(shapes_of("").is_empty());
    }

    #[test]
    fn a_diphthong_is_two_shapes_and_a_vowel_is_held_longer_than_a_consonant() {
        let day: Vec<&str> = shapes_of("dA").iter().map(|p| p.1).collect();
        assert_eq!(day, vec!["small", "mid", "wide"]);
        let out: Vec<&str> = shapes_of("W").iter().map(|p| p.1).collect();
        assert_eq!(out, vec!["open", "pucker"]);
        let parts = shapes_of("ma");
        assert!(parts[1].0 > parts[0].0, "the vowel outweighs the lips");
    }

    #[test]
    fn a_words_time_is_shared_by_weight_and_runs_end_where_the_next_word_begins() {
        let segs = segments(&[word(1.0, 1.4, "ma"), word(1.3, 1.8, "ta")]);
        assert_eq!(segs[0].shape, "closed");
        assert!((segs[0].start_ms - 1000.0).abs() < 0.01);
        let first_end = segs[1].end_ms;
        assert!((first_end - 1300.0).abs() < 0.01, "the first word is cut where the second begins: {first_end}");
        assert!(segs.windows(2).all(|w| w[0].end_ms <= w[1].start_ms + 0.01), "never overlapping");
        let out_of_order = segments(&[word(2.0, 2.2, "a"), word(1.0, 1.2, "o")]);
        assert_eq!(out_of_order[0].shape, "round");
        assert!(segments(&[word(1.0, 1.0, "a"), word(2.0, 1.0, "a"), word(1.0, 2.0, "")]).is_empty(), "a word with no time or no sounds makes nothing");
    }

    #[test]
    fn lips_together_are_not_lost_to_the_vowel_next_to_them() {
        // "ma" over 100 ms: 40 ms of lips, 60 ms of open mouth. At 25 pictures a second the first picture (0 to 40 ms) is lips.
        let segs = segments(&[word(0.0, 0.1, "ma")]);
        let f = frames(&segs, 25, 3);
        assert_eq!(f[0], "closed");
        assert_eq!(f[1], "open");
        // a picture that is half lips and half vowel keeps the lips
        let blend = segments(&[word(0.0, 0.1, "ma")]);
        assert_eq!(frames(&blend, 50, 2)[0], "closed");
    }

    #[test]
    fn a_pause_shuts_the_mouth_and_a_short_gap_does_not() {
        let apart = segments(&[word(0.0, 0.2, "a"), word(0.7, 0.9, "a")]);
        let f = frames(&apart, 25, 23);
        assert_eq!(f[2], "open");
        assert_eq!(f[10], "closed", "half a second of quiet");
        let near = segments(&[word(0.0, 0.2, "a"), word(0.28, 0.5, "a")]);
        assert_eq!(frames(&near, 25, 12)[6], "small", "eighty milliseconds between words");
        assert_eq!(frames(&near, 25, 20)[19], "closed", "and after the last word");
        assert_eq!(frames(&[], 25, 3), vec!["closed"; 3]);
    }

    #[test]
    fn every_shape_the_editor_draws_can_come_out() {
        // one sound for each shape, half a second apiece: open, mid, wide, round, pucker, small, teeth, fv, tongue, sh, closed
        let sounds = ["ɑ", "ɛ", "i", "o", "u", "ə", "s", "f", "l", "ʃ", "m"];
        let words: Vec<Word> = sounds.iter().enumerate().map(|(i, p)| word(i as f32 * 0.5, i as f32 * 0.5 + 0.5, p)).collect();
        let all = segments(&words);
        let f: std::collections::BTreeSet<&str> = frames(&all, 25, sounds.len() * 12 + 1).into_iter().collect();
        assert_eq!(f.len(), crate::mouth::SHAPES.len(), "{f:?}");
        for shape in crate::mouth::SHAPES {
            assert!(f.contains(shape), "{shape} never comes out");
        }
    }

    #[test]
    fn every_sound_makes_a_shape_that_exists() {
        for c in "pbmfvszθðlɫɭʎʃʒʧʤwɥtdkgɡʔcqnrɹɾɻŋjɲɳʁʀhxɣçɑaɐɒɶæɛʌeiɪᵻyɨɩɔoɵøœuʊʉɯəɚɝᵊɜɘAIOQWY".chars() {
            let made = shapes_of(&c.to_string());
            assert!(!made.is_empty(), "{c} makes nothing");
            for (weight, shape) in made {
                assert!(weight > 0.0 && crate::mouth::SHAPES.contains(&shape), "{c} makes {shape}");
            }
        }
    }

    #[test]
    fn the_lips_and_the_teeth_and_the_tongue_are_not_lost_to_the_vowel_next_to_them() {
        // "fa", "la" and "ʃa" over 100 ms: 40 ms for the consonant (a fricative a little more), then the vowel. The first picture at 25 a second keeps the consonant.
        for (word_, shape) in [("fa", "fv"), ("la", "tongue"), ("ʃa", "sh"), ("ma", "closed")] {
            let segs = segments(&[word(0.0, 0.1, word_)]);
            let f = frames(&segs, 25, 3);
            assert_eq!(f[0], shape, "{word_}");
            assert_eq!(f[1], "open", "{word_}");
        }
    }
}
