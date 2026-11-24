// The Presenter add-on, seen from the editor's native side (docs/presenter.md): finding it, asking its engine host things, and saving the clip the
// editor makes. The add-on is a separate download in a folder of its own; nothing here runs unless that folder is there and the editor asks.

use ring::signature::{UnparsedPublicKey, ED25519};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The public key an add-on's signature has to verify against: an Ed25519 key, 32 bytes. It is `None` until the owner makes the key pair, offline, and gives
/// the public half to be put here; the private half never comes into this repository or a build folder. With no key nothing can be verified, so no add-on is
/// usable except through the developer route (`dev_route_built`).
const ADDON_PUBLIC_KEY: Option<[u8; 32]> = None;
/// The file beside addon.json that holds the signature: 64 bytes of Ed25519, written as base64, over `signed_message`.
const SIGNATURE_FILE: &str = "addon.sig";
const MAX_SIGNATURE: u64 = 1024;
/// The largest engine host program that is hashed.
const MAX_HOST: u64 = 512 * 1024 * 1024;
/// What the editor remembers about the add-ons it has used: the highest version of each. It lives in the add-ons folder.
const LAST_USED_FILE: &str = "last-used.json";
/// The most of the add-on's error output that is kept to be shown.
const MAX_STDERR: u64 = 2000;
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
    /// The add-on's folder has a signature file. That alone proves nothing.
    pub signed: bool,
    /// The signature checks out against the key built into the editor, for this very manifest and this very program.
    pub verified: bool,
    /// Whether the editor may use it now.
    pub usable: bool,
    /// Why it is not usable, in words, when it is not.
    pub why: Option<String>,
    #[serde(skip)]
    pub host: PathBuf,
}

/// Whether this editor has the developer route for add-ons: a debug build, or a build made with the `dev-addons` feature (OPEN EDITOR.bat does that on the owner's
/// own computer). The installer's build has neither, so a setup made for other people never reads `OPENSTAGE_DEV_ADDONS` or `OPENSTAGE_ADDONS`.
pub const fn dev_route_built() -> bool {
    cfg!(any(debug_assertions, feature = "dev-addons"))
}

