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
    /// When each character of `phonemes` begins and ends (seconds from the start of the audio), if the speech engine said how long each sound was (Kokoro does: it predicts
    /// the length of every phoneme and makes the audio from those lengths). One pair for each character. Without it a word's time is shared among its sounds by weight.
    pub times: Option<Vec<(f32, f32)>>,
}

/// The times of a word's sounds from a request: a list of [start, end] pairs, one for each of the `want` characters of its phonemes, in seconds from the start of the audio, in
/// order and each beginning where the one before ended (to a few thousandths). Anything else is not used, and the word is timed by weight.
pub fn times_of(list: &[serde_json::Value], want: usize) -> Option<Vec<(f32, f32)>> {
    if list.len() != want || want == 0 {
        return None;
    }
    let mut out = Vec::with_capacity(want);
    let mut last_end = 0.0f32;
    for pair in list {
        let p = pair.as_array()?;
        if p.len() != 2 {
            return None;
        }
        let (a, b) = (p[0].as_f64()? as f32, p[1].as_f64()? as f32);
        if !(a.is_finite() && b.is_finite() && a >= 0.0 && b >= a && a >= last_end - 0.002) {
            return None;
        }
        out.push((a, b));
        last_end = b;
    }
    Some(out)
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

/// The shapes of a word whose sounds each have their own time, from those times. A sound that is two shapes (a diphthong) shares its own time between them by weight. A mark
/// that is not a sound (stress, length) has a time too, which goes to the sound after it in the word (the lips begin shaping a stressed vowel before it is heard), or to the
/// one before if none follows. Nothing starts before the shape ahead of it ended, and nothing runs past `cut_ms`, where the next word begins.
fn timed_segments(word: &Word, times: &[(f32, f32)], cut_ms: f32, out: &mut Vec<Seg>) {
    let first = out.len();
    // where marks that have not found a sound yet began and ended
    let mut carried: Option<(f32, f32)> = None;
    for (c, (s, e)) in word.phonemes.chars().zip(times) {
        let floor = out.last().map_or(0.0, |l| l.end_ms);
        let (mut a, b) = ((s * 1000.0).max(floor), (e * 1000.0).min(cut_ms));
        let made = parts(c);
        if made.is_empty() {
            let began = carried.map_or(a, |c0| c0.0);
            carried = Some((began, b.max(carried.map_or(b, |c0| c0.1))));
            continue;
        }
        if let Some((began, _)) = carried.take() {
            a = a.min(began.max(floor)); // the mark's time goes to this sound
        }
        if b <= a {
            continue;
        }
        let total: f32 = made.iter().map(|p| p.0).sum();
        let mut at = a;
        for (weight, shape) in made {
            let next = at + (b - a) * weight / total;
            out.push(Seg { start_ms: at, end_ms: next, shape });
            at = next;
        }
    }
    if let Some((_, ended)) = carried {
        // marks at the end of the word, with no sound after them: the sound before keeps their time
        if out.len() > first {
            if let Some(l) = out.last_mut() {
                l.end_ms = l.end_ms.max(ended.min(cut_ms));
            }
        }
    }
}

/// Every shape of every word, laid on the time line. Words that are out of order or that overlap are put in order and each cut where the next begins.
/// A word that has the time of each of its sounds (`times`) is laid by those times; one that has not has its time shared among its sounds by weight.
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
        if let Some(times) = w.times.as_ref().filter(|t| t.len() == w.phonemes.chars().count()) {
            let cut = sorted.get(i + 1).map_or(f32::INFINITY, |n| n.start * 1000.0);
            timed_segments(w, times, cut, &mut out);
            continue;
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
        Word { start, end, phonemes: phonemes.to_string(), times: None }
    }

    /// A word whose sounds each have their own time (seconds), one pair for each character of `phonemes`.
    fn timed(start: f32, end: f32, phonemes: &str, times: &[(f32, f32)]) -> Word {
        Word { start, end, phonemes: phonemes.to_string(), times: Some(times.to_vec()) }
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

    fn near(a: f32, b: f32) -> bool {
        (a - b).abs() < 0.01
    }

    #[test]
    fn a_sound_is_laid_where_the_speech_engine_says_it_is_not_where_the_weights_would_put_it() {
        // by weight "ma" over 200 ms is about 89 ms of lips (a nasal weighs 1.2) and 111 of vowel (1.5); Kokoro said the lips were 150 ms and the vowel 50
        let by_weight = segments(&[word(0.0, 0.2, "ma")]);
        assert!((by_weight[0].end_ms - 88.9).abs() < 0.2, "{:?}", by_weight[0]);
        let measured = segments(&[timed(0.0, 0.2, "ma", &[(0.0, 0.15), (0.15, 0.2)])]);
        assert_eq!((measured[0].shape, measured[1].shape), ("closed", "open"));
        assert!(near(measured[0].end_ms, 150.0) && near(measured[1].start_ms, 150.0) && near(measured[1].end_ms, 200.0), "{measured:?}");
    }

    #[test]
    fn a_diphthong_shares_its_own_time_between_its_two_shapes() {
        let s = segments(&[timed(0.0, 0.2, "dA", &[(0.0, 0.05), (0.05, 0.2)])]);
        let names: Vec<&str> = s.iter().map(|x| x.shape).collect();
        assert_eq!(names, vec!["small", "mid", "wide"]);
        assert!(near(s[0].end_ms, 50.0) && near(s[1].end_ms, 125.0) && near(s[2].end_ms, 200.0), "{s:?}");
    }

    #[test]
    fn the_time_of_a_stress_mark_goes_to_the_sound_after_it_or_failing_that_the_one_before() {
        // "ˈa": the mark is 20 ms, then the vowel; the lips begin shaping the vowel at the mark
        let s = segments(&[timed(0.0, 0.2, "ˈa", &[(0.0, 0.02), (0.02, 0.2)])]);
        assert_eq!(s.len(), 1);
        assert!(near(s[0].start_ms, 0.0) && near(s[0].end_ms, 200.0), "{s:?}");
        // "aˈ": a mark with nothing after it lengthens the vowel before it
        let end = segments(&[timed(0.0, 0.2, "aˈ", &[(0.0, 0.15), (0.15, 0.2)])]);
        assert_eq!(end.len(), 1);
        assert!(near(end[0].end_ms, 200.0), "{end:?}");
        // "wˈɛ": the mark between two sounds goes to the second, so the first keeps its own time
        let mid = segments(&[timed(0.0, 0.3, "wˈɛ", &[(0.0, 0.1), (0.1, 0.12), (0.12, 0.3)])]);
        assert!(near(mid[0].end_ms, 100.0) && near(mid[1].start_ms, 100.0), "{mid:?}");
    }

    #[test]
    fn times_that_do_not_fit_the_phonemes_are_not_used_and_the_word_is_timed_by_weight() {
        let wrong_count = segments(&[timed(0.0, 0.2, "ma", &[(0.0, 0.15)])]);
        let by_weight = segments(&[word(0.0, 0.2, "ma")]);
        assert_eq!(wrong_count, by_weight);
        assert!(times_of(&[], 0).is_none());
        let good = serde_json::json!([[0.0, 0.1], [0.1, 0.2]]);
        assert_eq!(times_of(good.as_array().unwrap(), 2), Some(vec![(0.0, 0.1), (0.1, 0.2)]));
        for bad in [
            serde_json::json!([[0.0, 0.1]]),                        // too few
            serde_json::json!([[0.0, 0.1], [0.05, 0.2]]),            // starts before the one before ended
            serde_json::json!([[0.0, 0.1], [0.3, 0.2]]),             // ends before it starts
            serde_json::json!([[-1.0, 0.1], [0.1, 0.2]]),            // before the audio
            serde_json::json!([[0.0, 0.1], ["x", 0.2]]),             // not a number
            serde_json::json!([[0.0, 0.1], [0.1]]),                  // not a pair
            serde_json::json!([0.0, 0.1]),                           // not pairs
        ] {
            assert!(times_of(bad.as_array().unwrap(), 2).is_none(), "{bad}");
        }
    }

    #[test]
    fn timed_words_never_overlap_and_the_next_word_cuts_the_one_before() {
        let segs = segments(&[timed(0.0, 0.4, "ma", &[(0.0, 0.1), (0.1, 0.4)]), timed(0.3, 0.5, "ta", &[(0.3, 0.35), (0.35, 0.5)])]);
        assert!(segs.windows(2).all(|w| w[0].end_ms <= w[1].start_ms + 0.01), "{segs:?}");
        assert!(near(segs[1].end_ms, 300.0), "the first word's vowel is cut where the second word begins: {segs:?}");
        let out_of_order = segments(&[timed(2.0, 2.2, "a", &[(2.0, 2.2)]), timed(1.0, 1.2, "o", &[(1.0, 1.2)])]);
        assert_eq!(out_of_order[0].shape, "round");
    }

    #[test]
    fn a_quick_lip_closure_keeps_its_picture_when_the_sound_is_only_thirty_milliseconds_long() {
        // "pa" with the p only 30 ms: the weights would give it 40 ms of a 100 ms word, the speech engine gave it 30
        let segs = segments(&[timed(0.0, 0.2, "pa", &[(0.0, 0.03), (0.03, 0.2)])]);
        let f = frames(&segs, 25, 5);
        assert_eq!(f[0], "closed", "the lips are shut in the first picture");
        assert_eq!(f[1], "open");
    }
}
