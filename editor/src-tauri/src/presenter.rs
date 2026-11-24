// The Presenter add-on, seen from the editor's native side (docs/presenter.md): finding it, asking its engine host things, and saving the clip the
// editor makes. The add-on is a separate download in a folder of its own; nothing here runs unless that folder is there and the editor asks.

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The longest manifest read.
const MAX_MANIFEST: u64 = 64 * 1024;
/// The most the engine host may say before it is cut off.
const MAX_ANSWER: u64 = 16 * 1024 * 1024;
/// The commands of contract 1 an add-on may list.
const KNOWN_COMMANDS: &[&str] = &["presenter.hello", "presenter.check", "presenter.presenters", "presenter.mouthTrack"];
const KNOWN_TIERS: &[&str] = &["lite", "standard", "studio"];
/// The most a clip may weigh (the video folder allows 500 MB).
const MAX_CLIP: usize = 500 * 1024 * 1024;
/// The largest timing file read, and the most sentences taken from it.
const MAX_TIMING: u64 = 4 * 1024 * 1024;
const MAX_CUES: usize = 10_000;
const MAX_WORDS: usize = 50_000;

/// What the editor needs to know about an add-on it found.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddonInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub tiers: Vec<String>,
    pub commands: Vec<String>,
    /// The manifest carries a signature. Nothing verifies it yet (there is no key to verify against), so this does not make an add-on usable.
    pub signed: bool,
    /// Whether the editor may use it now.
    pub usable: bool,
    /// Why it is not usable, in words, when it is not.
    pub why: Option<String>,
    #[serde(skip)]
    pub host: PathBuf,
}

/// Where add-ons are kept: a folder for each, each with an addon.json. `OPENSTAGE_ADDONS` names another place (for tests and for a developer).
pub fn addons_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("OPENSTAGE_ADDONS") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("OpenStage").join("addons"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|d| PathBuf::from(d).join("Library").join("Application Support").join("OpenStage").join("addons"))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|d| PathBuf::from(d).join(".local").join("share")))
            .map(|d| d.join("OpenStage").join("addons"))
    }
}

/// Whether an add-on that is not signed may be used: only while a developer sets OPENSTAGE_DEV_ADDONS=1, because nothing can sign one yet.
pub fn dev_addons() -> bool {
    std::env::var("OPENSTAGE_DEV_ADDONS").map(|v| v == "1").unwrap_or(false)
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

/// A path that stays inside the add-on's own folder: relative, no `..`, not empty.
fn inside(rel: &str) -> bool {
    let p = Path::new(rel);
    !rel.is_empty() && !p.is_absolute() && p.components().all(|c| matches!(c, Component::Normal(_))) && !rel.contains(':')
}

fn id_ok(id: &str) -> bool {
    (2..=31).contains(&id.len()) && id.as_bytes()[0].is_ascii_lowercase() && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn version_ok(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.len() <= 6 && p.bytes().all(|b| b.is_ascii_digit()))
}

/// Reads and checks the manifest in one add-on's folder.
pub fn read_manifest(folder: &Path, dev: bool) -> Result<AddonInfo, String> {
    let file = folder.join("addon.json");
    let meta = fs::metadata(&file).map_err(|_| "There is no addon.json.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_MANIFEST {
        return Err("addon.json is not a file of a sensible size.".into());
    }
    let raw = fs::read_to_string(&file).map_err(|e| format!("addon.json could not be read: {e}"))?;
    let m: Value = serde_json::from_str(&raw).map_err(|e| format!("addon.json is not JSON: {e}"))?;
    if m.get("contract").and_then(|c| c.as_u64()) != Some(1) {
        return Err("addon.json is not for contract 1.".into());
    }
    let id = text(&m, "id").filter(|i| id_ok(i)).ok_or("addon.json has no good id.")?.to_string();
    let name = text(&m, "name").filter(|n| !n.trim().is_empty() && n.len() <= 80).ok_or("addon.json has no good name.")?.to_string();
    let version = text(&m, "version").filter(|v| version_ok(v)).ok_or("addon.json has no good version.")?.to_string();
    text(&m, "licence").filter(|l| !l.trim().is_empty()).ok_or("addon.json does not say its licence.")?;
    let host_rel = text(&m, "host").filter(|h| inside(h)).ok_or("addon.json names a program outside its own folder, or none.")?;
    let host = folder.join(host_rel);
    if !host.is_file() {
        return Err(format!("The program {host_rel} is not in the add-on's folder."));
    }
    let list = |key: &str, known: &[&str]| -> Result<Vec<String>, String> {
        let items = m.get(key).and_then(|v| v.as_array()).ok_or(format!("addon.json has no {key}."))?;
        items
            .iter()
            .map(|i| i.as_str().filter(|s| known.contains(s)).map(|s| s.to_string()).ok_or(format!("addon.json lists a {key} this editor does not know.")))
            .collect()
    };
    let commands = list("commands", KNOWN_COMMANDS)?;
    let tiers = list("tiers", KNOWN_TIERS)?;
    let signed = text(&m, "signature").map(|s| !s.trim().is_empty()).unwrap_or(false);
    let usable = dev;
    let why = if usable { None } else { Some("It is not signed, and nothing can verify a signature yet. Set OPENSTAGE_DEV_ADDONS=1 to use it while it is being built.".to_string()) };
    Ok(AddonInfo { id, name, version, description: text(&m, "description").unwrap_or("").chars().take(300).collect(), tiers, commands, signed, usable, why, host })
}

/// Every add-on in the folder that has a good manifest, by folder name.
pub fn find_addons(root: &Path, dev: bool) -> Vec<AddonInfo> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut folders: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    folders.sort();
    folders.iter().filter_map(|f| read_manifest(f, dev).ok()).collect()
}

