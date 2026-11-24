// SPDX-License-Identifier: Apache-2.0
//! openstage-presenter: the engine host of the OpenStage Presenter add-on.
//!
//! OpenStage Author starts it, writes one request on its standard input, and reads the answer from its standard output (docs/presenter.md):
//!
//!   request   {"id": 1, "command": "presenter.check", "params": {}}
//!   answer    {"id": 1, "event": "progress", ...}   (none or more)
//!             {"id": 1, "result": {...}}  or  {"id": 1, "error": {"code": "...", "message": "..."}}
//!
//! One request, then the program ends, so a crash or a slow job never takes the editor down. What it prints on its standard error is for a person.

mod check;
mod mouth;
mod presenters;
mod visemes;
mod wav;

use serde_json::{json, Value};
use std::io::{Read, Write};

const VERSION: &str = env!("CARGO_PKG_VERSION");
/// The longest request read (the editor sends a short one).
const MAX_REQUEST: u64 = 1024 * 1024;

fn fail(code: &str, message: impl Into<String>) -> Value {
    json!({ "error": { "code": code, "message": message.into() } })
}

fn hello() -> Value {
    json!({ "name": "OpenStage Presenter", "version": VERSION, "protocol": 1, "tiers": ["lite"] })
}

/// The most words taken from a request, and the longest string of phonemes for one.
const MAX_WORDS: usize = 50_000;
const MAX_PHONEMES: usize = 100;

/// The words in a request, each with when it began and ended (in seconds) and the phonemes it was said with. One that is not whole is left out.
fn words_of(params: &Value) -> Vec<visemes::Word> {
    let Some(list) = params["words"].as_array() else { return Vec::new() };
    list.iter()
        .take(MAX_WORDS)
        .filter_map(|w| {
            let (start, end) = (w["start"].as_f64()? as f32, w["end"].as_f64()? as f32);
            let phonemes = w["phonemes"].as_str()?;
            // the time of each sound, if the speech engine gave them and they fit (a word with times that do not fit is timed by weight, not left out)
            let times = w["times"].as_array().and_then(|list| visemes::times_of(list, phonemes.chars().count()));
            (start.is_finite() && end.is_finite() && start >= 0.0 && end >= start && !phonemes.trim().is_empty() && phonemes.chars().count() <= MAX_PHONEMES)
                .then(|| visemes::Word { start, end, phonemes: phonemes.to_string(), times })
        })
        .collect()
}

/// The mouth shapes of a recording: `params.wav` is the path of a WAV file, `params.fps` how many pictures a second the clip will have, and `params.words` (optional) the
/// words the speech engine said with the phonemes of each, and (optional, for each word) `times`: when each sound of it began and ended. With words that fit the sound, the
/// shapes follow the words (`timing` says whether each sound was laid by its own time, "measured", or the word's time was shared among its sounds, "estimated"); without
/// words, they follow the sound (`timing` is "none").
fn mouth_track(params: &Value) -> Result<Value, Value> {
    let path = params["wav"].as_str().ok_or_else(|| fail("bad-request", "Say which audio file to listen to (wav)."))?;
    let fps = params["fps"].as_u64().unwrap_or(25) as u32;
    let meta = std::fs::metadata(path).map_err(|e| fail("no-audio", format!("The audio file could not be opened: {e}")))?;
    if !meta.is_file() || meta.len() as usize > wav::MAX_BYTES {
        return Err(fail("no-audio", "That is not an audio file this program can read."));
    }
    let bytes = std::fs::read(path).map_err(|e| fail("no-audio", format!("The audio file could not be read: {e}")))?;
    let sound = wav::parse(&bytes).map_err(|why| fail("bad-audio", why))?;
    let words = words_of(params);
    let track = mouth::track_with_words(&sound, fps, &words).unwrap_or_else(|| mouth::track(&sound, fps));
    Ok(track.to_json())
}

