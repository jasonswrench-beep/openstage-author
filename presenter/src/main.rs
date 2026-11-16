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

/// The mouth shapes of a recording: `params.wav` is the path of a WAV file, `params.fps` how many pictures a second the clip will have.
fn mouth_track(params: &Value) -> Result<Value, Value> {
    let path = params["wav"].as_str().ok_or_else(|| fail("bad-request", "Say which audio file to listen to (wav)."))?;
    let fps = params["fps"].as_u64().unwrap_or(25) as u32;
    let meta = std::fs::metadata(path).map_err(|e| fail("no-audio", format!("The audio file could not be opened: {e}")))?;
    if !meta.is_file() || meta.len() as usize > wav::MAX_BYTES {
        return Err(fail("no-audio", "That is not an audio file this program can read."));
    }
    let bytes = std::fs::read(path).map_err(|e| fail("no-audio", format!("The audio file could not be read: {e}")))?;
    let sound = wav::parse(&bytes).map_err(|why| fail("bad-audio", why))?;
    Ok(mouth::track(&sound, fps).to_json())
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