/// Starts the engine host, gives it one request, and returns its answer. A host that does not answer in time is stopped.
pub fn call_host(host: &Path, command: &str, params: Value, timeout: Duration) -> Result<Value, String> {
    let request = json!({ "id": 1, "command": command, "params": params });
    let mut cmd = Command::new(host);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let mut child = cmd.spawn().map_err(|e| format!("The Presenter add-on could not be started: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = writeln!(stdin, "{request}");
    }
    let mut out = child.stdout.take().ok_or("The add-on gave no way to read its answer.")?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.by_ref().take(MAX_ANSWER + 1).read_to_end(&mut buf);
        buf
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("The Presenter add-on did not answer in time, so it was stopped.".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(15)),
            Err(e) => return Err(format!("The Presenter add-on could not be watched: {e}")),
        }
    }
    let bytes = reader.join().map_err(|_| "The add-on's answer could not be read.".to_string())?;
    if bytes.len() as u64 > MAX_ANSWER {
        return Err("The Presenter add-on said far more than it should, so its answer was refused.".into());
    }
    let said = String::from_utf8_lossy(&bytes);
    for line in said.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { continue };
        if v["id"] != json!(1) {
            continue;
        }
        if let Some(e) = v.get("error") {
            return Err(text(e, "message").unwrap_or("The Presenter add-on said it could not do that.").to_string());
        }
        if let Some(r) = v.get("result") {
            return Ok(r.clone());
        }
    }
    let mut err = String::new();
    if let Some(mut e) = child.stderr.take() {
        let _ = e.by_ref().take(2000).read_to_string(&mut err);
    }
    Err(format!("The Presenter add-on gave no answer I could read.{}", if err.trim().is_empty() { String::new() } else { format!(" It said: {}", err.trim()) }))
}

/// The usable Presenter add-on, if there is one.
fn the_addon() -> Option<AddonInfo> {
    let root = addons_root()?;
    find_addons(&root, dev_addons()).into_iter().find(|a| a.id == "presenter" && a.usable)
}

/// What the editor asks at the start: is the Presenter add-on here and may it be used?
#[tauri::command]
pub fn presenter_addon() -> Option<AddonInfo> {
    the_addon()
}

/// Ask the add-on something that needs no file: hello, check or presenters.
#[tauri::command]
pub async fn presenter_ask(command: String) -> Result<Value, String> {
    if !["presenter.hello", "presenter.check", "presenter.presenters"].contains(&command.as_str()) {
        return Err("The editor does not ask the add-on that.".into());
    }
    let addon = the_addon().ok_or("The Presenter add-on is not here.")?;
    if !addon.commands.contains(&command) {
        return Err("This version of the add-on does not do that.".into());
    }
    tauri::async_runtime::spawn_blocking(move || call_host(&addon.host, &command, json!({}), Duration::from_secs(20))).await.map_err(|e| e.to_string())?
}