/// Answers one request as the JSON the editor reads.
pub fn answer(request: &Value) -> Value {
    let id = request["id"].clone();
    let command = request["command"].as_str().unwrap_or("");
    let params = &request["params"];
    let outcome = match command {
        "presenter.hello" => Ok(hello()),
        "presenter.check" => Ok(check::run()),
        "presenter.presenters" => Ok(json!({ "presenters": presenters::list() })),
        "presenter.mouthTrack" => mouth_track(params),
        "" => Err(fail("bad-request", "The request names no command.")),
        other => Err(fail("unknown-command", format!("This version of the add-on has no command {other}."))),
    };
    let mut line = match outcome {
        Ok(result) => json!({ "result": result }),
        Err(error) => error,
    };
    line["id"] = id;
    line
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("openstage-presenter {VERSION}");
        return;
    }
    let mut text = String::new();
    if std::io::stdin().take(MAX_REQUEST + 1).read_to_string(&mut text).is_err() || text.len() as u64 > MAX_REQUEST {
        println!("{}", fail("bad-request", "The request could not be read, or is too long."));
        return;
    }
    let reply = match serde_json::from_str::<Value>(text.lines().next().unwrap_or("")) {
        Ok(request) => answer(&request),
        Err(e) => fail("bad-request", format!("The request is not JSON: {e}")),
    };
    let out = std::io::stdout();
    let mut out = out.lock();
    let _ = writeln!(out, "{reply}");
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_says_what_this_is() {
        let r = answer(&json!({ "id": 7, "command": "presenter.hello", "params": {} }));
        assert_eq!(r["id"], 7);
        assert_eq!(r["result"]["name"], "OpenStage Presenter");
        assert_eq!(r["result"]["protocol"], 1);
    }

    #[test]
    fn the_other_commands_answer_with_a_result() {
        assert!(answer(&json!({ "id": 1, "command": "presenter.check" }))["result"]["tiers"].is_array());
        assert_eq!(answer(&json!({ "id": 2, "command": "presenter.presenters" }))["result"]["presenters"].as_array().unwrap().len(), 4);
    }

    #[test]
    fn a_request_that_is_wrong_gets_an_error_with_its_id_and_never_a_crash() {
        for (request, code) in [
            (json!({ "id": 3, "command": "presenter.nope" }), "unknown-command"),
            (json!({ "id": 4 }), "bad-request"),
            (json!({ "id": 5, "command": "presenter.mouthTrack", "params": {} }), "bad-request"),
            (json!({ "id": 6, "command": "presenter.mouthTrack", "params": { "wav": "no/such/file.wav" } }), "no-audio"),
        ] {
            let r = answer(&request);
            assert_eq!(r["error"]["code"], code, "{request}");
            assert_eq!(r["id"], request["id"]);
            assert!(r["error"]["message"].as_str().unwrap().len() > 10);
        }
    }

    #[test]
    fn words_in_the_request_are_read_and_a_word_that_is_not_whole_is_left_out() {
        let p = json!({ "words": [
            { "start": 0.0, "end": 0.5, "phonemes": "ma" }, { "start": 0.5, "end": 0.2, "phonemes": "a" }, { "start": -1, "end": 1, "phonemes": "a" },
            { "start": 0, "end": 1, "phonemes": " " }, { "start": 0, "end": 1 }, { "start": "0", "end": 1, "phonemes": "a" }, { "start": 0, "end": 1, "phonemes": "a".repeat(101) }, 7, null ] });
        let w = words_of(&p);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].phonemes, "ma");
        assert!(words_of(&json!({})).is_empty());
        assert!(words_of(&json!({ "words": "no" })).is_empty());
    }

    #[test]
    fn the_time_of_each_sound_is_read_when_it_fits_and_a_word_whose_times_do_not_fit_is_kept_without_them() {
        let p = json!({ "words": [
            { "start": 0.0, "end": 0.5, "phonemes": "ma", "times": [[0.0, 0.2], [0.2, 0.5]] },
            { "start": 0.5, "end": 1.0, "phonemes": "ta", "times": [[0.5, 0.6]] },                    // one pair for two sounds
            { "start": 1.0, "end": 1.5, "phonemes": "ka", "times": [[1.0, 1.2], [1.1, 1.5]] },         // the second begins before the first ended
            { "start": 1.5, "end": 2.0, "phonemes": "pa" },                                           // none given
        ] });
        let w = words_of(&p);
        assert_eq!(w.len(), 4, "no word is left out for its times");
        assert_eq!(w[0].times, Some(vec![(0.0, 0.2), (0.2, 0.5)]));
        assert!(w[1].times.is_none() && w[2].times.is_none() && w[3].times.is_none());
    }

    #[test]
    fn the_answer_says_whether_the_sounds_were_timed_one_by_one() {
        let samples: Vec<f32> = (0..24000).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 200.0 * i as f32 / 24000.0).sin()).collect();
        let dir = std::env::temp_dir().join(format!("openstage-presenter-timing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("a.wav");
        std::fs::write(&wav, crate::wav::make_pcm16(24000, &samples)).unwrap();
        let wav = wav.to_string_lossy().to_string();
        let each = answer(&json!({ "id": 1, "command": "presenter.mouthTrack", "params": { "wav": wav, "words": [{ "start": 0.0, "end": 1.0, "phonemes": "ma", "times": [[0.0, 0.3], [0.3, 1.0]] }] } }));
        assert_eq!((each["result"]["source"].as_str(), each["result"]["timing"].as_str()), (Some("phonemes"), Some("measured")));
        let by_word = answer(&json!({ "id": 2, "command": "presenter.mouthTrack", "params": { "wav": wav, "words": [{ "start": 0.0, "end": 1.0, "phonemes": "ma" }] } }));
        assert_eq!(by_word["result"]["timing"], "estimated");
        let sound = answer(&json!({ "id": 3, "command": "presenter.mouthTrack", "params": { "wav": wav } }));
        assert_eq!((sound["result"]["source"].as_str(), sound["result"]["timing"].as_str()), (Some("sound"), Some("none")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_request_with_words_that_fit_follows_the_words_and_one_with_words_that_do_not_follows_the_sound() {
        let samples: Vec<f32> = (0..24000).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 200.0 * i as f32 / 24000.0).sin()).collect();
        let dir = std::env::temp_dir().join(format!("openstage-presenter-words-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("tone.wav");
        std::fs::write(&file, wav::make_pcm16(24000, &samples)).unwrap();
        let wav = file.to_string_lossy().to_string();
        let fits = answer(&json!({ "id": 1, "command": "presenter.mouthTrack", "params": { "wav": wav, "words": [{ "start": 0.0, "end": 1.0, "phonemes": "ma" }] } }));
        assert_eq!(fits["result"]["source"], "phonemes");
        assert_eq!(fits["result"]["runs"][0][1], "closed", "it starts with the lips of the m");
        let other = answer(&json!({ "id": 2, "command": "presenter.mouthTrack", "params": { "wav": wav, "words": [{ "start": 5.0, "end": 6.0, "phonemes": "ma" }] } }));
        assert_eq!(other["result"]["source"], "sound");
        let none = answer(&json!({ "id": 3, "command": "presenter.mouthTrack", "params": { "wav": wav } }));
        assert_eq!(none["result"]["source"], "sound");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_mouth_track_of_a_real_file_comes_back() {
        let samples: Vec<f32> = (0..24000).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 200.0 * i as f32 / 24000.0).sin()).collect();
        let dir = std::env::temp_dir().join(format!("openstage-presenter-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("tone.wav");
        std::fs::write(&file, wav::make_pcm16(24000, &samples)).unwrap();
        let r = answer(&json!({ "id": 9, "command": "presenter.mouthTrack", "params": { "wav": file.to_string_lossy(), "fps": 25 } }));
        assert_eq!(r["result"]["durationMs"], 1000);
        assert_eq!(r["result"]["runs"][0][0], 0);
        std::fs::write(dir.join("junk.wav"), b"not audio at all").unwrap();
        let r = answer(&json!({ "id": 10, "command": "presenter.mouthTrack", "params": { "wav": dir.join("junk.wav").to_string_lossy() } }));
        assert_eq!(r["error"]["code"], "bad-audio");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
