//! Speech recognition for captions (story D3): the models the recogniser listens with, how they are downloaded and checked, and the pure parts of running it.
//!
//! The recogniser itself is a separate program, whisper.cpp's `whisper-cli` (MIT licence), that the editor starts and reads the answer of; nothing here links to it, and it
//! has no way to reach the internet. The models are the multi-megabyte files it listens with. They are not part of the editor or of any course: the author asks for one, the
//! editor says what it is and where it comes from, and only then is it fetched, from the one address written below, checked against the size and SHA-256 that Hugging Face
//! publishes for the file, and kept in the editor's own folder. See docs/decisions/0002-speech-recognition.md for why these two models and these settings.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// One model the recogniser can listen with.
pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub note: &'static str,
    pub file: &'static str,
    pub bytes: u64,
    /// The SHA-256 that Hugging Face publishes for the file (its LFS object id), lower case.
    pub sha256: &'static str,
    pub url: &'static str,
}

/// The models offered. Sizes and hashes were read from huggingface.co/api/models/ggerganov/whisper.cpp on 2026-10-18 and match the files that were measured in the trial.
pub const MODELS: [ModelSpec; 2] = [
    ModelSpec {
        id: "small.en",
        label: "small.en (careful, recommended)",
        note: "More careful, so it makes fewer mistakes with names and in noise. It takes about a fifth of the length of the recording to listen. English only.",
        file: "ggml-small.en.bin",
        bytes: 487_614_201,
        sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    },
    ModelSpec {
        id: "base.en",
        label: "base.en (faster)",
        note: "Smaller and faster, about a tenth of the length of the recording, but it makes more mistakes with names and in noise. English only.",
        file: "ggml-base.en.bin",
        bytes: 147_964_211,
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    },
];

pub fn model(id: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|m| m.id == id)
}

pub const NO_RECOGNISER: &str = "The speech recogniser is not installed on this computer. It is a separate program (whisper.cpp). Double-click BUILD SPEECH RECOGNISER.bat in the OpenStage folder to build it, or set OPENSTAGE_WHISPER to the full path of whisper-cli.exe, then open OpenStage Author again.";

#[derive(Serialize)]
pub struct ModelStatus {
    id: &'static str,
    label: &'static str,
    note: &'static str,
    bytes: u64,
    installed: bool,
}

/// What the page is told: whether the recogniser is there, why not if it is not, where the models are kept, and which are downloaded.
#[derive(Serialize)]
pub struct Status {
    ready: bool,
    problem: String,
    folder: String,
    models: Vec<ModelStatus>,
}

pub fn model_path(folder: &Path, spec: &ModelSpec) -> PathBuf {
    folder.join(spec.file)
}

/// A model counts as there when its file has exactly the size it should. (Its hash was checked when it was downloaded.)
pub fn installed(folder: &Path, spec: &ModelSpec) -> bool {
    fs::metadata(model_path(folder, spec)).map(|m| m.is_file() && m.len() == spec.bytes).unwrap_or(false)
}