/// The mouth shapes of a piece of narration audio already made for the project (named by its cache key).
#[tauri::command]
pub async fn presenter_mouth_track(dir: String, key: String) -> Result<Value, String> {
    let dir = PathBuf::from(dir);
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if !super::is_cache_key(&key) {
        return Err("That is not narration audio.".into());
    }
    let wav = dir.join(".cache").join("narration").join(format!("{key}.wav"));
    if !wav.is_file() {
        return Err("The narration audio has not been made yet.".into());
    }
    let addon = the_addon().ok_or("The Presenter add-on is not here.")?;
    if !addon.commands.iter().any(|c| c == "presenter.mouthTrack") {
        return Err("This version of the add-on does not do that.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let words = narration_words_at(&dir, &key);
        call_host(&addon.host, "presenter.mouthTrack", json!({ "wav": wav.to_string_lossy(), "fps": 25, "words": words }), Duration::from_secs(120))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save a clip the editor made in the project's videos, and return its project-relative path. The bytes (given as base64) have to be a real WebM
/// file, and a file that is already there is never overwritten.
pub fn save_clip_at(dir: &Path, name_hint: &str, bytes: &[u8]) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if bytes.len() < 64 || bytes[..4] != [0x1A, 0x45, 0xDF, 0xA3] {
        return Err("What was made is not a video OpenStage can use.".into());
    }
    if bytes.len() > MAX_CLIP {
        return Err("That clip is larger than 500 MB.".into());
    }
    let folder = dir.join("assets").join("video");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let stem: String = format!("presenter-{}", super::safe_stem(name_hint, "clip")).chars().take(60).collect();
    let name = super::unique_name(&folder, stem.trim_end_matches('-'), "webm");
    fs::write(folder.join(&name), bytes).map_err(|e| format!("Could not save the clip: {e}"))?;
    Ok(format!("assets/video/{name}"))
}

#[tauri::command]
pub fn save_presenter_clip(dir: String, name_hint: String, webm: String) -> Result<String, String> {
    use base64::Engine;
    if webm.len() > MAX_CLIP * 4 / 3 + 16 {
        return Err("That clip is larger than 500 MB.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(webm.as_bytes()).map_err(|_| "What was made could not be read.".to_string())?;
    save_clip_at(Path::new(&dir), &name_hint, &bytes)
}

/// The words the speech engine said, each with when it began and ended (seconds) and the phonemes it said it with, from the project's cache. Only Kokoro keeps them, and
/// only for audio made since it did, so there are often none: the mouth then follows the sound. A word that is not whole is left out. A word also carries `times`, when
/// the cache has them and they fit: a [start, end] pair for each character of its phonemes (the length of each sound as Kokoro predicted it, kept by audio made since it did);
/// without them the add-on shares the word's time among its sounds by weight. The add-on checks the times again.
pub fn narration_words_at(dir: &Path, key: &str) -> Vec<Value> {
    if !super::is_cache_key(key) {
        return Vec::new();
    }
    let file = dir.join(".cache").join("narration").join(format!("{key}.json"));
    let Ok(meta) = fs::metadata(&file) else { return Vec::new() };
    if !meta.is_file() || meta.len() > MAX_TIMING {
        return Vec::new();
    }
    let Ok(v) = fs::read_to_string(&file).map_err(|_| ()).and_then(|r| serde_json::from_str::<Value>(&r).map_err(|_| ())) else { return Vec::new() };
    v["words"]
        .as_array()
        .map(|a| {
            a.iter()
                .take(MAX_WORDS)
                .filter_map(|w| {
                    let (start, end, phonemes) = (w["start"].as_f64()?, w["end"].as_f64()?, w["phonemes"].as_str()?);
                    (start.is_finite() && end.is_finite() && start >= 0.0 && end >= start && !phonemes.trim().is_empty() && phonemes.chars().count() <= 100).then(|| {
                        let mut word = json!({ "start": start, "end": end, "phonemes": phonemes });
                        let pair_of_numbers = |p: &Value| p.as_array().map_or(false, |p| p.len() == 2 && p.iter().all(|n| n.as_f64().map_or(false, f64::is_finite)));
                        if let Some(times) = w["times"].as_array().filter(|t| t.len() == phonemes.chars().count() && t.iter().all(pair_of_numbers)) {
                            word["times"] = Value::Array(times.clone());
                        }
                        word
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// What the narration's own timing says: one cue for each sentence, from the first word spoken to the last, in seconds, and whether those times came from the
/// words (the speech engine reported them) or were estimated from the length of each sentence. Read from the project's own cache; a cue that is not whole is left out.
pub fn narration_cues_at(dir: &Path, key: &str) -> Result<Value, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if !super::is_cache_key(key) {
        return Err("That is not narration audio.".into());
    }
    let file = dir.join(".cache").join("narration").join(format!("{key}.json"));
    let meta = fs::metadata(&file).map_err(|_| "The narration has no timing yet.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_TIMING {
        return Err("The narration's timing is not a file of a sensible size.".into());
    }
    let raw = fs::read_to_string(&file).map_err(|e| format!("The narration's timing could not be read: {e}"))?;
    let v: Value = serde_json::from_str(&raw).map_err(|_| "The narration's timing is not readable.".to_string())?;
    let cues: Vec<Value> = v["cues"]
        .as_array()
        .map(|a| a.iter().take(MAX_CUES).filter_map(|c| {
            let (start, end, text) = (c["start"].as_f64()?, c["end"].as_f64()?, c["text"].as_str()?);
            (start.is_finite() && end.is_finite() && start >= 0.0 && end >= start && !text.trim().is_empty() && text.len() <= 10_000).then(|| json!({ "start": start, "end": end, "text": text }))
        }).collect())
        .unwrap_or_default();
    Ok(json!({ "exactTimings": v["exactTimings"].as_bool().unwrap_or(false), "duration": v["duration"].as_f64().unwrap_or(0.0), "cues": cues }))
}

#[tauri::command]
pub fn narration_cues(dir: String, key: String) -> Result<Value, String> {
    narration_cues_at(Path::new(&dir), &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("openstage-presenter-shell-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn addon(root: &Path, folder: &str, manifest: &str, with_host: bool) -> PathBuf {
        let d = root.join(folder);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("addon.json"), manifest).unwrap();
        if with_host {
            fs::write(d.join("host.exe"), b"x").unwrap();
        }
        d
    }

    const GOOD: &str = r#"{"contract":1,"id":"presenter","name":"OpenStage Presenter","version":"0.1.0","licence":"Apache-2.0","description":"Presenters.",
        "host":"host.exe","commands":["presenter.hello","presenter.check"],"tiers":["lite"],"signature":null}"#;

    #[test]
    fn a_good_manifest_is_read_and_is_usable_only_in_the_developer_mode() {
        let root = scratch("good");
        let d = addon(&root, "presenter", GOOD, true);
        let a = read_manifest(&d, false).unwrap();
        assert_eq!((a.id.as_str(), a.version.as_str(), a.tiers.clone(), a.signed), ("presenter", "0.1.0", vec!["lite".to_string()], false));
        assert!(!a.usable && a.why.as_deref().unwrap().contains("OPENSTAGE_DEV_ADDONS"));
        assert!(read_manifest(&d, true).unwrap().usable);
        assert_eq!(a.host, d.join("host.exe"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_signature_is_read_but_does_not_make_an_addon_usable() {
        let root = scratch("signed");
        let d = addon(&root, "presenter", &GOOD.replace("\"signature\":null", "\"signature\":\"abcd\""), true);
        let a = read_manifest(&d, false).unwrap();
        assert!(a.signed && !a.usable, "nothing verifies it yet");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_manifest_that_is_wrong_is_refused_in_words() {
        let root = scratch("bad");
        let cases = [
            ("nocontract", GOOD.replace("\"contract\":1", "\"contract\":2")),
            ("badid", GOOD.replace("\"id\":\"presenter\"", "\"id\":\"Presenter One\"")),
            ("version", GOOD.replace("0.1.0", "one")),
            ("nolicence", GOOD.replace("\"licence\":\"Apache-2.0\",", "")),
            ("escape", GOOD.replace("host.exe", "../host.exe")),
            ("absolute", GOOD.replace("host.exe", "C:/Windows/notepad.exe")),
            ("command", GOOD.replace("presenter.check", "presenter.format-disk")),
            ("tier", GOOD.replace("\"lite\"", "\"huge\"")),
            ("notjson", "{".to_string()),
        ];
        for (name, manifest) in cases {
            let d = addon(&root, name, &manifest, true);
            assert!(read_manifest(&d, true).is_err(), "{name} must be refused");
        }
        let d = addon(&root, "nohost", GOOD, false);
        assert!(read_manifest(&d, true).unwrap_err().contains("not in the add-on's folder"));
        let d = root.join("nothing");
        fs::create_dir_all(&d).unwrap();
        assert!(read_manifest(&d, true).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_manifest_that_is_far_too_big_is_not_read() {
        let root = scratch("big");
        let d = addon(&root, "presenter", &format!("{GOOD}{}", " ".repeat(70_000)), true);
        assert!(read_manifest(&d, true).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finding_add_ons_keeps_the_good_ones_in_order_and_skips_the_rest() {
        let root = scratch("find");
        addon(&root, "b-presenter", &GOOD.replace("\"presenter\"", "\"b-one\"").replace("OpenStage Presenter", "B"), true);
        addon(&root, "a-presenter", GOOD, true);
        addon(&root, "broken", "{", true);
        fs::write(root.join("a-file.txt"), "x").unwrap();
        let found = find_addons(&root, true);
        assert_eq!(found.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), vec!["presenter", "b-one"]);
        assert!(find_addons(&root.join("none"), true).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    fn fake_host(dir: &Path, body: &str) -> PathBuf {
        let p = dir.join("host.bat");
        fs::write(&p, format!("@echo off\r\n{body}\r\n")).unwrap();
        p
    }

    #[cfg(windows)]
    #[test]
    fn the_hosts_answer_is_read_and_its_errors_are_said() {
        let d = scratch("call");
        let ok = fake_host(&d, "echo {\"id\":1,\"event\":\"progress\"}\r\necho {\"id\":1,\"result\":{\"fine\":true}}");
        assert_eq!(call_host(&ok, "presenter.hello", json!({}), Duration::from_secs(10)).unwrap(), json!({ "fine": true }));
        let no = fake_host(&d, "echo {\"id\":1,\"error\":{\"code\":\"x\",\"message\":\"It would not work.\"}}");
        assert_eq!(call_host(&no, "presenter.hello", json!({}), Duration::from_secs(10)).unwrap_err(), "It would not work.");
        let junk = fake_host(&d, "echo this is not json");
        assert!(call_host(&junk, "presenter.hello", json!({}), Duration::from_secs(10)).unwrap_err().contains("no answer"));
        let other = fake_host(&d, "echo {\"id\":2,\"result\":{}}");
        assert!(call_host(&other, "presenter.hello", json!({}), Duration::from_secs(10)).is_err(), "an answer to another request is not an answer");
        assert!(call_host(&d.join("missing.exe"), "presenter.hello", json!({}), Duration::from_secs(10)).unwrap_err().contains("could not be started"));
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(windows)]
    #[test]
    fn a_host_that_does_not_answer_is_stopped() {
        let d = scratch("slow");
        let slow = fake_host(&d, "ping -n 20 127.0.0.1 >nul");
        let t = Instant::now();
        let e = call_host(&slow, "presenter.hello", json!({}), Duration::from_millis(400)).unwrap_err();
        assert!(e.contains("did not answer in time") && t.elapsed() < Duration::from_secs(8), "{e}");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn the_narrations_own_timing_is_read_and_a_cue_that_is_not_whole_is_left_out() {
        let d = scratch("cues");
        fs::write(d.join("project.json"), "{}").unwrap();
        let key = "ab".repeat(32);
        let cache = d.join(".cache").join("narration");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join(format!("{key}.json")), r#"{"hash":"x","duration":6.5,"exactTimings":true,"cues":[
            {"start":0.2,"end":2.5,"text":"Welcome to the course."},{"start":2.9,"end":6.1,"text":"We look at how it moves."},
            {"start":7,"end":6,"text":"backwards"},{"start":"1","end":2,"text":"text start"},{"start":1,"end":2,"text":"   "},{"start":1,"end":2},{"start":-1,"end":2,"text":"before"}]}"#).unwrap();
        let r = narration_cues_at(&d, &key).unwrap();
        assert_eq!(r["exactTimings"], true);
        assert_eq!(r["duration"], 6.5);
        assert_eq!(r["cues"].as_array().unwrap().len(), 2);
        assert_eq!(r["cues"][1]["text"], "We look at how it moves.");
        fs::write(cache.join(format!("{key}.json")), r#"{"duration":1,"cues":"no"}"#).unwrap();
        let r = narration_cues_at(&d, &key).unwrap();
        assert_eq!((r["exactTimings"].clone(), r["cues"].as_array().unwrap().len()), (json!(false), 0));
        fs::write(cache.join(format!("{key}.json")), "not json").unwrap();
        assert!(narration_cues_at(&d, &key).is_err());
        assert!(narration_cues_at(&d, &"cd".repeat(32)).unwrap_err().contains("no timing"), "audio that was never made has none");
        assert!(narration_cues_at(&d, "../../x").is_err(), "only a real key names a file");
        assert!(narration_cues_at(&d.join("nope"), &key).is_err());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn the_words_with_their_phonemes_are_read_from_the_cache_and_a_word_that_is_not_whole_is_left_out() {
        let d = scratch("words");
        fs::write(d.join("project.json"), "{}").unwrap();
        let key = "ab".repeat(32);
        let cache = d.join(".cache").join("narration");
        fs::create_dir_all(&cache).unwrap();
        assert!(narration_words_at(&d, &key).is_empty(), "no file, no words");
        fs::write(cache.join(format!("{key}.json")), r#"{"duration":2,"cues":[],"words":[
            {"text":"Welcome","start":0.25,"end":0.7,"phonemes":"wˈɛlkəm"},{"text":"x","start":1,"end":0.5,"phonemes":"a"},{"start":0,"end":1,"phonemes":" "},
            {"start":0,"end":1},{"start":"0","end":1,"phonemes":"a"},{"start":-1,"end":1,"phonemes":"a"},3]}"#).unwrap();
        let w = narration_words_at(&d, &key);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0]["phonemes"], "wˈɛlkəm");
        assert!(w[0].get("text").is_none(), "only what the host uses is passed on");
        fs::write(cache.join(format!("{key}.json")), r#"{"duration":2,"cues":[]}"#).unwrap();
        assert!(narration_words_at(&d, &key).is_empty(), "audio made before phonemes were kept has none");
        fs::write(cache.join(format!("{key}.json")), "nonsense").unwrap();
        assert!(narration_words_at(&d, &key).is_empty());
        assert!(narration_words_at(&d, "../../x").is_empty());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn the_length_of_each_sound_is_passed_on_when_the_cache_has_it_and_it_fits_the_phonemes() {
        let d = scratch("sound-times");
        fs::write(d.join("project.json"), "{}").unwrap();
        let key = "cd".repeat(32);
        let cache = d.join(".cache").join("narration");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join(format!("{key}.json")), r#"{"duration":2,"cues":[],"words":[
            {"text":"ma","start":0.0,"end":0.5,"phonemes":"ma","times":[[0.0,0.2],[0.2,0.5]]},
            {"text":"ta","start":0.5,"end":1.0,"phonemes":"ta","times":[[0.5,0.6]]},
            {"text":"ka","start":1.0,"end":1.5,"phonemes":"ka","times":[[1.0,1.2],[1.2,"x"]]},
            {"text":"pa","start":1.5,"end":2.0,"phonemes":"pa"}]}"#).unwrap();
        let w = narration_words_at(&d, &key);
        assert_eq!(w.len(), 4, "no word is left out for its times");
        assert_eq!(w[0]["times"], json!([[0.0, 0.2], [0.2, 0.5]]));
        assert!(w[1].get("times").is_none(), "one pair for two sounds");
        assert!(w[2].get("times").is_none(), "a time that is not a number");
        assert!(w[3].get("times").is_none(), "audio made before the lengths were kept");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_clip_is_saved_only_if_it_is_a_webm_and_never_over_another_file() {
        let d = scratch("clip");
        fs::write(d.join("project.json"), "{}").unwrap();
        let mut webm = vec![0x1A, 0x45, 0xDF, 0xA3];
        webm.extend(vec![0u8; 100]);
        assert_eq!(save_clip_at(&d, "Guide: Welcome!", &webm).unwrap(), "assets/video/presenter-Guide--Welcome.webm");
        assert_eq!(save_clip_at(&d, "Guide: Welcome!", &webm).unwrap(), "assets/video/presenter-Guide--Welcome-2.webm");
        assert!(save_clip_at(&d, "x", b"RIFF....WAVE and so on, long enough to pass the size test, not a webm at all.....").is_err());
        assert!(save_clip_at(&d, "x", &webm[..10]).is_err());
        assert!(save_clip_at(&d.join("nope"), "x", &webm).is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