/// Where add-ons are kept: a folder for each, each with an addon.json. In a build that has the developer route, `OPENSTAGE_ADDONS` names another place instead.
pub fn addons_root() -> Option<PathBuf> {
    if let Some(p) = root_setting(dev_route_built(), std::env::var("OPENSTAGE_ADDONS").ok().as_deref()) {
        return Some(p);
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

/// Whether an add-on that is not signed may be used: only in a build that has the developer route, and only while a developer sets OPENSTAGE_DEV_ADDONS=1.
pub fn dev_addons() -> bool {
    dev_wanted(dev_route_built(), std::env::var("OPENSTAGE_DEV_ADDONS").ok().as_deref())
}

/// The other add-ons folder `OPENSTAGE_ADDONS` names, only in a build that has the developer route.
fn root_setting(dev_route: bool, setting: Option<&str>) -> Option<PathBuf> {
    setting.filter(|p| dev_route && !p.is_empty()).map(PathBuf::from)
}

/// Whether `OPENSTAGE_DEV_ADDONS` asks for the developer route and this build has it.
fn dev_wanted(dev_route: bool, setting: Option<&str>) -> bool {
    dev_route && setting == Some("1")
}

/// How an add-on is judged: the key its signature has to match (none, until the owner makes one), and whether a developer's add-on that is not signed may run.
#[derive(Clone, Copy, Debug)]
pub struct Policy {
    pub key: Option<[u8; 32]>,
    pub dev: bool,
}

impl Policy {
    /// The policy of this editor, as it is built and as the computer is set now.
    pub fn current() -> Policy {
        Policy { key: ADDON_PUBLIC_KEY, dev: dev_addons() }
    }
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

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// What an add-on's signature covers, so that changing the manifest or the program by one byte breaks it: a fixed first line, then the SHA-256 of addon.json
/// and the SHA-256 of the engine host program, each as lowercase hex on a line of its own. (`docs/presenter.md`, "Signing", says how to make one.)
fn signed_message(manifest: &[u8], host_sha256: &[u8]) -> Vec<u8> {
    format!("OpenStage add-on 1\n{}\n{}\n", hex(&Sha256::digest(manifest)), hex(host_sha256)).into_bytes()
}

/// The SHA-256 of a file, read in pieces, and refused if it is far bigger than an engine host should be.
fn sha256_of_file(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("The add-on's program could not be read: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("The add-on's program could not be read: {e}"))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_HOST {
            return Err("The add-on's program is far bigger than an engine host should be.".into());
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_vec())
}

/// Whether the signature file in the add-on's folder is a good signature, by `key`, of exactly this manifest (as read, byte for byte) and this program.
fn check_signature(folder: &Path, manifest: &[u8], host: &Path, key: &[u8; 32]) -> Result<(), String> {
    let file = folder.join(SIGNATURE_FILE);
    let meta = fs::metadata(&file).map_err(|_| "It has no signature.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_SIGNATURE {
        return Err("Its signature is not a file of a sensible size.".into());
    }
    let text = fs::read_to_string(&file).map_err(|_| "Its signature could not be read.".to_string())?;
    let signature = {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode(text.trim().as_bytes()).map_err(|_| "Its signature is not in the form it should be.".to_string())?
    };
    let host_hash = sha256_of_file(host)?;
    UnparsedPublicKey::new(&ED25519, key)
        .verify(&signed_message(manifest, &host_hash), &signature)
        .map_err(|_| "Its signature does not match: the add-on was changed after it was signed, or it was not signed by OpenStage.".to_string())
}

/// Reads and checks the manifest in one add-on's folder, and whether its signature verifies. An add-on is usable when it does, or when the policy lets a developer's
/// add-on run.
pub fn read_manifest(folder: &Path, policy: &Policy) -> Result<AddonInfo, String> {
    let file = folder.join("addon.json");
    let meta = fs::metadata(&file).map_err(|_| "There is no addon.json.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_MANIFEST {
        return Err("addon.json is not a file of a sensible size.".into());
    }
    // The bytes are read once and these same bytes are both checked against the signature and read as the manifest.
    let raw = fs::read(&file).map_err(|e| format!("addon.json could not be read: {e}"))?;
    if raw.len() as u64 > MAX_MANIFEST {
        return Err("addon.json is not a file of a sensible size.".into());
    }
    let m: Value = serde_json::from_slice(&raw).map_err(|e| format!("addon.json is not JSON: {e}"))?;
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
    let signed = folder.join(SIGNATURE_FILE).is_file();
    let verdict = match &policy.key {
        Some(key) => check_signature(folder, &raw, &host, key),
        None => Err("This editor has no signing key built in yet, so it cannot check an add-on's signature.".to_string()),
    };
    let verified = verdict.is_ok();
    let usable = verified || policy.dev;
    let why = match (&verdict, usable) {
        (_, true) | (Ok(()), _) => None,
        (Err(e), false) => Some(if dev_route_built() { format!("{e} A developer can set OPENSTAGE_DEV_ADDONS=1 to use it while it is being built.") } else { e.clone() }),
    };
    Ok(AddonInfo { id, name, version, description: text(&m, "description").unwrap_or("").chars().take(300).collect(), tiers, commands, signed, verified, usable, why, host })
}

fn version_key(v: &str) -> (u64, u64, u64) {
    let mut p = v.split('.').map(|n| n.parse::<u64>().unwrap_or(0));
    (p.next().unwrap_or(0), p.next().unwrap_or(0), p.next().unwrap_or(0))
}

/// The highest version of each add-on this editor has used, from the add-ons folder. A file that is missing or not what it should be says nothing was used.
fn last_used(root: &Path) -> HashMap<String, String> {
    let file = root.join(LAST_USED_FILE);
    let Ok(meta) = fs::metadata(&file) else { return HashMap::new() };
    if !meta.is_file() || meta.len() > 4096 {
        return HashMap::new();
    }
    let Ok(v) = fs::read_to_string(&file).map_err(|_| ()).and_then(|r| serde_json::from_str::<Value>(&r).map_err(|_| ())) else { return HashMap::new() };
    v.as_object()
        .map(|o| o.iter().filter_map(|(k, v)| v.as_str().filter(|s| version_ok(s) && id_ok(k)).map(|s| (k.clone(), s.to_string()))).collect())
        .unwrap_or_default()
}

/// Notes that a verified add-on is being used, so an older version of it is refused from now on. A failure to write is passed over: the add-on still runs.
pub fn remember_use(root: &Path, addon: &AddonInfo) {
    if !addon.verified {
        return;
    }
    let mut used = last_used(root);
    if used.get(&addon.id).map_or(false, |seen| version_key(seen) >= version_key(&addon.version)) {
        return;
    }
    used.insert(addon.id.clone(), addon.version.clone());
    let mut sorted: Vec<(&String, &String)> = used.iter().collect();
    sorted.sort();
    let body: serde_json::Map<String, Value> = sorted.into_iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
    let _ = fs::write(root.join(LAST_USED_FILE), serde_json::to_string_pretty(&Value::Object(body)).unwrap_or_default());
}

/// Every add-on in the folder that has a good manifest, by folder name. A signed add-on that is an older version than one used before is not usable (a developer's
/// route still lets it run): a signed older version that has a known fault must not be put back.
pub fn find_addons(root: &Path, policy: &Policy) -> Vec<AddonInfo> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut folders: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    folders.sort();
    let used = last_used(root);
    folders
        .iter()
        .filter_map(|f| read_manifest(f, policy).ok())
        .map(|mut a| {
            if a.verified && !policy.dev {
                if let Some(seen) = used.get(&a.id).filter(|seen| version_key(seen) > version_key(&a.version)) {
                    a.usable = false;
                    a.why = Some(format!(
                        "This is version {}, but version {seen} of it has been used on this computer, and the editor does not go back to an older add-on. Install version {seen} or a newer one.",
                        a.version
                    ));
                }
            }
            a
        })
        .collect()
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
    // Its error output is read while it runs, on a thread of its own: the first part is kept to be shown if it gives no answer, and the rest is read and thrown away,
    // so a program that talks a lot there is never left waiting for someone to read, which would hold up its answer until it was stopped.
    let said_aside = child.stderr.take().map(|mut e| {
        std::thread::spawn(move || {
            let mut kept = Vec::new();
            let _ = e.by_ref().take(MAX_STDERR).read_to_end(&mut kept);
            let _ = std::io::copy(&mut e, &mut std::io::sink());
            kept
        })
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
    // The program has ended, so its error output has ended too.
    let err = said_aside.and_then(|t| t.join().ok()).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    Err(format!("The Presenter add-on gave no answer I could read.{}", if err.trim().is_empty() { String::new() } else { format!(" It said: {}", err.trim()) }))
}

/// The usable Presenter add-on, if there is one.
fn the_addon() -> Option<AddonInfo> {
    let root = addons_root()?;
    let found = find_addons(&root, &Policy::current()).into_iter().find(|a| a.id == "presenter" && a.usable)?;
    remember_use(&root, &found);
    Some(found)
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

/// Whether two paths are the same folder, by where they really lead (so a different spelling of the same place counts, and a link into another place does not).
fn same_folder(a: &Path, b: &Path) -> bool {
    matches!((a.canonicalize(), b.canonicalize()), (Ok(a), Ok(b)) if a == b)
}

/// Holds `dir` to the folder of the project that is open (`open`, if there is one): a folder that has a project.json but is some other project is refused.
fn confine_to_open(dir: &str, open: Option<&Path>) -> Result<PathBuf, String> {
    let Some(open) = open else { return Err("No project is open.".into()) };
    if same_folder(Path::new(dir), open) {
        Ok(PathBuf::from(dir))
    } else {
        Err("That is not the project that is open.".into())
    }
}

/// `dir` as a folder the Presenter commands may work in: only the project that is open.
fn in_open_project(dir: &str) -> Result<PathBuf, String> {
    confine_to_open(dir, super::open_project_dir().as_deref())
}

/// The mouth shapes of a piece of narration audio already made for the project (named by its cache key).
#[tauri::command]
pub async fn presenter_mouth_track(dir: String, key: String) -> Result<Value, String> {
    let dir = in_open_project(&dir)?;
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
    let dir = in_open_project(&dir)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(webm.as_bytes()).map_err(|_| "What was made could not be read.".to_string())?;
    save_clip_at(&dir, &name_hint, &bytes)
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
    narration_cues_at(&in_open_project(&dir)?, &key)
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

    /// What an editor made for other people uses: no developer route, and a public key (here, a test key) to check signatures against.
    fn shipped(key: [u8; 32]) -> Policy {
        Policy { key: Some(key), dev: false }
    }
    /// A developer's editor, with no key: only the developer route can run an add-on.
    const DEV: Policy = Policy { key: None, dev: true };

    fn key_pair(seed: u8) -> (ring::signature::Ed25519KeyPair, [u8; 32]) {
        use ring::signature::KeyPair;
        let pair = ring::signature::Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap();
        let mut public = [0u8; 32];
        public.copy_from_slice(pair.public_key().as_ref());
        (pair, public)
    }

    /// Signs the add-on in `folder` as it is now: its addon.json and its host.exe.
    fn sign(folder: &Path, pair: &ring::signature::Ed25519KeyPair) {
        use base64::Engine;
        let message = signed_message(&fs::read(folder.join("addon.json")).unwrap(), &Sha256::digest(fs::read(folder.join("host.exe")).unwrap()));
        fs::write(folder.join(SIGNATURE_FILE), base64::engine::general_purpose::STANDARD.encode(pair.sign(&message).as_ref())).unwrap();
    }

    #[test]
    fn a_good_manifest_is_read_and_is_usable_only_through_the_developer_route() {
        let root = scratch("good");
        let d = addon(&root, "presenter", GOOD, true);
        let (_, public) = key_pair(1);
        let a = read_manifest(&d, &shipped(public)).unwrap();
        assert_eq!((a.id.as_str(), a.version.as_str(), a.tiers.clone(), a.signed, a.verified), ("presenter", "0.1.0", vec!["lite".to_string()], false, false));
        assert!(!a.usable && a.why.as_deref().unwrap().contains("no signature"), "{:?}", a.why);
        assert!(read_manifest(&d, &DEV).unwrap().usable, "the developer route runs an add-on that is not signed");
        assert_eq!(a.host, d.join("host.exe"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn with_no_key_built_in_nothing_is_usable_but_through_the_developer_route() {
        let root = scratch("nokey");
        let d = addon(&root, "presenter", GOOD, true);
        let (pair, _) = key_pair(1);
        sign(&d, &pair);
        let plain = Policy { key: None, dev: false };
        let a = read_manifest(&d, &plain).unwrap();
        assert!(a.signed && !a.verified && !a.usable, "a signature cannot be checked without a key");
        assert!(a.why.as_deref().unwrap().contains("no signing key"));
        assert!(read_manifest(&d, &DEV).unwrap().usable);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_signed_add_on_is_usable_and_anything_changed_since_is_not() {
        let root = scratch("signed");
        let (pair, public) = key_pair(1);
        let policy = shipped(public);
        let d = addon(&root, "presenter", GOOD, true);
        sign(&d, &pair);
        let a = read_manifest(&d, &policy).unwrap();
        assert!(a.signed && a.verified && a.usable && a.why.is_none(), "{:?}", a.why);

        // the program changed
        fs::write(d.join("host.exe"), b"a different program").unwrap();
        let a = read_manifest(&d, &policy).unwrap();
        assert!(a.signed && !a.verified && !a.usable, "a changed program");
        assert!(a.why.as_deref().unwrap().contains("does not match"));
        fs::write(d.join("host.exe"), b"x").unwrap();
        assert!(read_manifest(&d, &policy).unwrap().usable, "put back, it is good again");

        // the manifest changed: the same bytes with a different description
        fs::write(d.join("addon.json"), GOOD.replace("Presenters.", "Something else.")).unwrap();
        let a = read_manifest(&d, &policy).unwrap();
        assert!(!a.verified && !a.usable, "a changed manifest");
        fs::write(d.join("addon.json"), GOOD).unwrap();

        // signed by somebody else
        let (other, _) = key_pair(2);
        sign(&d, &other);
        let a = read_manifest(&d, &policy).unwrap();
        assert!(!a.verified && !a.usable, "a wrong key");

        // a signature that is not a signature
        fs::write(d.join(SIGNATURE_FILE), "not base64 at all!").unwrap();
        assert!(!read_manifest(&d, &policy).unwrap().usable);
        fs::write(d.join(SIGNATURE_FILE), "AAAA").unwrap();
        assert!(!read_manifest(&d, &policy).unwrap().usable);
        fs::write(d.join(SIGNATURE_FILE), "A".repeat(5000)).unwrap();
        assert!(read_manifest(&d, &policy).unwrap().why.as_deref().unwrap().contains("sensible size"));
        let _ = fs::remove_file(d.join(SIGNATURE_FILE));
        assert!(!read_manifest(&d, &policy).unwrap().usable, "no signature");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_signature_made_for_one_add_on_does_not_carry_to_another() {
        let root = scratch("carry");
        let (pair, public) = key_pair(1);
        let policy = shipped(public);
        let a = addon(&root, "presenter", GOOD, true);
        sign(&a, &pair);
        let b = addon(&root, "other", &GOOD.replace("\"presenter\"", "\"other\""), true);
        fs::copy(a.join(SIGNATURE_FILE), b.join(SIGNATURE_FILE)).unwrap();
        assert!(read_manifest(&a, &policy).unwrap().usable);
        assert!(!read_manifest(&b, &policy).unwrap().usable, "the manifest is part of what is signed");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_older_version_than_one_used_is_not_usable_and_a_newer_one_is() {
        let root = scratch("older");
        let (pair, public) = key_pair(1);
        let policy = shipped(public);
        let d = addon(&root, "presenter", &GOOD.replace("0.1.0", "0.3.0"), true);
        sign(&d, &pair);
        let found = find_addons(&root, &policy);
        assert!(found[0].usable, "nothing used yet");
        remember_use(&root, &found[0]);
        assert_eq!(last_used(&root).get("presenter").map(String::as_str), Some("0.3.0"));

        fs::write(d.join("addon.json"), GOOD.replace("0.1.0", "0.2.9")).unwrap();
        sign(&d, &pair);
        let found = find_addons(&root, &policy);
        assert!(found[0].verified && !found[0].usable, "a signed older version is refused");
        assert!(found[0].why.as_deref().unwrap().contains("0.3.0"), "{:?}", found[0].why);
        remember_use(&root, &found[0]);
        assert_eq!(last_used(&root).get("presenter").map(String::as_str), Some("0.3.0"), "an older one never lowers what is remembered");
        let mut as_dev = policy;
        as_dev.dev = true;
        assert!(find_addons(&root, &as_dev)[0].usable, "the developer route may go back");

        fs::write(d.join("addon.json"), GOOD.replace("0.1.0", "0.3.1")).unwrap();
        sign(&d, &pair);
        let found = find_addons(&root, &policy);
        assert!(found[0].usable, "a newer version is fine");
        remember_use(&root, &found[0]);
        assert_eq!(last_used(&root).get("presenter").map(String::as_str), Some("0.3.1"));

        fs::write(d.join("addon.json"), GOOD.replace("0.1.0", "0.10.0")).unwrap();
        sign(&d, &pair);
        assert!(find_addons(&root, &policy)[0].usable, "0.10.0 is newer than 0.3.1, whatever the letters say");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_add_on_that_is_not_verified_is_never_remembered_and_the_memory_is_read_with_care() {
        let root = scratch("remember");
        let d = addon(&root, "presenter", &GOOD.replace("0.1.0", "9.0.0"), true);
        let a = read_manifest(&d, &DEV).unwrap();
        remember_use(&root, &a);
        assert!(!root.join(LAST_USED_FILE).exists(), "a developer's add-on does not set the bar");
        fs::write(root.join(LAST_USED_FILE), r#"{"presenter":"1.2.3","Bad Id":"1.0.0","x":"oops","other":7}"#).unwrap();
        let used = last_used(&root);
        assert_eq!(used.len(), 1);
        assert_eq!(used["presenter"], "1.2.3");
        fs::write(root.join(LAST_USED_FILE), "not json").unwrap();
        assert!(last_used(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_developer_route_exists_only_where_the_build_has_it() {
        assert_eq!(root_setting(true, Some("D:/elsewhere")), Some(PathBuf::from("D:/elsewhere")));
        assert_eq!(root_setting(false, Some("D:/elsewhere")), None, "a build for other people ignores OPENSTAGE_ADDONS");
        assert_eq!(root_setting(true, Some("")), None);
        assert_eq!(root_setting(true, None), None);
        assert!(dev_wanted(true, Some("1")));
        assert!(!dev_wanted(false, Some("1")), "a build for other people ignores OPENSTAGE_DEV_ADDONS");
        assert!(!dev_wanted(true, Some("0")) && !dev_wanted(true, None) && !dev_wanted(true, Some("yes")));
        // The tests are a debug build, which has the route; the installer's build has neither a debug build nor the `dev-addons` feature.
        assert!(dev_route_built());
    }

    #[test]
    fn a_command_works_only_in_the_project_that_is_open() {
        let a = scratch("open-a");
        let b = scratch("open-b");
        fs::write(a.join("project.json"), "{}").unwrap();
        fs::write(b.join("project.json"), "{}").unwrap();
        let a_text = a.to_string_lossy().into_owned();
        let b_text = b.to_string_lossy().into_owned();
        assert_eq!(confine_to_open(&a_text, Some(&a)).unwrap(), PathBuf::from(&a_text));
        assert!(confine_to_open(&b_text, Some(&a)).unwrap_err().contains("not the project that is open"), "another folder that holds a project.json is refused");
        assert!(confine_to_open(&a_text, None).unwrap_err().contains("No project is open"));
        assert!(confine_to_open(&a.join("..").join(a.file_name().unwrap()).to_string_lossy(), Some(&a)).is_ok(), "the same place spelled another way is the same project");
        assert!(confine_to_open(&a.join("nope").to_string_lossy(), Some(&a)).is_err(), "a folder inside it is not it");
        assert!(confine_to_open("", Some(&a)).is_err());
        assert!(confine_to_open(&a_text, Some(&a.join("missing"))).is_err());
        let _ = fs::remove_dir_all(&a);
        let _ = fs::remove_dir_all(&b);
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
            assert!(read_manifest(&d, &DEV).is_err(), "{name} must be refused");
        }
        let d = addon(&root, "nohost", GOOD, false);
        assert!(read_manifest(&d, &DEV).unwrap_err().contains("not in the add-on's folder"));
        let d = root.join("nothing");
        fs::create_dir_all(&d).unwrap();
        assert!(read_manifest(&d, &DEV).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_manifest_that_is_far_too_big_is_not_read() {
        let root = scratch("big");
        let d = addon(&root, "presenter", &format!("{GOOD}{}", " ".repeat(70_000)), true);
        assert!(read_manifest(&d, &DEV).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finding_add_ons_keeps_the_good_ones_in_order_and_skips_the_rest() {
        let root = scratch("find");
        addon(&root, "b-presenter", &GOOD.replace("\"presenter\"", "\"b-one\"").replace("OpenStage Presenter", "B"), true);
        addon(&root, "a-presenter", GOOD, true);
        addon(&root, "broken", "{", true);
        fs::write(root.join("a-file.txt"), "x").unwrap();
        let found = find_addons(&root, &DEV);
        assert_eq!(found.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), vec!["presenter", "b-one"]);
        assert!(find_addons(&root.join("none"), &DEV).is_empty());
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
    fn a_host_that_says_a_great_deal_on_its_error_output_is_still_answered_at_once() {
        let d = scratch("chatty");
        // About 140 KB on standard error, far more than a pipe holds, and then the answer. Nobody reading the error output would leave it waiting until it was stopped.
        let chatty = fake_host(
            &d,
            "for /L %%i in (1,1,2000) do @echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1>&2\r\necho {\"id\":1,\"result\":{\"fine\":true}}",
        );
        let t = Instant::now();
        let r = call_host(&chatty, "presenter.hello", json!({}), Duration::from_secs(30));
        assert_eq!(r.unwrap(), json!({ "fine": true }));
        assert!(t.elapsed() < Duration::from_secs(15), "it was answered after {:?}", t.elapsed());
        // With no answer, the start of what it said is shown, and only the start.
        let silent = fake_host(&d, "for /L %%i in (1,1,2000) do @echo bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 1>&2");
        let e = call_host(&silent, "presenter.hello", json!({}), Duration::from_secs(30)).unwrap_err();
        assert!(e.contains("no answer") && e.contains("bbbb") && e.len() < 2400, "{}", e.len());
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