pub fn status(program: Result<PathBuf, String>, folder: &Path) -> Status {
    let (ready, problem) = match program {
        Ok(_) => (true, String::new()),
        Err(message) => (false, message),
    };
    Status {
        ready,
        problem,
        folder: folder.to_string_lossy().into_owned(),
        models: MODELS.iter().map(|m| ModelStatus { id: m.id, label: m.label, note: m.note, bytes: m.bytes, installed: installed(folder, m) }).collect(),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Fetch a model from `url` into `folder`, checking as it arrives. It is written to a `.part` file and only renamed to its name when its size and SHA-256 are right, so a stopped,
/// short or changed download never leaves a model that looks usable. `progress(done, total)` is called now and then (not for every chunk). Cancelling removes the partial file.
pub fn download(folder: &Path, spec: &ModelSpec, url: &str, cancel: &AtomicBool, progress: &mut dyn FnMut(u64, u64)) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|e| format!("Could not make the folder for the speech models ({}): {e}", folder.display()))?;
    let part = folder.join(format!("{}.part", spec.file));
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(30))
        .timeout_read(Duration::from_secs(60))
        .user_agent("OpenStageAuthor/0.1 (free open-source eLearning authoring tool)")
        .build();
    let response = match agent.get(url).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(code, _)) => return Err(format!("The download was refused (the server answered {code}). Try again later.")),
        Err(other) => return Err(format!("Could not reach the server to download the model. Check the internet connection. ({other})")),
    };
    let total = response.header("Content-Length").and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(spec.bytes);
    let result = (|| {
        let mut reader = response.into_reader();
        let mut file = fs::File::create(&part).map_err(|e| format!("Could not save the model: {e}"))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        let mut done: u64 = 0;
        let mut last = Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("The download was stopped.".to_string());
            }
            let n = reader.read(&mut buf).map_err(|e| format!("The download was interrupted: {e}"))?;
            if n == 0 {
                break;
            }
            done += n as u64;
            if done > spec.bytes {
                return Err("The file is larger than the model should be, so it was not kept.".to_string());
            }
            hasher.update(&buf[..n]);
            file.write_all(&buf[..n]).map_err(|e| format!("Could not save the model (is the disk full?): {e}"))?;
            if last.elapsed() >= Duration::from_millis(250) {
                progress(done, total);
                last = Instant::now();
            }
        }
        file.flush().map_err(|e| format!("Could not save the model: {e}"))?;
        drop(file);
        if done != spec.bytes {
            return Err(format!("The download stopped early ({done} of {} bytes), so it was not kept. Try again.", spec.bytes));
        }
        if hex(&hasher.finalize()) != spec.sha256 {
            return Err("The file that arrived is not the model it should be (its checksum does not match), so it was not kept.".to_string());
        }
        progress(done, total);
        Ok(())
    })();
    match result {
        Ok(()) => {
            let target = model_path(folder, spec);
            let _ = fs::remove_file(&target);
            fs::rename(&part, &target).map_err(|e| {
                let _ = fs::remove_file(&part);
                format!("Could not save the model: {e}")
            })
        }
        Err(e) => {
            let _ = fs::remove_file(&part);
            Err(e)
        }
    }
}

// ---- running the recogniser

/// How many threads to give it: half the computer's, between 2 and 8. Faster than that gains little, and the author may be working.
pub fn threads() -> usize {
    (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) / 2).clamp(2, 8)
}

/// The hint with anything that is not text taken out, and short enough for the recogniser (it keeps room for about 220 words of it).
pub fn clean_hint(hint: &str) -> String {
    hint.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(1000).collect()
}

/// The options for one listening: alignment mode (`-dtw`, which needs flash attention off) for accurate word times, the full JSON with every word's time, progress on
/// the error channel, and the processor only. `out_base` is the file name without `.json`.
pub fn listen_args(model: &Path, wav: &Path, out_base: &Path, dtw: &str, hint: &str, threads: usize) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-m".into(), model.to_string_lossy().into_owned(),
        "-f".into(), wav.to_string_lossy().into_owned(),
        "-l".into(), "en".into(),
        "-t".into(), threads.to_string(),
        "-ojf".into(),
        "-of".into(), out_base.to_string_lossy().into_owned(),
        "-np".into(), "-pp".into(), "-ng".into(),
        "-dtw".into(), dtw.into(), "-nfa".into(),
    ];
    let hint = clean_hint(hint);
    if !hint.is_empty() {
        args.push("--prompt".into());
        args.push(hint);
    }
    args
}

/// The percent in a line like `whisper_print_progress_callback: progress =  45%`.
pub fn progress_of(line: &str) -> Option<u8> {
    let rest = line.split("progress =").nth(1)?;
    let digits: String = rest.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<u16>().ok().map(|p| p.min(100) as u8)
}

/// A file name the page may ask for in the temporary folder: one made by `audio_put`, never a path.
pub fn audio_name_ok(name: &str) -> bool {
    let stem = name.strip_suffix(".wav").unwrap_or("");
    !stem.is_empty() && stem.len() <= 64 && stem.starts_with("speech-") && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The most sound that will be listened to in one go: 16 kHz, mono, 16 bits is 32,000 bytes a second, so this is about an hour and a half.
pub const MAX_WAV_BYTES: usize = 200 * 1024 * 1024;

/// Whether bytes are the plain WAV the page makes: PCM, one channel, 16,000 samples a second, 16 bits, with the data chunk right after the format chunk.
pub fn check_wav(bytes: &[u8]) -> Result<(), String> {
    let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
    let u32_at = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    if bytes.len() > MAX_WAV_BYTES {
        return Err("That sound is too long to listen to in one go.".into());
    }
    if bytes.len() < 46 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" || &bytes[12..16] != b"fmt " || &bytes[36..40] != b"data" {
        return Err("That is not the sound file the recogniser reads.".into());
    }
    if u16_at(20) != 1 || u16_at(22) != 1 || u32_at(24) != 16_000 || u16_at(34) != 16 {
        return Err("The sound must be 16,000 samples a second, one channel, 16 bits.".into());
    }
    if u32_at(40) as usize != bytes.len() - 44 {
        return Err("The sound file is not complete.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openstage-speech-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A one-shot local web server that sends `body`, optionally slowly, so cancelling can be tested.
    fn serve(body: Vec<u8>, slow: bool) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let head = format!("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes());
                for chunk in body.chunks(64 * 1024) {
                    if stream.write_all(chunk).is_err() {
                        return;
                    }
                    if slow {
                        std::thread::sleep(Duration::from_millis(40));
                    }
                }
            }
        });
        format!("http://127.0.0.1:{port}/model")
    }

    /// A model that is whatever `body` is, so a test needs no 400 MB file.
    fn spec_for(body: &[u8]) -> ModelSpec {
        let hash: &'static str = Box::leak(hex(&Sha256::digest(body)).into_boxed_str());
        ModelSpec { id: "test", label: "test", note: "", file: "ggml-test.bin", bytes: body.len() as u64, sha256: hash, url: "" }
    }

    #[test]
    fn the_models_offered_are_written_down_with_their_size_hash_and_address() {
        assert_eq!(MODELS[0].id, "small.en", "the careful one comes first and is the default");
        for m in &MODELS {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{}", m.id);
            assert_eq!(m.url, format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", m.file), "{}", m.id);
            assert!(m.bytes > 100_000_000, "{}", m.id);
            assert_eq!(model(m.id).map(|x| x.file), Some(m.file));
        }
        assert_eq!((MODELS[0].bytes, MODELS[1].bytes), (487_614_201, 147_964_211), "the sizes measured in the trial");
        assert!(model("large-v3").is_none() && model("../x").is_none(), "only the models in the table can be asked for");
    }

    #[test]
    fn progress_is_read_from_the_recogniser_s_line() {
        assert_eq!(progress_of("whisper_print_progress_callback: progress =  24%"), Some(24));
        assert_eq!(progress_of("whisper_print_progress_callback: progress = 100%"), Some(100));
        assert_eq!(progress_of("whisper_print_progress_callback: progress =   5%\r"), Some(5));
        assert_eq!(progress_of("whisper_init_from_file: loading model"), None);
        assert_eq!(progress_of("progress = lots"), None);
    }

    #[test]
    fn the_options_ask_for_alignment_times_and_the_hint_only_when_there_is_one() {
        let a = listen_args(Path::new("m.bin"), Path::new("a.wav"), Path::new("out"), "small.en", "", 4);
        for pair in [["-m", "m.bin"], ["-f", "a.wav"], ["-of", "out"], ["-dtw", "small.en"], ["-t", "4"], ["-l", "en"]] {
            assert!(a.windows(2).any(|w| w == pair), "{pair:?} in {a:?}");
        }
        for flag in ["-ojf", "-nfa", "-ng", "-pp", "-np"] {
            assert!(a.iter().any(|x| x == flag), "{flag}");
        }
        assert!(!a.iter().any(|x| x == "--prompt"));
        let b = listen_args(Path::new("m.bin"), Path::new("a.wav"), Path::new("out"), "base.en", "Brightspace, SCORM\u{0}\n", 2);
        assert!(b.windows(2).any(|w| w[0] == "--prompt" && w[1] == "Brightspace, SCORM"), "{b:?}");
        assert_eq!(clean_hint(&"x".repeat(5000)).len(), 1000);
        let t = threads();
        assert!((2..=8).contains(&t));
    }

    #[test]
    fn only_a_sound_the_page_made_can_be_named_and_only_the_right_kind_of_wav_is_taken() {
        for good in ["speech-1-2-3.wav", "speech-123456.wav"] {
            assert!(audio_name_ok(good), "{good}");
        }
        for bad in ["a.wav", "speech-.exe", "..\\speech-1.wav", "speech-1/../../x.wav", "speech-1.wav.exe", "", ".wav", "speech-é.wav"] {
            assert!(!audio_name_ok(bad), "{bad}");
        }
        let mut wav = vec![0u8; 44 + 6];
        wav[0..4].copy_from_slice(b"RIFF");
        wav[4..8].copy_from_slice(&(36u32 + 6).to_le_bytes());
        wav[8..12].copy_from_slice(b"WAVE");
        wav[12..16].copy_from_slice(b"fmt ");
        wav[16..20].copy_from_slice(&16u32.to_le_bytes());
        wav[20..22].copy_from_slice(&1u16.to_le_bytes());
        wav[22..24].copy_from_slice(&1u16.to_le_bytes());
        wav[24..28].copy_from_slice(&16_000u32.to_le_bytes());
        wav[28..32].copy_from_slice(&32_000u32.to_le_bytes());
        wav[32..34].copy_from_slice(&2u16.to_le_bytes());
        wav[34..36].copy_from_slice(&16u16.to_le_bytes());
        wav[36..40].copy_from_slice(b"data");
        wav[40..44].copy_from_slice(&6u32.to_le_bytes());
        assert_eq!(check_wav(&wav), Ok(()));
        let mut stereo = wav.clone();
        stereo[22] = 2;
        assert!(check_wav(&stereo).unwrap_err().contains("16,000 samples"));
        let mut cut = wav.clone();
        cut.truncate(47);
        assert!(check_wav(&cut).unwrap_err().contains("not complete"));
        assert!(check_wav(b"not a wav at all, not at all, not at all, not at all.").is_err());
        assert!(check_wav(&[]).is_err());
    }

    #[test]
    fn a_model_downloads_only_when_its_size_and_checksum_are_right() {
        let folder = temp("ok");
        let body: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        let spec = spec_for(&body);
        assert!(!installed(&folder, &spec));
        let mut told = Vec::new();
        download(&folder, &spec, &serve(body.clone(), false), &AtomicBool::new(false), &mut |d, t| told.push((d, t))).unwrap();
        assert!(installed(&folder, &spec));
        assert_eq!(fs::read(model_path(&folder, &spec)).unwrap(), body);
        assert_eq!(told.last(), Some(&(300_000, 300_000)), "it ends by saying it is all there");
        assert!(!folder.join("ggml-test.bin.part").exists());
        // a model that is there is replaced, not doubled
        download(&folder, &spec, &serve(body, false), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn a_download_that_is_wrong_leaves_nothing_that_looks_like_a_model() {
        let folder = temp("bad");
        let body: Vec<u8> = (0..100_000u32).map(|i| (i % 7) as u8).collect();
        let spec = spec_for(&body);
        // the same size but not the same bytes
        let mut altered = body.clone();
        altered[500] ^= 1;
        let e = download(&folder, &spec, &serve(altered, false), &AtomicBool::new(false), &mut |_, _| {}).unwrap_err();
        assert!(e.contains("checksum"), "{e}");
        // too short
        let e = download(&folder, &spec, &serve(body[..60_000].to_vec(), false), &AtomicBool::new(false), &mut |_, _| {}).unwrap_err();
        assert!(e.contains("stopped early"), "{e}");
        // longer than it should be
        let mut long = body.clone();
        long.extend_from_slice(&[0u8; 10]);
        let e = download(&folder, &spec, &serve(long, false), &AtomicBool::new(false), &mut |_, _| {}).unwrap_err();
        assert!(e.contains("larger"), "{e}");
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0, "no .part file and no model");
        assert!(!installed(&folder, &spec));
        // nothing to reach
        let e = download(&folder, &spec, "http://127.0.0.1:1/none", &AtomicBool::new(false), &mut |_, _| {}).unwrap_err();
        assert!(e.contains("Could not reach"), "{e}");
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn stopping_a_download_removes_the_part_of_it_that_arrived() {
        let folder = temp("cancel");
        let body = vec![7u8; 2_000_000];
        let spec = spec_for(&body);
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let stop = cancel.clone();
        let url = serve(body, true);
        let stopper = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            stop.store(true, Ordering::SeqCst);
        });
        let e = download(&folder, &spec, &url, &cancel, &mut |_, _| {}).unwrap_err();
        stopper.join().unwrap();
        assert!(e.contains("stopped"), "{e}");
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn the_status_says_what_is_there_and_why_not_when_it_is_not() {
        let folder = temp("status");
        let missing = serde_json::to_value(status(Err(NO_RECOGNISER.to_string()), &folder)).unwrap();
        assert_eq!(missing["ready"], false);
        assert!(missing["problem"].as_str().unwrap().contains("BUILD SPEECH RECOGNISER.bat"));
        assert_eq!(missing["models"].as_array().unwrap().len(), 2);
        assert_eq!(missing["models"][0]["installed"], false);
        // a file of the wrong size is not a model
        fs::write(folder.join("ggml-base.en.bin"), b"short").unwrap();
        let ready = serde_json::to_value(status(Ok(PathBuf::from("whisper-cli.exe")), &folder)).unwrap();
        assert_eq!(ready["ready"], true);
        assert_eq!(ready["models"][1]["installed"], false);
        let _ = fs::remove_dir_all(folder);
    }
}
