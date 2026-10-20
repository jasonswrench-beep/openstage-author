// The editor's native side. It does only what a web page cannot: touch the file system,
// run the validator and the publishing tool, and show a folder picker. Everything the author sees is in the web
// layer, which shares its renderer with the published player.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

mod engine;
mod speech;
mod stream;

/// Tests that use the one job slot, or the recorder slot, take turns, because both are shared by the whole program.
#[cfg(test)]
pub(crate) static JOB_TESTS: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
struct SlideText {
    id: String,
    text: String,
}

#[derive(Serialize)]
struct OpenedProject {
    dir: String,
    /// project.json exactly as it is on disk. Parsed in the web layer, so key order and
    /// every value survive untouched.
    project: String,
    /// theme.json as it is on disk, or None if the project has none.
    theme: Option<String>,
    /// assets.json (where the assets came from) as it is on disk, or None if the project has none.
    assets: Option<String>,
    slides: Vec<SlideText>,
}

#[derive(Deserialize)]
struct FileText {
    path: String,
    text: String,
}

/// Only project.json, theme.json, assets.json and slides/<name>.json may be written. This is what stops a bad
/// slide id or a crafted path from reaching anywhere else on disk.
fn safe_relative(path: &str) -> Result<PathBuf, String> {
    if path == "project.json" || path == "theme.json" || path == "assets.json" {
        return Ok(PathBuf::from(path));
    }
    if let Some(name) = path.strip_prefix("slides/") {
        let ok = name.ends_with(".json")
            && name.len() > ".json".len()
            && !name.starts_with('.')
            && !name.contains('/')
            && !name.contains('\\')
            && !name.contains("..")
            && !name.contains(':');
        if ok {
            return Ok(PathBuf::from("slides").join(name));
        }
    }
    Err(format!("Not a project file path: {path}"))
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

fn open_project_at(dir: &Path) -> Result<OpenedProject, String> {
    let project_text = read_text(&dir.join("project.json"))?;
    let project: serde_json::Value =
        serde_json::from_str(&project_text).map_err(|e| format!("project.json is not valid JSON: {e}"))?;

    let mut ids: Vec<String> = Vec::new();
    if let Some(scenes) = project.get("scenes").and_then(|s| s.as_array()) {
        for scene in scenes {
            if let Some(slides) = scene.get("slides").and_then(|s| s.as_array()) {
                for id in slides.iter().filter_map(|v| v.as_str()) {
                    if !ids.iter().any(|seen| seen == id) {
                        ids.push(id.to_string());
                    }
                }
            }
        }
    }

    let mut slides = Vec::new();
    for id in ids {
        // A slide that is listed but missing, or has an unsafe id, is left out here. The
        // validator reports it, and the editor shows that in the problem list.
        let Ok(rel) = safe_relative(&format!("slides/{id}.json")) else { continue };
        let file = dir.join(rel);
        if file.is_file() {
            slides.push(SlideText { id, text: read_text(&file)? });
        }
    }
    let theme = match project.get("theme").and_then(|t| t.get("ref")).and_then(|r| r.as_str()) {
        Some("theme.json") if dir.join("theme.json").is_file() => Some(read_text(&dir.join("theme.json"))?),
        _ => None,
    };
    let assets = if dir.join("assets.json").is_file() { Some(read_text(&dir.join("assets.json"))?) } else { None };
    Ok(OpenedProject { dir: dir.to_string_lossy().into_owned(), project: project_text, theme, assets, slides })
}

fn write_files(dir: &Path, files: &[FileText], remove: &[String]) -> Result<(), String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    // Check everything before changing anything.
    let removals: Vec<PathBuf> = remove
        .iter()
        .map(|r| {
            if !r.starts_with("slides/") {
                return Err(format!("Only slide files can be removed: {r}"));
            }
            safe_relative(r)
        })
        .collect::<Result<_, _>>()?;
    for f in files {
        safe_relative(&f.path)?;
    }
    for f in files {
        let rel = safe_relative(&f.path)?;
        let target = dir.join(&rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Write beside the file, then swap it in, so a crash cannot leave half a slide.
        let tmp = target.with_extension("json.tmp");
        fs::write(&tmp, f.text.as_bytes()).map_err(|e| format!("Could not write {}: {e}", f.path))?;
        fs::rename(&tmp, &target).map_err(|e| format!("Could not save {}: {e}", f.path))?;
    }
    for rel in removals {
        let target = dir.join(rel);
        if target.is_file() {
            fs::remove_file(&target).map_err(|e| format!("Could not remove {}: {e}", target.display()))?;
        }
    }
    Ok(())
}

/// The kinds of file a project keeps under assets/: the folder each lives in, the extensions
/// allowed, and the largest size.
struct AssetKind {
    noun: &'static str,
    folder: &'static str,
    exts: &'static [&'static str],
    max: u64,
}

/// The kinds of file a course can offer for download. This must match tools/download-types.json, which the validator,
/// the editor and the player read; a test checks that it does. Programs and pages that can run are not here.
const DOWNLOAD_EXTS: &[&str] = &["pdf", "docx", "doc", "odt", "rtf", "txt", "xlsx", "xls", "ods", "csv", "pptx", "ppt", "odp", "zip"];

fn asset_kind(kind: &str) -> Result<AssetKind, String> {
    match kind {
        "image" => Ok(AssetKind { noun: "Images", folder: "images", exts: &["png", "jpg", "jpeg", "gif", "webp", "svg"], max: 50 * 1024 * 1024 }),
        "video" => Ok(AssetKind { noun: "Videos", folder: "video", exts: &["mp4", "webm", "m4v", "ogv"], max: 500 * 1024 * 1024 }),
        "audio" => Ok(AssetKind { noun: "Audio files", folder: "audio", exts: &["mp3", "wav", "ogg", "m4a", "aac"], max: 100 * 1024 * 1024 }),
        "captions" => Ok(AssetKind { noun: "Caption files", folder: "captions", exts: &["vtt"], max: 5 * 1024 * 1024 }),
        "document" => Ok(AssetKind { noun: "Files to download", folder: "documents", exts: DOWNLOAD_EXTS, max: 100 * 1024 * 1024 }),
        other => Err(format!("Unknown kind of asset: {other}")),
    }
}

/// A file name that is safe on any system: letters, digits, hyphens and underscores only.
fn safe_stem(raw: &str, fallback: &str) -> String {
    let stem: String = raw.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let stem = stem.trim_matches('-').to_string();
    if stem.is_empty() { fallback.to_string() } else { stem.chars().take(60).collect() }
}

/// A name in the folder that is not taken: `name.ext`, then `name-2.ext`, and so on. Never overwrites.
fn unique_name(folder: &Path, stem: &str, ext: &str) -> String {
    let mut name = format!("{stem}.{ext}");
    let mut n = 2;
    while folder.join(&name).exists() {
        name = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    name
}

/// Copy a file into the right folder under the project's assets and return its project-relative path.
/// The name is made safe, the type and size are checked, and an existing file is never overwritten.
fn import_asset_at(dir: &Path, source: &Path, kind: &str) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let k = asset_kind(kind)?;
    let ext = source.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !k.exts.contains(&ext.as_str()) {
        return Err(format!("{} must be one of: {}.", k.noun, k.exts.join(", ")));
    }
    let meta = fs::metadata(source).map_err(|e| format!("Could not read the file: {e}"))?;
    if !meta.is_file() {
        return Err("That is not a file.".into());
    }
    if meta.len() > k.max {
        return Err(format!("That file is larger than {} MB.", k.max / (1024 * 1024)));
    }
    let stem = safe_stem(source.file_stem().and_then(|s| s.to_str()).unwrap_or(kind), kind);
    let folder = dir.join("assets").join(k.folder);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = unique_name(&folder, &stem, &ext);
    fs::copy(source, folder.join(&name)).map_err(|e| format!("Could not copy the file: {e}"))?;
    Ok(format!("assets/{}/{name}", k.folder))
}

fn import_image_at(dir: &Path, source: &Path) -> Result<String, String> {
    import_asset_at(dir, source, "image")
}

/// The most a picture the editor drew itself may weigh. A drawn person is a few kilobytes.
const GENERATED_SVG_MAX: usize = 200 * 1024;

/// The biggest picture taken out of a PowerPoint deck that is saved.
const DECK_PICTURE_MAX: usize = 50 * 1024 * 1024;

/// Whether the bytes begin the way a file of this kind does, so a name that says "png" cannot hold something else.
fn picture_matches(ext: &str, bytes: &[u8]) -> bool {
    match ext {
        "png" => bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "jpg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "bmp" => bytes.starts_with(b"BM"),
        _ => false,
    }
}

/// Save a picture that came out of a PowerPoint deck in the project's images. The name is made from what is in the picture
/// (`pptx-` and 14 letters and numbers), so the same picture is the same file however often it is brought in: a name that is
/// already there is left as it is. Anything else is refused, and the bytes have to be what the name says they are.
fn save_deck_picture_at(dir: &Path, name: &str, bytes: &[u8]) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let (stem, ext) = name.rsplit_once('.').ok_or("That is not a name for a picture from a deck.")?;
    let hash = stem.strip_prefix("pptx-").unwrap_or("");
    if hash.len() != 14 || !hash.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)) {
        return Err("That is not a name for a picture from a deck.".into());
    }
    if bytes.len() > DECK_PICTURE_MAX {
        return Err("That picture is bigger than it should be.".into());
    }
    if !picture_matches(ext, bytes) {
        return Err("That is not a picture of the kind its name says.".into());
    }
    let folder = dir.join("assets").join("images");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let target = folder.join(name);
    if !target.exists() {
        fs::write(&target, bytes).map_err(|e| format!("Could not save the picture: {e}"))?;
    }
    Ok(format!("assets/images/{name}"))
}

/// Save a picture taken from a recording (the picture of a step) as a PNG in the project's images, and return its project-relative path. The bytes have to be a
/// real PNG, and not enormous. The name is made safe from `name_hint`, and a file that is already there is never overwritten (a new name is made).
fn save_step_picture_at(dir: &Path, name_hint: &str, bytes: &[u8]) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if bytes.len() > DECK_PICTURE_MAX {
        return Err("That picture is bigger than it should be.".into());
    }
    if !picture_matches("png", bytes) {
        return Err("That is not a PNG picture.".into());
    }
    let folder = dir.join("assets").join("images");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = unique_name(&folder, &safe_stem(name_hint, "step"), "png");
    let temp = folder.join(format!("{name}.tmp"));
    fs::write(&temp, bytes).map_err(|e| format!("Could not save the picture: {e}"))?;
    fs::rename(&temp, folder.join(&name)).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Could not save the picture: {e}")
    })?;
    Ok(format!("assets/images/{name}"))
}

/// Save a picture the editor drew itself (a person made in the avatar maker) as an SVG in the project's images, and return its
/// project-relative path. Only a plain drawing is accepted: nothing that can run, load another page or file, or reach out. The name is
/// made safe, and an existing file is never overwritten.
fn save_generated_svg_at(dir: &Path, name_hint: &str, svg: &str) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if svg.len() > GENERATED_SVG_MAX {
        return Err("That picture is larger than it should be.".into());
    }
    let lower = svg.to_ascii_lowercase();
    if !lower.trim_start().starts_with("<svg") {
        return Err("That is not a picture the editor drew.".into());
    }
    for bad in ["<script", "javascript:", "<foreignobject", "<iframe", "<image", "<use", "<style", "<!entity", "<!doctype", "href=", "xlink:", "@import", "url("] {
        if lower.contains(bad) {
            return Err(format!("A drawn picture cannot contain {bad}."));
        }
    }
    // Any attribute that starts with "on" is an event handler.
    for (at, _) in lower.match_indices("on") {
        let before = lower[..at].chars().next_back();
        if !matches!(before, Some(c) if c.is_whitespace() || c == '"' || c == '\'') {
            continue;
        }
        let word: String = lower[at..].chars().take_while(|c| c.is_ascii_alphabetic()).collect();
        if lower[at + word.len()..].trim_start().starts_with('=') {
            return Err("A drawn picture cannot contain an event handler.".into());
        }
    }
    let stem = safe_stem(name_hint, "picture");
    let folder = dir.join("assets").join("images");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let name = unique_name(&folder, &stem, "svg");
    fs::write(folder.join(&name), svg).map_err(|e| format!("Could not save the picture: {e}"))?;
    Ok(format!("assets/images/{name}"))
}

#[derive(Serialize, Debug, PartialEq)]
struct AssetFile {
    path: String,
    kind: String,
    size: u64,
}

/// Every file in the project's asset folders, for the library.
fn list_assets_at(dir: &Path) -> Result<Vec<AssetFile>, String> {
    let mut out = Vec::new();
    for kind in ["image", "video", "audio", "captions", "document"] {
        let k = asset_kind(kind)?;
        let folder = dir.join("assets").join(k.folder);
        let Ok(entries) = fs::read_dir(&folder) else { continue };
        let mut names: Vec<(String, u64)> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .filter_map(|e| Some((e.file_name().to_str()?.to_string(), e.metadata().ok()?.len())))
            .filter(|(n, _)| !n.starts_with('.'))
            .collect();
        names.sort();
        for (name, size) in names {
            out.push(AssetFile { path: format!("assets/{}/{name}", k.folder), kind: kind.to_string(), size });
        }
    }
    Ok(out)
}

/// Remove one file from the project's assets. Only a file under assets/ can go.
fn delete_asset_at(dir: &Path, rel: &str) -> Result<(), String> {
    let rel_path = Path::new(rel);
    let clean = rel.starts_with("assets/") && rel_path.components().all(|c| matches!(c, Component::Normal(_)));
    if !clean {
        return Err(format!("Not an asset path: {rel}"));
    }
    let target = dir.join(rel_path);
    if !target.is_file() {
        return Err(format!("{rel} is not in the project."));
    }
    fs::remove_file(&target).map_err(|e| format!("Could not remove {rel}: {e}"))
}

// ---- the web, for stock assets
//
// Searching a stock library and downloading from it happen here, not in the web page, so the page
// needs no permission to reach the internet and can only reach the hosts listed below.

/// The only sites the editor will talk to: the stock libraries, and the servers they send files from.
/// A host matches if it is one of these or a subdomain of one (so images.pexels.com counts as pexels.com).
const SITES: [&str; 4] = ["unsplash.com", "pixabay.com", "pexels.com", "freesound.org"];

fn allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        #[cfg(test)]
        if url.starts_with("http://127.0.0.1:") {
            return true;
        }
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
    if host.is_empty() || host.contains('@') || host.contains(':') {
        return false;
    }
    SITES.iter().any(|site| host == *site || host.ends_with(&format!(".{site}")))
}

/// Some of these sites refuse requests that do not say who is asking.
const USER_AGENT: &str = "OpenStageAuthor/0.1 (free open-source eLearning authoring tool)";

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(60)).user_agent(USER_AGENT).build()
}

/// Fetch an address. A service that says "too many requests, try again in a second" is waited for and tried
/// again, up to three times and about ten seconds in all. A longer wait is reported, with how long.
fn fetch(url: &str, headers: &[(String, String)]) -> Result<ureq::Response, String> {
    if !allowed_url(url) {
        return Err("That address is not one OpenStage may contact.".into());
    }
    let mut attempt = 0;
    loop {
        let mut req = agent().get(url).set("Accept", "*/*");
        for (k, v) in headers {
            // Only the headers a stock library needs.
            if matches!(k.to_ascii_lowercase().as_str(), "authorization" | "accept-version" | "accept") {
                req = req.set(k, v);
            }
        }
        match req.call() {
            Ok(resp) => return Ok(resp),
            Err(ureq::Error::Status(429, resp)) if attempt < 3 => {
                if std::env::var("OPENSTAGE_DEBUG_HTTP").is_ok() { eprintln!("429 attempt {attempt} for {url}: retry-after {:?}", resp.header("Retry-After")); }
                let wait = resp.header("Retry-After").and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(2);
                if wait > 10 {
                    return Err(format!("The service says there have been too many requests, and asks you to wait about {}.{}", human_wait(wait), detail_of(resp)));
                }
                std::thread::sleep(Duration::from_millis(wait.max(1) * 1000 + 300 * attempt));
                attempt += 1;
            }
            Err(ureq::Error::Status(code, resp)) => {
                let more = detail_of(resp);
                return Err(match code {
                    401 | 403 => format!("The service refused the request. If it needs a key, check the key in Settings.{more}"),
                    429 => format!("The service says there have been too many requests. Wait a little and try again.{more}"),
                    400 => format!("The service did not accept the search.{more}"),
                    _ => format!("The service answered with an error ({code}).{more}"),
                });
            }
            Err(other) => return Err(format!("Could not reach the service. Check the internet connection. ({other})")),
        }
    }
}

/// "45 seconds" or "10 minutes", for telling someone how long to wait.
fn human_wait(secs: u64) -> String {
    if secs < 90 { format!("{secs} seconds") } else { format!("{} minutes", (secs + 30) / 60) }
}

/// " It said: ..." from an error reply, or nothing if it said nothing useful.
fn detail_of(resp: ureq::Response) -> String {
    let detail = service_detail(&resp.into_string().unwrap_or_default());
    if detail.is_empty() { String::new() } else { format!(" It said: {detail}") }
}

/// What a service says is wrong, from the usual places in its error reply, kept short.
fn service_detail(body: &str) -> String {
    let from_json = serde_json::from_str::<serde_json::Value>(body).ok().and_then(|v| {
        ["detail", "message", "error"].iter().find_map(|k| v.get(*k).and_then(|x| x.as_str()).map(|s| s.to_string()))
    });
    // A web page instead of data (some services answer a limit with one) says nothing useful, so it is left out.
    let text = from_json.unwrap_or_else(|| if body.trim_start().starts_with('<') { String::new() } else { body.trim().to_string() });
    text.chars().filter(|c| !c.is_control()).take(160).collect()
}

fn http_get_text(url: &str, headers: &[(String, String)]) -> Result<String, String> {
    let resp = fetch(url, headers)?;
    let limit = 5 * 1024 * 1024u64;
    let mut bytes = Vec::new();
    resp.into_reader().take(limit + 1).read_to_end(&mut bytes).map_err(|e| format!("The download was interrupted: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err("That answer is too large.".into());
    }
    String::from_utf8(bytes).map_err(|_| "The service sent something that is not text.".to_string())
}

/// The extension a download should have, from what the server says it is, or failing that from the address.
fn ext_for(kind: &str, content_type: &str, url: &str) -> Option<&'static str> {
    let ct = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let by_type: &[(&str, &'static str)] = match kind {
        "image" => &[("image/jpeg", "jpg"), ("image/png", "png"), ("image/gif", "gif"), ("image/webp", "webp"), ("image/svg+xml", "svg")],
        "video" => &[("video/mp4", "mp4"), ("video/webm", "webm"), ("video/ogg", "ogv"), ("video/x-m4v", "m4v")],
        "audio" => &[
            ("audio/mpeg", "mp3"), ("audio/mp3", "mp3"), ("audio/ogg", "ogg"), ("application/ogg", "ogg"), ("audio/wav", "wav"), ("audio/x-wav", "wav"),
            ("audio/wave", "wav"), ("audio/mp4", "m4a"), ("audio/x-m4a", "m4a"), ("audio/aac", "aac"),
        ],
        _ => return None,
    };
    if let Some((_, ext)) = by_type.iter().find(|(t, _)| *t == ct) {
        return Some(ext);
    }
    let tail = url.split(['?', '#']).next().unwrap_or("").rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let tail = if tail == "jpeg" { "jpg".to_string() } else { tail };
    asset_kind(kind).ok()?.exts.iter().find(|e| **e == tail).copied()
}

/// Download a file from a stock library into the project's assets and return its path. The file is
/// written as it arrives, so a large video never has to fit in memory, and a failed or oversize
/// download leaves nothing behind.
fn download_asset_at(dir: &Path, url: &str, name_hint: &str, kind: &str) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let k = asset_kind(kind)?;
    let resp = fetch(url, &[])?;
    let content_type = resp.content_type().to_string();
    let noun = match kind { "image" => "picture", "video" => "video", _ => "sound" };
    let ext = ext_for(kind, &content_type, url).ok_or(format!("The download was not a {noun} OpenStage can use."))?;
    let folder = dir.join("assets").join(k.folder);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let part = folder.join(format!(".download-{}.part", std::process::id()));
    let written = (|| {
        let mut file = fs::File::create(&part).map_err(|e| format!("Could not save the {noun}: {e}"))?;
        let n = std::io::copy(&mut resp.into_reader().take(k.max + 1), &mut file).map_err(|e| format!("The download was interrupted: {e}"))?;
        if n > k.max {
            return Err(format!("That {noun} is larger than {} MB.", k.max / (1024 * 1024)));
        }
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    let name = unique_name(&folder, &safe_stem(name_hint, kind), ext);
    fs::rename(&part, folder.join(&name)).map_err(|e| format!("Could not save the {noun}: {e}"))?;
    Ok(format!("assets/{}/{name}", k.folder))
}

/// Make a new project in an empty folder (which may not exist yet). It refuses a folder that
/// already has anything in it, so creating a project can never overwrite someone's files.
fn create_project_at(dir: &Path, files: &[FileText]) -> Result<(), String> {
    if dir.exists() {
        if !dir.is_dir() {
            return Err("That path is a file, not a folder.".into());
        }
        let occupied = fs::read_dir(dir).map_err(|e| e.to_string())?.next().is_some();
        if occupied {
            return Err("That folder is not empty. Choose an empty folder, or make a new one.".into());
        }
    }
    // Check every path before writing anything.
    let rels: Vec<PathBuf> = files.iter().map(|f| safe_relative(&f.path)).collect::<Result<_, _>>()?;
    if !files.iter().any(|f| f.path == "project.json") {
        return Err("A project needs a project.json.".into());
    }
    for sub in ["slides", "assets/images", "assets/video", "assets/audio"] {
        fs::create_dir_all(dir.join(sub)).map_err(|e| e.to_string())?;
    }
    // Keep the empty media folders when the project is put under version control.
    for sub in ["assets/images", "assets/video", "assets/audio"] {
        fs::write(dir.join(sub).join(".gitkeep"), b"").map_err(|e| e.to_string())?;
    }
    for (f, rel) in files.iter().zip(rels) {
        fs::write(dir.join(rel), f.text.as_bytes()).map_err(|e| format!("Could not write {}: {e}", f.path))?;
    }
    Ok(())
}

fn find_validator() -> Option<PathBuf> {
    find_tool("validate.py")
}

/// Find one of the repository's Python tools, looking up from the program and from where it was started.
fn find_tool(name: &str) -> Option<PathBuf> {
    find_repo_file(&format!("tools/{name}"))
}

/// Find a file of the repository (such as tools/validate.py or player/publish.ts), looking upward from the
/// program, from where it was started, and from OPENSTAGE_REPO if that is set.
fn find_repo_file(rel: &str) -> Option<PathBuf> {
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(repo) = std::env::var("OPENSTAGE_REPO") {
        starts.push(PathBuf::from(repo));
    }
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    find_in(&starts, rel)
}

/// The first `rel` found by looking upward from each of the starting places in turn.
fn find_in(starts: &[PathBuf], rel: &str) -> Option<PathBuf> {
    for start in starts {
        for ancestor in start.ancestors() {
            let candidate = ancestor.join(rel);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn validate_blocking(dir: &Path, files: &[FileText]) -> Result<String, String> {
    let validator = find_validator().ok_or("Could not find tools/validate.py.")?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp = std::env::temp_dir().join(format!("openstage-validate-{}-{stamp}", std::process::id()));
    fs::create_dir_all(temp.join("slides")).map_err(|e| e.to_string())?;

    let result = (|| {
        for f in files {
            let rel = safe_relative(&f.path)?;
            fs::write(temp.join(rel), f.text.as_bytes()).map_err(|e| e.to_string())?;
        }
        let python = std::env::var("OPENSTAGE_PYTHON").unwrap_or_else(|_| "python".into());
        let mut cmd = Command::new(python);
        // No -I here. Isolated mode would ignore packages installed for just the current user,
        // which is where "pip install --user" puts jsonschema.
        cmd.arg(&validator)
            .arg(&temp)
            .arg("--json")
            .arg("--asset-root")
            .arg(dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // no console window flashing up
        }
        let out = cmd.output().map_err(|e| format!("Could not run Python to validate: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        if stdout.trim().is_empty() {
            return Err(format!(
                "The validator produced no result. {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(stdout)
    })();
    let _ = fs::remove_dir_all(&temp);
    result
}

/// Update an older project to the current format, using the same migrate.py the command line uses.
/// It keeps a backup of the old files inside the project. Returns the tool's JSON report.
fn migrate_blocking(dir: &Path) -> Result<String, String> {
    let tool = find_tool("migrate.py").ok_or("Could not find tools/migrate.py.")?;
    let python = std::env::var("OPENSTAGE_PYTHON").unwrap_or_else(|_| "python".into());
    let mut cmd = Command::new(python);
    cmd.arg(&tool).arg(dir).arg("--json");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("Could not run Python to update the project: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// ---- preview and publish
//
// Both run the player's publish.ts under Node, so there is exactly one way a course is published: the same
// one the command line uses. Only one runs at a time, and it can be cancelled.

/// True while a preview or publish is running.
static JOB_BUSY: AtomicBool = AtomicBool::new(false);
/// The process of the running job, so it can be stopped.
static JOB_PID: Mutex<Option<u32>> = Mutex::new(None);
static JOB_CANCELLED: AtomicBool = AtomicBool::new(false);

fn job_pid() -> std::sync::MutexGuard<'static, Option<u32>> {
    JOB_PID.lock().unwrap_or_else(|e| e.into_inner())
}

/// Held while a job runs. Taking it fails if another is running, and dropping it makes room for the next.
struct JobSlot;

impl JobSlot {
    fn take() -> Result<JobSlot, String> {
        // A recording has the computer's attention. Heavy work waits until it is paused or stopped.
        if stream::blocks_jobs() {
            return Err(stream::BUSY_MESSAGE.into());
        }
        if JOB_BUSY.swap(true, Ordering::SeqCst) {
            return Err("A preview or publish is already running. Wait for it to finish, or cancel it.".into());
        }
        JOB_CANCELLED.store(false, Ordering::SeqCst);
        Ok(JobSlot)
    }
}

impl Drop for JobSlot {
    fn drop(&mut self) {
        *job_pid() = None;
        JOB_BUSY.store(false, Ordering::SeqCst);
    }
}

enum JobError {
    /// The program to run was not found.
    Missing,
    Cancelled,
    Failed(String),
}

/// Stop a process and everything it started (Node starts Python).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(0x0800_0000).output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
    }
}

/// Run a command to the end and return what it printed. Cancelling the job stops it.
fn run_job(cmd: Command) -> Result<std::process::Output, JobError> {
    run_job_input(cmd, None)
}

/// The same, with some bytes written to the program's standard input (a request for it to read). It is written from a
/// thread of its own, so a request larger than the pipe never stops the program from being waited for.
fn run_job_input(mut cmd: Command, input: Option<Vec<u8>>) -> Result<std::process::Output, JobError> {
    cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window flashing up
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound { JobError::Missing } else { JobError::Failed(e.to_string()) }
    })?;
    let pid = child.id();
    *job_pid() = Some(pid);
    if JOB_CANCELLED.load(Ordering::SeqCst) {
        kill_tree(pid); // cancelled in the instant before it started
    }
    let writer = input.and_then(|bytes| {
        child.stdin.take().map(|mut stdin| {
            std::thread::spawn(move || {
                use std::io::Write;
                let _ = stdin.write_all(&bytes);
            })
        })
    });
    let out = child.wait_with_output().map_err(|e| JobError::Failed(e.to_string()))?;
    if let Some(writer) = writer {
        let _ = writer.join();
    }
    *job_pid() = None;
    if JOB_CANCELLED.swap(false, Ordering::SeqCst) {
        return Err(JobError::Cancelled);
    }
    Ok(out)
}

/// Stop the running preview or publish, if there is one. Returns whether there was one to stop.
fn cancel_job_now() -> bool {
    if !JOB_BUSY.load(Ordering::SeqCst) {
        return false;
    }
    JOB_CANCELLED.store(true, Ordering::SeqCst);
    let pid = *job_pid();
    if let Some(pid) = pid {
        kill_tree(pid);
    }
    true
}

/// Run a command to the end, handing every line it prints to `on_line`, as it prints it. Both streams are read, and a carriage return ends a line as well as a new line,
/// because progress bars rewrite one line with them. Cancelling the job stops it.
fn run_streaming(mut cmd: Command, mut on_line: impl FnMut(&str)) -> Result<std::process::ExitStatus, JobError> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window flashing up
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound { JobError::Missing } else { JobError::Failed(e.to_string()) }
    })?;
    let pid = child.id();
    *job_pid() = Some(pid);
    if JOB_CANCELLED.load(Ordering::SeqCst) {
        kill_tree(pid); // cancelled in the instant before it started
    }
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    fn reader<R: Read + Send + 'static>(mut stream: R, tx: std::sync::mpsc::Sender<String>) -> std::thread::JoinHandle<()> {
        std::thread::spawn(move || {
            let mut pending: Vec<u8> = Vec::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = stream.read(&mut buf) {
                if n == 0 {
                    break;
                }
                for &b in &buf[..n] {
                    if b == b'\n' || b == b'\r' {
                        let line = String::from_utf8_lossy(&pending).trim().to_string();
                        pending.clear();
                        if !line.is_empty() && tx.send(line).is_err() {
                            return;
                        }
                    } else {
                        pending.push(b);
                    }
                }
            }
            let line = String::from_utf8_lossy(&pending).trim().to_string();
            if !line.is_empty() {
                let _ = tx.send(line);
            }
        })
    }
    let readers: Vec<_> = [child.stdout.take().map(|s| reader(s, tx.clone())), child.stderr.take().map(|s| reader(s, tx.clone()))].into_iter().flatten().collect();
    drop(tx);
    for line in rx {
        on_line(&line);
    }
    for r in readers {
        let _ = r.join();
    }
    let status = child.wait().map_err(|e| JobError::Failed(e.to_string()))?;
    *job_pid() = None;
    if JOB_CANCELLED.swap(false, Ordering::SeqCst) {
        return Err(JobError::Cancelled);
    }
    Ok(status)
}

/// Without the \\?\ that Windows puts on a fully resolved path, which not every program understands.
fn plain_path(p: PathBuf) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(rest) => PathBuf::from(rest),
        None => p,
    }
}

/// Run publish.ts on a project folder, writing to `out`, and return the one line of JSON it prints.
/// The JSON says whether it worked (ok), and if not why (message, findings). A tool that cannot run at all is
/// an Err with a message for the author.
fn run_publish_tool(project: &Path, out: &Path, preview: bool) -> Result<String, String> {
    let _slot = JobSlot::take()?;
    let script = find_repo_file("player/publish.ts").ok_or("Could not find player/publish.ts.")?;
    let player = script.parent().ok_or("Could not find the player folder.")?;
    if !player.join("node_modules").join("esbuild").is_dir() {
        return Err("The player's build tools are not installed yet. Close OpenStage Author and open it again with OPEN EDITOR.bat, which installs them.".into());
    }
    let node = std::env::var("OPENSTAGE_NODE").unwrap_or_else(|_| "node".into());
    let mut cmd = Command::new(node);
    cmd.current_dir(player).arg(&script).arg(project).arg(out).arg("--json");
    // Publishing makes missing narration audio with the speech engine, so it is told which one (the editor's own, if the author has not named another).
    if let Some((python, _)) = managed_engine() {
        cmd.env("OPENSTAGE_KOKORO_PYTHON", python);
        apply_engine_env(&mut cmd);
    }
    if preview {
        cmd.arg("--preview");
    }
    let output = match run_job(cmd) {
        Ok(o) => o,
        Err(JobError::Missing) => {
            return Err("Preview and Publish need Node.js, which was not found on this computer. Install the LTS version from https://nodejs.org, then close OpenStage Author and open it again.".into())
        }
        Err(JobError::Cancelled) => return Ok(r#"{"ok":false,"cancelled":true,"message":"Publishing was cancelled.","findings":[]}"#.to_string()),
        Err(JobError::Failed(e)) => return Err(format!("Could not run the publishing tool: {e}")),
    };
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    match stdout.lines().rev().find(|l| l.trim_start().starts_with('{')) {
        Some(line) => Ok(line.to_string()),
        None => {
            let said = String::from_utf8_lossy(&output.stderr);
            let tail: Vec<&str> = said.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
            Err(format!("The publishing tool stopped without a result. {}", tail.join(" ").trim()).trim().to_string())
        }
    }
}

/// The name of the folder a course is published into, taken from the project's folder.
fn course_folder_name(project: &Path) -> String {
    let raw = project.file_name().and_then(|n| n.to_str()).unwrap_or("course");
    let stem = if raw.to_ascii_lowercase().ends_with(".osproj") { &raw[..raw.len() - ".osproj".len()] } else { raw };
    safe_stem(stem, "course")
}

/// A path made absolute and free of links, even when its last parts do not exist yet: the part that exists is
/// resolved and the rest is added on.
fn resolve_planned(path: &Path) -> Result<PathBuf, String> {
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut at = path.to_path_buf();
    loop {
        if at.exists() {
            let mut base = plain_path(at.canonicalize().map_err(|e| e.to_string())?);
            for part in rest.iter().rev() {
                base.push(part);
            }
            return Ok(base);
        }
        match (at.file_name().map(|n| n.to_os_string()), at.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                at = parent.to_path_buf();
            }
            _ => return Err(format!("{} cannot be used as a folder.", path.display())),
        }
    }
}

/// Where a publish into `folder` will write, after checking that it is safe to empty: never the project or
/// anything holding it or inside it, and never a folder of the author's own files that happens to share the name.
fn publish_target(project: &Path, folder: &Path) -> Result<PathBuf, String> {
    if !project.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if !folder.is_absolute() {
        return Err("Choose a folder to publish into.".into());
    }
    let project = plain_path(project.canonicalize().map_err(|e| e.to_string())?);
    // The folder may not exist yet. Nothing is made until every check has passed, so a refused place is left alone.
    let folder = resolve_planned(folder)?;
    let out = folder.join(course_folder_name(&project));
    if out.starts_with(&project) || project.starts_with(&out) {
        return Err("Choose a folder outside the project. Publishing writes a copy of the course, and it cannot go inside the project.".into());
    }
    if out.exists() {
        if !out.is_dir() {
            return Err(format!("There is a file called {} in that folder. Choose another place.", out.file_name().and_then(|n| n.to_str()).unwrap_or("")));
        }
        let empty = fs::read_dir(&out).map_err(|e| e.to_string())?.next().is_none();
        let earlier_publish = out.join("index.html").is_file() && out.join("player.js").is_file();
        if !empty && !earlier_publish {
            return Err(format!(
                "There is already a folder called {} in that folder, with other things in it. Choose another place, or move that folder away first.",
                out.file_name().and_then(|n| n.to_str()).unwrap_or("")
            ));
        }
    }
    Ok(out)
}

/// Publish the project as it is on disk. The page saves first.
fn publish_blocking(project: &Path, folder: &Path) -> Result<String, String> {
    let out = publish_target(project, folder)?;
    run_publish_tool(&plain_path(project.canonicalize().map_err(|e| e.to_string())?), &out, false)
}

/// Put a file in `dst`: a hard link when the two are on the same drive (instant, and no copy of a big video),
/// otherwise a copy. Folders are made as needed.
fn link_tree(src: &Path, dst: &Path) -> Result<(), String> {
    if src.is_dir() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            link_tree(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else if src.is_file() {
        if fs::hard_link(src, dst).is_err() {
            fs::copy(src, dst).map_err(|e| format!("Could not copy {}: {e}", src.display()))?;
        }
        Ok(())
    } else {
        Ok(())
    }
}

/// Delete previews left in `root` that are older than `max_age`. A preview is kept for a while because a browser
/// tab may still be showing it.
fn clear_old_previews(root: &Path, max_age: Duration) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > max_age);
        if old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Write the editor's project files (only the paths a project may have) into a folder, making it if needed.
fn write_project_files(project: &Path, files: &[FileText]) -> Result<(), String> {
    fs::create_dir_all(project.join("slides")).map_err(|e| e.to_string())?;
    for f in files {
        let rel = safe_relative(&f.path)?;
        fs::write(project.join(rel), f.text.as_bytes()).map_err(|e| format!("Could not write {}: {e}", f.path))?;
    }
    Ok(())
}

/// Lay out a copy of the project as it is in the editor now (saved or not): its files from `files`, and its
/// assets and cached narration audio linked from the real folder. Returns the copy's project folder and the folder
/// the course goes into.
fn prepare_preview(dir: &Path, files: &[FileText], root: &Path) -> Result<(PathBuf, PathBuf), String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    clear_old_previews(root, Duration::from_secs(24 * 60 * 60));
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let home = root.join(format!("{}-{stamp}", course_folder_name(dir)));
    let project = home.join(dir.file_name().and_then(|n| n.to_str()).map(|n| safe_stem(n, "project")).unwrap_or_else(|| "project".into()));
    write_project_files(&project, files)?;
    for shared in ["assets", ".cache"] {
        link_tree(&dir.join(shared), &project.join(shared))?;
    }
    Ok((project, home.join("course")))
}

fn preview_blocking(dir: &Path, files: &[FileText]) -> Result<String, String> {
    let root = std::env::temp_dir().join("openstage-author-preview");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let (project, out) = prepare_preview(dir, files, &root)?;
    let result = run_publish_tool(&project, &out, true);
    // A preview that did not come out leaves nothing behind. (One that did is kept, because a browser is showing it.)
    if !matches!(&result, Ok(json) if json.starts_with(r#"{"ok":true"#)) {
        if let Some(home) = project.parent() {
            let _ = fs::remove_dir_all(home);
        }
    }
    result
}

// ---- narration audio
//
// The editor never makes audio itself. tools/narrate.py makes it, in the speech engine's own Python (the one named by
// OPENSTAGE_KOKORO_PYTHON), and keeps it in the project's .cache/narration, each file named by a hash of what was said.

const NO_ENGINE: &str = "No speech engine is set up on this computer, so audio cannot be made here. Transcripts and captions still work. Install the narration voice with the button in the Narration dialog, then try again. (If you set up Kokoro yourself, name its Python in a file called local-settings.bat next to OPEN EDITOR.bat: docs/narration-setup.md says how.)";

/// The editor's own data folder on this computer (where the speech models and the narration engine are kept), as soon as the program has started.
static DATA_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// The narration engine this editor installs, if there is a data folder to put it in.
fn engine_layout() -> Option<engine::Layout> {
    DATA_DIR.get().map(|dir| engine::Layout::in_data_dir(dir))
}

/// The Python that travels with an installed editor, if this is one.
fn bundled_python() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    bundled_helper_in(exe.parent()?, "python", "python.exe")
}

/// The Python the author named for Kokoro (OPENSTAGE_KOKORO_PYTHON), if it is there. It wins over everything else.
fn engine_setting() -> Option<PathBuf> {
    std::env::var("OPENSTAGE_KOKORO_PYTHON").ok().map(PathBuf::from).filter(|p| p.is_file())
}

/// The engine the editor installed itself: the Python that came with it, and where the packages and the model are. None if the author has named their own, or none is installed.
fn managed_engine() -> Option<(PathBuf, engine::Layout)> {
    if engine_setting().is_some() {
        return None;
    }
    let layout = engine_layout()?;
    if !engine::installed(&layout) {
        return None;
    }
    Some((bundled_python()?, layout))
}

/// The speech engine's Python, if one is set up: the author's own (OPENSTAGE_KOKORO_PYTHON), or the one the editor installed.
fn engine_path() -> Option<PathBuf> {
    engine_setting().or_else(|| managed_engine().map(|(python, _)| python))
}

/// Give a command what the engine the editor installed needs to run (where its packages and its model are). Does nothing for an engine the author set up.
fn apply_engine_env(cmd: &mut Command) {
    if let Some((_, layout)) = managed_engine() {
        for (name, value) in engine::environment(&layout, std::env::var("PYTHONPATH").ok().as_deref()) {
            cmd.env(name, value);
        }
    }
}

/// A narration cache key: the 64 hex digits of a SHA-256. Anything else is refused before it can name a file.
fn is_cache_key(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Serialize)]
struct CachedNarration {
    hash: String,
    duration: f64,
    /// The size of the audio file in bytes, so the editor can say how much clearing unused audio frees.
    size: u64,
    #[serde(rename = "exactTimings")]
    exact_timings: bool,
}

/// The audio that has been made for a project: every key with both its sound and its caption timings.
fn narration_cache_at(dir: &Path) -> Result<Vec<CachedNarration>, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let folder = dir.join(".cache").join("narration");
    let Ok(entries) = fs::read_dir(&folder) else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(key) = name.strip_suffix(".json") else { continue };
        if !is_cache_key(key) || !folder.join(format!("{key}.wav")).is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(entry.path()) else { continue };
        let Ok(meta) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        out.push(CachedNarration {
            hash: key.to_string(),
            duration: meta["duration"].as_f64().unwrap_or(0.0),
            size: fs::metadata(folder.join(format!("{key}.wav"))).map(|m| m.len()).unwrap_or(0),
            exact_timings: meta["exactTimings"].as_bool().unwrap_or(false),
        });
    }
    out.sort_by(|a, b| a.hash.cmp(&b.hash));
    Ok(out)
}

/// Delete narration audio that nothing uses any more, by key. Only a real key (64 hex digits) names a file, nothing is deleted unless every key is
/// real, and only the .wav and .json of each key inside the project's own .cache/narration are removed. Returns how many keys had a file removed.
fn delete_narration_audio_at(dir: &Path, keys: &[String]) -> Result<usize, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if !keys.iter().all(|k| is_cache_key(k)) {
        return Err("That is not narration audio.".into());
    }
    let folder = dir.join(".cache").join("narration");
    let mut removed = 0;
    for key in keys {
        let mut any = false;
        for ext in ["wav", "json"] {
            let file = folder.join(format!("{key}.{ext}"));
            if file.is_file() && fs::remove_file(&file).is_ok() {
                any = true;
            }
        }
        if any {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Keep audio that was made for one key under another, because the two keys name the same sound (the language of a script said by a voice that does not change with it). The sound
/// and its timings are copied, not moved, so the old key still has its audio, and the timings' own `hash` is made to say the new key. Returns whether anything was copied: false when
/// the old audio is not there or the new key already has its own. Only real keys name files, and only inside the project's own .cache/narration.
fn reuse_narration_audio_at(dir: &Path, from: &str, to: &str) -> Result<bool, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if !is_cache_key(from) || !is_cache_key(to) {
        return Err("That is not narration audio.".into());
    }
    let folder = dir.join(".cache").join("narration");
    let (from_wav, from_json) = (folder.join(format!("{from}.wav")), folder.join(format!("{from}.json")));
    let (to_wav, to_json) = (folder.join(format!("{to}.wav")), folder.join(format!("{to}.json")));
    if from == to || (to_wav.is_file() && to_json.is_file()) || !from_wav.is_file() || !from_json.is_file() {
        return Ok(false);
    }
    let text = fs::read_to_string(&from_json).map_err(|e| format!("Could not read the audio's timings: {e}"))?;
    let mut meta: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("The audio's timings could not be read: {e}"))?;
    let Some(object) = meta.as_object_mut() else { return Err("The audio's timings could not be read.".into()) };
    object.insert("hash".into(), serde_json::Value::String(format!("sha256:{to}")));
    // The sound first, under a temporary name; the timings last, because the audio only counts as made when both are there.
    let part = folder.join(format!("{to}.wav.part"));
    fs::copy(&from_wav, &part).map_err(|e| format!("Could not keep the audio: {e}"))?;
    fs::rename(&part, &to_wav).map_err(|e| {
        let _ = fs::remove_file(&part);
        format!("Could not keep the audio: {e}")
    })?;
    let out = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(&to_json, out).map_err(|e| format!("Could not keep the audio's timings: {e}"))?;
    Ok(true)
}

fn read_narration_audio_at(dir: &Path, key: &str) -> Result<Vec<u8>, String> {
    if !is_cache_key(key) {
        return Err("That is not a narration audio file.".into());
    }
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    fs::read(dir.join(".cache").join("narration").join(format!("{key}.wav"))).map_err(|e| format!("Could not read the audio: {e}"))
}

/// What the author is told when the speech engine runs but fails.
fn engine_failure(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    // narrate.py says why each engine failed in a "NOT MADE:" line, in words meant for the author already.
    let mut said: Vec<String> = Vec::new();
    for reason in lines.iter().filter_map(|l| l.strip_prefix("NOT MADE: ")) {
        let text = if reason.contains("Kokoro is not available") {
            "The speech engine is set up, but Kokoro is not installed in it. Set OPENSTAGE_KOKORO_PYTHON to a Python that has Kokoro installed, then open OpenStage Author again.".to_string()
        } else {
            reason.to_string()
        };
        if !said.contains(&text) {
            said.push(text);
        }
    }
    if !said.is_empty() {
        return said.join(" ");
    }
    if stderr.contains("Kokoro is not available") {
        return "The speech engine is set up, but Kokoro is not installed in it. Set OPENSTAGE_KOKORO_PYTHON to a Python that has Kokoro installed, then open OpenStage Author again.".to_string();
    }
    let tail: Vec<&str> = lines.iter().rev().take(3).rev().copied().collect();
    format!("The speech engine stopped before it finished. {}", tail.join(" ")).trim().to_string()
}

/// Whether `key` can name something narrated: an object's id, or an interaction item's "<object id>/<item id>".
/// Each part is letters, digits, hyphens and underscores, so a key can never reach outside the project or split a list.
fn narration_key_ok(key: &str) -> bool {
    let part_ok = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    let mut parts = key.split('/');
    let first = parts.next().unwrap_or("");
    let second = parts.next();
    part_ok(first) && second.map_or(true, part_ok) && parts.next().is_none()
}

/// Make audio for the project as it is in the editor now, saved or not: the editor's files are laid out in a
/// temporary folder, the speech tool runs on them, and the audio goes into the real project's .cache.
/// `ids` are the narrations to make audio for (see `narration_key_ok`), or none to make everything that is missing.
#[cfg(test)]
fn make_narration_blocking(engine: &Path, dir: &Path, files: &[FileText], ids: &[String]) -> Result<String, String> {
    make_narration_with(engine, true, dir, files, ids, &AiSettings::default(), None)
}

/// The same, with the services and plugins the author has allowed. `kokoro_ready` says whether `engine` is a Python set up for Kokoro
/// (OPENSTAGE_KOKORO_PYTHON) or only an ordinary Python, which can still make audio with a service or a plugin.
fn make_narration_with(engine: &Path, kokoro_ready: bool, dir: &Path, files: &[FileText], ids: &[String], ai: &AiSettings, plugins: Option<&Path>) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if !ids.iter().all(|id| narration_key_ok(id)) {
        return Err("Not an object that can be narrated.".into());
    }
    let _slot = JobSlot::take()?;
    let tool = find_tool("narrate.py").ok_or("Could not find tools/narrate.py.")?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let temp = std::env::temp_dir().join(format!("openstage-author-narrate-{}-{stamp}", std::process::id()));
    let result = (|| {
        write_project_files(&temp, files)?;
        let mut cmd = Command::new(engine);
        cmd.arg(&tool).arg(&temp).arg("--json").arg("--cache-root").arg(dir);
        if !ids.is_empty() {
            cmd.arg("--only").arg(ids.join(","));
        }
        if kokoro_ready {
            apply_engine_env(&mut cmd);
        }
        apply_ai(&mut cmd, ai, plugins);
        match run_job(cmd) {
            Ok(out) if out.status.success() => Ok(serde_json::json!({ "ok": true }).to_string()),
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                let message = if !kokoro_ready && stderr.contains("Kokoro is not available") { NO_ENGINE.to_string() } else { engine_failure(&stderr) };
                Ok(serde_json::json!({ "ok": false, "message": message }).to_string())
            }
            Err(JobError::Cancelled) => Ok(serde_json::json!({ "ok": false, "cancelled": true, "message": "Making audio was cancelled." }).to_string()),
            Err(JobError::Missing) if !kokoro_ready => Err(NO_PYTHON.into()),
            Err(JobError::Missing) => Err("The speech engine could not be started. Check OPENSTAGE_KOKORO_PYTHON.".into()),
            Err(JobError::Failed(e)) => Err(format!("Could not run the speech engine: {e}")),
        }
    })();
    let _ = fs::remove_dir_all(&temp);
    result
}

// ---- AI services and voice plugins
//
// Pictures and voices can come from a service the author has a key for (OpenAI), and voices from plugins the
// author has installed and switched on. All of it goes through the Python tools (tools/narrate.py, tools/generate.py), which are
// the only place that talks to those services, so there is one place that checks the author's permission and one place that
// handles a key. This file's part is small and strict:
//   - the key and the permission live in the settings file, never in a project; a service is handed its key only if the author
//     has said yes to it, and the key goes in an environment variable, never on a command line where other programs can see it;
//   - what comes back is checked (is it really a picture, is it a sensible size) before it is saved in the project.

/// The services OpenStage can send text or a description to with the author's own key. The same names are in tools/engines.
const AI_SERVICES: [&str; 1] = ["openai"];

#[derive(Default, Debug)]
struct AiSettings {
    keys: std::collections::BTreeMap<String, String>,
    /// The services the author has said may receive their text and descriptions.
    allowed: std::collections::BTreeSet<String>,
    /// The model the author chose for a service and a kind of work ("speech", "picture"). Not a secret.
    models: std::collections::BTreeMap<(String, String), String>,
    /// The plugins the author has switched on.
    plugins: Vec<String>,
}

fn plugin_id_ok(id: &str) -> bool {
    let b = id.as_bytes();
    (2..=31).contains(&b.len()) && b[0].is_ascii_lowercase() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn model_name_ok(name: &str) -> bool {
    let b = name.as_bytes();
    (1..=64).contains(&b.len()) && b[0].is_ascii_alphanumeric() && b.iter().all(|c| c.is_ascii_alphanumeric() || matches!(*c, b'.' | b'_' | b':' | b'-'))
}

impl AiSettings {
    /// What the settings file says under "ai". A missing or damaged file says nothing, which means nothing is allowed.
    fn parse(text: &str) -> AiSettings {
        let mut out = AiSettings::default();
        let Ok(root) = serde_json::from_str::<serde_json::Value>(text) else { return out };
        let ai = &root["ai"];
        for service in AI_SERVICES {
            if let Some(key) = ai["keys"][service].as_str() {
                let key = key.trim();
                if !key.is_empty() {
                    out.keys.insert(service.to_string(), key.to_string());
                }
            }
            let said_yes = match &ai["allowed"][service] {
                serde_json::Value::String(when) => !when.trim().is_empty(),
                serde_json::Value::Bool(b) => *b,
                _ => false,
            };
            if said_yes {
                out.allowed.insert(service.to_string());
            }
            for kind in ["speech", "picture"] {
                if let Some(name) = ai["models"][service][kind].as_str().map(str::trim) {
                    if model_name_ok(name) {
                        out.models.insert((service.to_string(), kind.to_string()), name.to_string());
                    }
                }
            }
        }
        if let Some(plugins) = ai["plugins"].as_object() {
            out.plugins = plugins.iter().filter(|(id, on)| on.as_bool() == Some(true) && plugin_id_ok(id)).map(|(id, _)| id.clone()).collect();
        }
        out
    }

    /// Whether a service may be used now: it has a key and the author has said yes to it.
    fn may_use(&self, service: &str) -> bool {
        self.allowed.contains(service) && self.keys.contains_key(service)
    }
}

/// Hand a tool what it is allowed to use: the keys of the services the author has allowed (as environment variables),
/// the models they chose, which services may be reached, and the plugins folder with the plugins switched on.
fn apply_ai(cmd: &mut Command, ai: &AiSettings, plugins_dir: Option<&Path>) {
    cmd.env("PYTHONIOENCODING", "utf-8");
    let usable: Vec<&str> = AI_SERVICES.iter().copied().filter(|s| ai.may_use(s)).collect();
    for service in &usable {
        cmd.env(format!("OPENSTAGE_KEY_{}", service.to_uppercase()), &ai.keys[*service]);
    }
    for ((service, kind), name) in &ai.models {
        cmd.env(format!("OPENSTAGE_MODEL_{}_{}", service.to_uppercase(), kind.to_uppercase()), name);
    }
    if !usable.is_empty() {
        cmd.arg("--allow-network").arg(usable.join(","));
    }
    if let Some(dir) = plugins_dir {
        cmd.arg("--plugins-dir").arg(dir);
        if !ai.plugins.is_empty() {
            cmd.arg("--plugins-enabled").arg(ai.plugins.join(","));
        }
    }
}

/// Where the author puts voice plugins: a folder beside the editor's settings.
fn plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("plugins"))
}

fn ai_settings(app: &tauri::AppHandle) -> AiSettings {
    settings_file(app).ok().and_then(|f| fs::read_to_string(f).ok()).map(|t| AiSettings::parse(&t)).unwrap_or_default()
}

/// The Python that runs the tools that need only the standard library.
fn tools_python() -> PathBuf {
    PathBuf::from(std::env::var("OPENSTAGE_PYTHON").unwrap_or_else(|_| "python".into()))
}

const NO_PYTHON: &str = "Python could not be started, and it is needed to reach these services and to run voice plugins. Install Python from python.org (tick Add python.exe to PATH), or set OPENSTAGE_PYTHON to its python.exe, then open OpenStage Author again.";

/// Run tools/generate.py for one job and return its answer. The answer is a JSON object with ok, and if not ok a message.
fn run_generate(python: &Path, op: &str, request: &serde_json::Value, ai: &AiSettings, plugins_dir: Option<&Path>) -> Result<serde_json::Value, String> {
    let _slot = JobSlot::take()?;
    let tool = find_tool("generate.py").ok_or("Could not find tools/generate.py.")?;
    let mut cmd = Command::new(python);
    cmd.arg(&tool).arg(op);
    apply_ai(&mut cmd, ai, plugins_dir);
    match run_job_input(cmd, Some(request.to_string().into_bytes())) {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let line = text.lines().rev().find(|l| l.trim_start().starts_with('{')).unwrap_or("");
            serde_json::from_str(line).map_err(|_| "The tool did not give an answer OpenStage understands.".to_string())
        }
        Ok(out) => {
            let tail: Vec<String> = String::from_utf8_lossy(&out.stderr).lines().map(str::trim).filter(|l| !l.is_empty()).rev().take(3).map(str::to_string).collect();
            Err(format!("The tool stopped before it finished. {}", tail.into_iter().rev().collect::<Vec<_>>().join(" ")).trim().to_string())
        }
        Err(JobError::Cancelled) => Ok(serde_json::json!({ "ok": false, "cancelled": true, "message": "Cancelled." })),
        Err(JobError::Missing) => Err(NO_PYTHON.into()),
        Err(JobError::Failed(e)) => Err(format!("Could not run the tool: {e}")),
    }
}

/// Save a picture a service made in the project's images, and return its project-relative path. The bytes have to be a real WebP,
/// and a file that is already there is never overwritten.
fn save_generated_picture_at(dir: &Path, name_hint: &str, bytes: &[u8]) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if !picture_matches("webp", bytes) {
        return Err("What came back was not a picture OpenStage can use.".into());
    }
    let k = asset_kind("image")?;
    if bytes.len() as u64 > k.max {
        return Err(format!("That picture is larger than {} MB.", k.max / (1024 * 1024)));
    }
    let folder = dir.join("assets").join(k.folder);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let stem: String = format!("ai-{}", safe_stem(name_hint, "made")).chars().take(48).collect();
    let name = unique_name(&folder, stem.trim_end_matches('-'), "webp");
    fs::write(folder.join(&name), bytes).map_err(|e| format!("Could not save the picture: {e}"))?;
    Ok(format!("assets/{}/{name}", k.folder))
}

/// The words a service is asked to draw, cut to a short name for the file.
fn name_from_prompt(prompt: &str) -> String {
    prompt.split_whitespace().take(5).collect::<Vec<_>>().join("-")
}

/// Make a picture and save it in the project. `request` has the service, the prompt and the choices (see tools/generate.py).
/// The answer is JSON: ok, and then the path, the service and the model; or ok false and why.
fn ai_make_blocking(python: &Path, dir: &Path, kind: &str, request: &serde_json::Value, ai: &AiSettings) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let (op, suffix) = match kind {
        "picture" => ("picture", "webp"),
        _ => return Err("Only a picture can be made.".into()),
    };
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let temp = std::env::temp_dir().join(format!("openstage-author-make-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    let result = (|| {
        let out = temp.join(format!("made.{suffix}"));
        let mut sent = serde_json::Map::new();
        for field in ["service", "prompt", "size", "quality"] {
            if let Some(v) = request.get(field) {
                sent.insert(field.to_string(), v.clone());
            }
        }
        sent.insert("out".into(), out.to_string_lossy().into_owned().into());
        let answer = run_generate(python, op, &serde_json::Value::Object(sent), ai, None)?;
        if answer["ok"].as_bool() != Some(true) {
            return Ok(answer.to_string());
        }
        let bytes = fs::read(&out).map_err(|_| "The service answered, but nothing was saved.".to_string())?;
        let hint = name_from_prompt(request["prompt"].as_str().unwrap_or(""));
        let path = save_generated_picture_at(dir, &hint, &bytes)?;
        Ok(serde_json::json!({ "ok": true, "path": path, "service": answer["service"], "model": answer["model"], "bytes": bytes.len() }).to_string())
    })();
    let _ = fs::remove_dir_all(&temp);
    result
}

/// The voice plugins in the plugins folder, and whether each is switched on. Nothing is run and nothing is sent.
#[tauri::command]
async fn ai_plugins(app: tauri::AppHandle) -> Result<String, String> {
    let dir = plugins_dir(&app)?;
    let ai = ai_settings(&app);
    tauri::async_runtime::spawn_blocking(move || run_generate(&tools_python(), "plugins", &serde_json::json!({}), &ai, Some(&dir)).map(|v| v.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// The plugins folder, made if it is not there yet.
#[tauri::command]
fn ai_plugins_folder(app: tauri::AppHandle) -> Result<String, String> {
    let dir = plugins_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make the plugins folder: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Ask a service something that costs nothing: whether the key works (op "check").
#[tauri::command]
async fn ai_service(app: tauri::AppHandle, op: String, service: String) -> Result<String, String> {
    if op != "check" {
        return Err("Not something a service can be asked.".into());
    }
    let ai = ai_settings(&app);
    tauri::async_runtime::spawn_blocking(move || run_generate(&tools_python(), &op, &serde_json::json!({ "service": service }), &ai, None).map(|v| v.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Make a picture with a service and save it in the project's images. This is the one thing here that costs money.
#[tauri::command]
async fn ai_make(app: tauri::AppHandle, dir: String, kind: String, request: String) -> Result<String, String> {
    let request: serde_json::Value = serde_json::from_str(&request).map_err(|_| "The request was not understood.".to_string())?;
    let ai = ai_settings(&app);
    tauri::async_runtime::spawn_blocking(move || ai_make_blocking(&tools_python(), Path::new(&dir), &kind, &request, &ai))
        .await
        .map_err(|e| e.to_string())?
}

// ---- Hearing a voice before choosing it
//
// A sample is one short fixed sentence in a voice, made by tools/voice_sample.py the first time and kept in the editor's own cache folder (not in
// a project), so hearing the same voice again costs nothing. None of the author's words are used. The tool decides what a sample is called; this
// side only passes the request on, and reads back a file it has checked is named like a sample and is a sensible size.

/// The most a sample can weigh: a few seconds of speech is well under a megabyte, so anything near this is not a sample.
const MAX_SAMPLE_BYTES: u64 = 8 * 1024 * 1024;

/// A voice's name as it may be passed to the tool: some characters, not too many, nothing that is not printable. (The tool checks the voice
/// itself; this stops anything odd from being sent at all.)
fn voice_name_ok(voice: &str) -> bool {
    (1..=100).contains(&voice.chars().count()) && voice.chars().all(|c| !c.is_control())
}

/// A language code such as en-US or fr-FR.
fn language_ok(lang: &str) -> bool {
    (1..=16).contains(&lang.len()) && lang.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// The sample file the tool named, read from the cache. It has to be named like one (64 hex digits and .wav), so the answer of a damaged or
/// replaced tool can never point at some other file.
fn read_sample_at(cache: &Path, file: &str) -> Result<Vec<u8>, String> {
    let named = file.strip_suffix(".wav").is_some_and(is_cache_key);
    if !named {
        return Err("The sample was not named the way a sample is.".into());
    }
    let path = cache.join(file);
    let size = fs::metadata(&path).map(|m| m.len()).map_err(|_| "The sample was made, but it could not be found.".to_string())?;
    if size > MAX_SAMPLE_BYTES {
        return Err("The sample is larger than a sample should be.".into());
    }
    fs::read(&path).map_err(|e| format!("Could not read the sample: {e}"))
}

/// Make a sample of a voice, or find the one kept, and answer with JSON: ok, then the audio (a WAV as base64), whether it was kept already, and
/// who makes the voice; or ok false and why. `engine` is the Python to run the tool in (Kokoro's own for a Kokoro voice).
fn voice_sample_blocking(engine: &Path, voice: &str, lang: &str, cache: &Path, ai: &AiSettings, plugins: Option<&Path>) -> Result<String, String> {
    use base64::Engine;
    if !voice_name_ok(voice) || !language_ok(lang) {
        return Err("That is not a voice.".into());
    }
    let _slot = JobSlot::take()?;
    let tool = find_tool("voice_sample.py").ok_or("Could not find tools/voice_sample.py.")?;
    let mut cmd = Command::new(engine);
    cmd.arg(&tool).arg("--cache-dir").arg(cache);
    apply_ai(&mut cmd, ai, plugins);
    let kokoro = !voice.contains(':');
    if kokoro {
        apply_engine_env(&mut cmd);
    }
    let request = serde_json::json!({ "voice": voice, "lang": lang }).to_string().into_bytes();
    match run_job_input(cmd, Some(request)) {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let line = text.lines().rev().find(|l| l.trim_start().starts_with('{')).unwrap_or("");
            let answer: serde_json::Value = serde_json::from_str(line).map_err(|_| "The tool did not give an answer OpenStage understands.".to_string())?;
            if answer["ok"].as_bool() != Some(true) {
                return Ok(serde_json::json!({ "ok": false, "message": answer["message"].as_str().unwrap_or("The sample could not be made.") }).to_string());
            }
            let bytes = read_sample_at(cache, answer["file"].as_str().unwrap_or(""))?;
            Ok(serde_json::json!({
                "ok": true,
                "audio": base64::engine::general_purpose::STANDARD.encode(bytes),
                "cached": answer["cached"].as_bool().unwrap_or(false),
                "engine": answer["engine"], "name": answer["name"], "where": answer["where"], "duration": answer["duration"],
            })
            .to_string())
        }
        Ok(out) => {
            let tail: Vec<String> = String::from_utf8_lossy(&out.stderr).lines().map(str::trim).filter(|l| !l.is_empty()).rev().take(3).map(str::to_string).collect();
            Err(format!("The tool stopped before it finished. {}", tail.into_iter().rev().collect::<Vec<_>>().join(" ")).trim().to_string())
        }
        Err(JobError::Cancelled) => Ok(serde_json::json!({ "ok": false, "cancelled": true, "message": "Cancelled." }).to_string()),
        Err(JobError::Missing) if kokoro => Err("The speech engine could not be started. Check OPENSTAGE_KOKORO_PYTHON.".into()),
        Err(JobError::Missing) => Err(NO_PYTHON.into()),
        Err(JobError::Failed(e)) => Err(format!("Could not run the tool: {e}")),
    }
}

/// Where samples are kept: the editor's own cache folder, which is safe to empty at any time.
fn voice_samples_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("voice-samples"))
}

/// A short sample of a voice, to hear before choosing it. A Kokoro voice is made on this computer, for nothing; a voice of a service goes to the
/// service the first time (a very small charge) and is then kept.
#[tauri::command]
async fn voice_sample(app: tauri::AppHandle, voice: String, lang: String) -> Result<String, String> {
    let cache = voice_samples_dir(&app)?;
    let ai = ai_settings(&app);
    let plugins = plugins_dir(&app).ok();
    // Kokoro needs the Python it is installed in. Everything else needs only an ordinary Python.
    let engine = if voice.contains(':') {
        tools_python()
    } else {
        match engine_path() {
            Some(path) => path,
            None => return Ok(serde_json::json!({ "ok": false, "message": NO_ENGINE }).to_string()),
        }
    };
    tauri::async_runtime::spawn_blocking(move || voice_sample_blocking(&engine, &voice, &lang, &cache, &ai, plugins.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

fn read_asset_at(dir: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let rel_path = Path::new(rel);
    let clean = rel.starts_with("assets/")
        && rel_path.components().all(|c| matches!(c, Component::Normal(_)));
    if !clean {
        return Err(format!("Not an asset path: {rel}"));
    }
    fs::read(dir.join(rel_path)).map_err(|e| format!("Could not read {rel}: {e}"))
}

fn image_mime(rel: &str) -> &'static str {
    match rel.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// An asset as a data URL (data:<type>;base64,...), which the page can use as an image source
/// directly. This avoids sending raw binary through the command channel.
fn asset_data_url(dir: &Path, rel: &str) -> Result<String, String> {
    use base64::Engine;
    let bytes = read_asset_at(dir, rel)?;
    Ok(format!(
        "data:{};base64,{}",
        image_mime(rel),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn read_asset_url(dir: String, path: String) -> Result<String, String> {
    asset_data_url(Path::new(&dir), &path)
}

#[tauri::command]
fn open_project(dir: String) -> Result<OpenedProject, String> {
    open_project_at(Path::new(&dir))
}

#[tauri::command]
fn save_files(dir: String, files: Vec<FileText>, remove: Vec<String>) -> Result<(), String> {
    write_files(Path::new(&dir), &files, &remove)
}

#[tauri::command]
fn save_generated_image(dir: String, name: String, svg: String) -> Result<String, String> {
    save_generated_svg_at(Path::new(&dir), &name, &svg)
}

/// A picture from a PowerPoint deck. It arrives as base64 text, because raw bytes do not travel well through the page.
/// The picture of a step, taken from a recording in the page. It arrives as base64 text, because raw bytes do not travel well through the page.
#[tauri::command]
fn save_step_picture(dir: String, name_hint: String, data: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|_| "That picture could not be read.".to_string())?;
    save_step_picture_at(Path::new(&dir), &name_hint, &bytes)
}

#[tauri::command]
fn save_deck_picture(dir: String, name: String, data: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|_| "That picture could not be read.".to_string())?;
    save_deck_picture_at(Path::new(&dir), &name, &bytes)
}

#[tauri::command]
fn import_image(dir: String, source: String) -> Result<String, String> {
    import_image_at(Path::new(&dir), Path::new(&source))
}

#[tauri::command]
fn import_asset(dir: String, source: String, kind: String) -> Result<String, String> {
    import_asset_at(Path::new(&dir), Path::new(&source), &kind)
}

#[tauri::command]
fn list_assets(dir: String) -> Result<Vec<AssetFile>, String> {
    list_assets_at(Path::new(&dir))
}

#[tauri::command]
fn delete_asset(dir: String, path: String) -> Result<(), String> {
    delete_asset_at(Path::new(&dir), &path)
}

#[tauri::command]
async fn http_get(url: String, headers: Vec<(String, String)>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || http_get_text(&url, &headers)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn download_asset(dir: String, url: String, name_hint: String, kind: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_asset_at(Path::new(&dir), &url, &name_hint, &kind))
        .await
        .map_err(|e| e.to_string())?
}

/// The editor's own settings (such as stock-library keys) live with the program, never in a project.
fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Result<String, String> {
    let file = settings_file(&app)?;
    Ok(fs::read_to_string(file).unwrap_or_default())
}

#[tauri::command]
fn write_settings(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let file = settings_file(&app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(file, text).map_err(|e| format!("Could not save the settings: {e}"))
}

#[tauri::command]
fn create_project(dir: String, files: Vec<FileText>) -> Result<(), String> {
    create_project_at(Path::new(&dir), &files)
}

#[tauri::command]
async fn migrate_project(dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || migrate_blocking(Path::new(&dir)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn validate(dir: String, files: Vec<FileText>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || validate_blocking(Path::new(&dir), &files))
        .await
        .map_err(|e| e.to_string())?
}

/// Make the course as it is in the editor right now, saved or not, in a temporary folder, and say where.
#[tauri::command]
async fn preview_project(dir: String, files: Vec<FileText>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || preview_blocking(Path::new(&dir), &files))
        .await
        .map_err(|e| e.to_string())?
}

/// Publish the saved project: a folder of web files and a SCORM 1.2 zip, written beside each other in `folder`.
#[tauri::command]
async fn publish_project(dir: String, folder: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || publish_blocking(Path::new(&dir), Path::new(&folder)))
        .await
        .map_err(|e| e.to_string())?
}

/// Whether a speech engine is set up on this computer.
#[tauri::command]
fn narration_engine() -> bool {
    engine_path().is_some()
}

/// The narration audio that has been made for a project.
#[tauri::command]
fn narration_cache(dir: String) -> Result<Vec<CachedNarration>, String> {
    narration_cache_at(Path::new(&dir))
}

/// One piece of narration audio, by its key, to play in the editor. It goes as base64 text, because raw bytes
/// do not come through the command channel as binary in this app (images travel the same way).
#[tauri::command]
fn read_narration_audio(dir: String, hash: String) -> Result<String, String> {
    use base64::Engine;
    read_narration_audio_at(Path::new(&dir), &hash).map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Keep the audio of one key under another, when they name the same sound. See `reuse_narration_audio_at`.
#[tauri::command]
fn reuse_narration_audio(dir: String, from: String, to: String) -> Result<bool, String> {
    reuse_narration_audio_at(Path::new(&dir), &from, &to)
}

/// Delete the narration audio the editor says nothing uses any more.
#[tauri::command]
fn delete_narration_audio(dir: String, keys: Vec<String>) -> Result<usize, String> {
    delete_narration_audio_at(Path::new(&dir), &keys)
}

/// Make narration audio. The answer is JSON: ok, and if not, why.
#[tauri::command]
async fn make_narration(app: tauri::AppHandle, dir: String, files: Vec<FileText>, ids: Vec<String>) -> Result<String, String> {
    // Kokoro's own Python if there is one. Without it an ordinary Python still makes audio for a service or a plugin voice.
    let (engine, kokoro_ready) = match engine_path() {
        Some(path) => (path, true),
        None => (tools_python(), false),
    };
    let ai = ai_settings(&app);
    let plugins = plugins_dir(&app).ok();
    tauri::async_runtime::spawn_blocking(move || make_narration_with(&engine, kokoro_ready, Path::new(&dir), &files, &ids, &ai, plugins.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

// ---- the narration engine, installed from a button
//
// The pure parts (where it lives, the environment, the commands) are in engine.rs. This runs them with progress and Stop, as one job.

const NO_BUNDLED_PYTHON: &str = "This copy of OpenStage Author has no Python of its own to install the narration voice with (it is being run from the source folder). Set OPENSTAGE_KOKORO_PYTHON to a Python that has Kokoro installed, as docs/narration-setup.md says.";

/// The time as ISO 8601 in UTC, from seconds since 1970, without a library for it.
fn iso_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rest / 3600, rest % 3600 / 60, rest % 60)
}

/// What the page needs to know to offer the engine: whether there is one, whose it is, whether the editor can install one, and how much room it takes.
#[derive(Serialize)]
struct EngineStatus {
    /// "setting" (the author named a Python), "installed" (the editor's own), or "none".
    state: &'static str,
    #[serde(rename = "canInstall")]
    can_install: bool,
    /// Why it cannot be installed here, when it cannot.
    problem: String,
    /// Microsoft's Visual C++ runtime, which the voice needs, is not on this computer (the page offers to open Microsoft's download).
    #[serde(rename = "runtimeMissing")]
    runtime_missing: bool,
    folder: String,
    /// The bytes the installed engine takes (0 if none).
    size: u64,
}

/// Windows' own System32 folder.
fn system_dir() -> PathBuf {
    PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())).join("System32")
}

fn engine_install_problem() -> String {
    let Some(python) = bundled_python() else { return NO_BUNDLED_PYTHON.to_string() };
    if !engine::runtime_missing(&system_dir()).is_empty() {
        return format!("The narration voice needs Microsoft's Visual C++ runtime, which is not on this computer. Install it from Microsoft ({}), then try again.", engine::RUNTIME_URL);
    }
    let pip = python.parent().map(|p| p.join("Lib").join("site-packages").join("pip")).filter(|p| p.is_dir());
    if pip.is_none() {
        return "The Python that came with this copy has no pip, so the narration voice cannot be installed from here.".to_string();
    }
    if engine_layout().is_none() {
        return "The editor has no data folder to install the narration voice into.".to_string();
    }
    if find_tool("narration-requirements.txt").is_none() {
        return "The list of what the narration voice needs (tools/narration-requirements.txt) is missing from this copy.".to_string();
    }
    String::new()
}

/// What the About window shows: the version and where things are. Words and paths only: no key, nothing from a course.
#[derive(Serialize)]
struct AboutInfo {
    version: String,
    installed: bool,
    program: String,
    #[serde(rename = "guidesFile")]
    guides_file: String,
    python: String,
    node: String,
    recorder: String,
    recogniser: String,
    data: String,
    settings: String,
    engine: String,
    webview: String,
    windows: String,
    arch: String,
}

/// The Windows version as `ver` says it ("Microsoft Windows [Version 10.0.26200.1]"), or "unknown".
fn windows_version() -> String {
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "ver"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "unknown".into())
}

/// A helper's place for the About window: the one that is set or found, or what would be used.
fn about_where(found: Option<PathBuf>, otherwise: &str) -> String {
    found.map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| otherwise.to_string())
}

#[tauri::command]
fn about_info(app: tauri::AppHandle) -> Result<String, String> {
    let program = std::env::current_exe().ok();
    let python = std::env::var("OPENSTAGE_PYTHON").ok().map(PathBuf::from);
    let node = std::env::var("OPENSTAGE_NODE").ok().map(PathBuf::from);
    let guides = find_repo_file("docs/narration-setup.md");
    let engine = if engine_setting().is_some() {
        "The one you set up yourself (OPENSTAGE_KOKORO_PYTHON)".to_string()
    } else if managed_engine().is_some() {
        "Installed by OpenStage Author".to_string()
    } else {
        "Not installed".to_string()
    };
    let info = AboutInfo {
        version: app.package_info().version.to_string(),
        installed: bundled_python().is_some(),
        program: about_where(program, "unknown"),
        guides_file: guides.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        python: about_where(python, "python, found on the PATH"),
        node: about_where(node, "node, found on the PATH"),
        recorder: capture_program().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "not found".into()),
        recogniser: speech_program().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "not found".into()),
        data: app.path().app_local_data_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "unknown".into()),
        settings: settings_file(&app).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "unknown".into()),
        engine,
        webview: tauri::webview_version().unwrap_or_else(|_| "unknown".into()),
        windows: windows_version(),
        arch: std::env::consts::ARCH.to_string(),
    };
    serde_json::to_string(&info).map_err(|e| e.to_string())
}

#[tauri::command]
fn engine_status() -> Result<String, String> {
    let layout = engine_layout();
    let problem = engine_install_problem();
    let state = if engine_setting().is_some() { "setting" } else if managed_engine().is_some() { "installed" } else { "none" };
    let size = layout.as_ref().map(|l| engine::folder_size(&l.root)).unwrap_or(0);
    serde_json::to_string(&EngineStatus {
        state,
        can_install: problem.is_empty(),
        runtime_missing: bundled_python().is_some() && !engine::runtime_missing(&system_dir()).is_empty(),
        problem,
        folder: layout.map(|l| l.root.to_string_lossy().into_owned()).unwrap_or_default(),
        size,
    })
    .map_err(|e| e.to_string())
}

/// Run the install steps one after another. `progress(step, steps, label, line)` hears what each prints (not more than a few times a second). Returns the lines of the last step on failure.
fn engine_install_blocking(python: &Path, layout: &engine::Layout, requirements: &Path, mut progress: impl FnMut(usize, usize, &str, &str)) -> Result<(), String> {
    fs::create_dir_all(&layout.site).map_err(|e| format!("Could not make a folder for the narration voice: {e}"))?;
    fs::create_dir_all(&layout.home).map_err(|e| format!("Could not make a folder for the narration voice: {e}"))?;
    let _ = fs::remove_dir_all(&layout.tmp);
    fs::create_dir_all(&layout.tmp).map_err(|e| format!("Could not make a folder for the narration voice: {e}"))?;
    let _ = fs::remove_file(layout.marker()); // until it has all gone well, it is not installed
    let result = engine_install_steps(python, layout, requirements, &mut progress);
    let _ = fs::remove_dir_all(&layout.tmp); // pip's workings, whether it finished, failed or was stopped
    result
}

fn engine_install_steps(python: &Path, layout: &engine::Layout, requirements: &Path, progress: &mut impl FnMut(usize, usize, &str, &str)) -> Result<(), String> {
    let steps = engine::steps(layout, requirements);
    for (i, step) in steps.iter().enumerate() {
        progress(i + 1, steps.len(), &step.label, "");
        let mut cmd = Command::new(python);
        cmd.args(&step.args).current_dir(&layout.root);
        for (name, value) in engine::install_environment(layout, std::env::var("PYTHONPATH").ok().as_deref()) {
            cmd.env(name, value);
        }
        let mut tail: Vec<String> = Vec::new();
        let mut last = std::time::Instant::now() - Duration::from_secs(1);
        let outcome = run_streaming(cmd, |line| {
            tail.push(line.to_string());
            if tail.len() > 6 {
                tail.remove(0);
            }
            if last.elapsed() >= Duration::from_millis(250) {
                last = std::time::Instant::now();
                progress(i + 1, steps.len(), &step.label, line);
            }
        });
        match outcome {
            Ok(status) if status.success() => {}
            Ok(_) => return Err(format!("{} did not finish. It said: {}", step.label, tail.iter().rev().take(2).rev().cloned().collect::<Vec<_>>().join(" "))),
            Err(JobError::Cancelled) => return Err("Installing the narration voice was stopped. Pressing the button again installs it from the start.".into()),
            Err(JobError::Missing) => return Err("The Python that came with this copy could not be started.".into()),
            Err(JobError::Failed(e)) => return Err(format!("Could not run {}: {e}", step.label)),
        }
    }
    let when = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let list = fs::read_to_string(requirements).unwrap_or_default();
    fs::write(layout.marker(), engine::marker_json(&iso_utc(when), &list)).map_err(|e| format!("Could not write down that the narration voice is installed: {e}"))?;
    Ok(())
}

/// Install the narration engine into the editor's own folder: the packages from PyPI and the voice model from Hugging Face, with the Python that came with the editor. Progress
/// reaches the page as `engine-progress` events ({ step, steps, label, line }). It takes the one job slot (it does not run beside a preview, a publish or a recording), and Cancel stops it.
#[tauri::command]
async fn engine_install(app: tauri::AppHandle) -> Result<(), String> {
    if engine_setting().is_some() {
        return Err("You have named your own narration engine (OPENSTAGE_KOKORO_PYTHON), so the editor leaves it alone and installs nothing.".into());
    }
    let problem = engine_install_problem();
    if !problem.is_empty() {
        return Err(problem);
    }
    let (python, layout, requirements) = (bundled_python().ok_or(NO_BUNDLED_PYTHON)?, engine_layout().ok_or("No data folder.")?, find_tool("narration-requirements.txt").ok_or("No list of packages.")?);
    tauri::async_runtime::spawn_blocking(move || {
        let _slot = JobSlot::take()?;
        engine_install_blocking(&python, &layout, &requirements, |step, steps, label, line| {
            let _ = app.emit("engine-progress", serde_json::json!({ "step": step, "steps": steps, "label": label, "line": line }));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Take the editor's own narration engine away (and its model). Only that folder; never the author's own engine. Returns how many bytes it freed.
#[tauri::command]
async fn engine_remove() -> Result<u64, String> {
    let layout = engine_layout().ok_or("No data folder.")?;
    if !engine::is_engine_folder(&layout.root) {
        return Err("That is not the narration engine's folder.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _slot = JobSlot::take()?;
        let size = engine::folder_size(&layout.root);
        if layout.root.exists() {
            engine::remove_tree(&layout.root).map_err(|e| format!("Could not remove all of the narration voice. {e} If something is using it, close that and try again."))?;
        }
        Ok(size)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop a running preview or publish. Returns whether there was one.
#[tauri::command]
fn cancel_job() -> bool {
    cancel_job_now()
}

/// Open a published or previewed page in the author's own browser. Only an .html file that exists.
/// OPENSTAGE_NO_BROWSER makes this do nothing, so automated tests do not open windows.
#[tauri::command]
fn open_in_browser(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let file = Path::new(&path);
    if !file.is_file() || !path.to_ascii_lowercase().ends_with(".html") {
        return Err("That is not a web page OpenStage Author made.".into());
    }
    if std::env::var("OPENSTAGE_NO_BROWSER").is_ok() {
        return Ok(());
    }
    // Opening the file itself would use whatever program the computer has for .html files, which is not always a web browser (on one
    // computer it is Notepad, and Preview showed the page's text). So the default web browser is asked for, by name, to open the page.
    #[cfg(windows)]
    if open_in_default_browser(&path).is_ok() {
        return Ok(());
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// A file's path as a file:// address a web browser understands. Anything but letters, digits and a few safe marks is written as %XX, so a
/// space, an &, a # or a % in the path can never change what is asked for, nor mean anything to the command line it is passed on.
fn file_url(path: &str) -> String {
    let mut out = String::from("file:///");
    for b in path.replace('\\', "/").bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'/' | b':') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The value in `reg query` output: what follows the type (REG_SZ or REG_EXPAND_SZ) on the line that has one.
fn reg_value(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let at = line.find("REG_SZ").map(|i| i + "REG_SZ".len()).or_else(|| line.find("REG_EXPAND_SZ").map(|i| i + "REG_EXPAND_SZ".len()))?;
        let value = line[at..].trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// The command a browser's "open" entry runs, with the page's address in place of its %1 (or %L), or after it if it has neither.
fn browser_command_line(command: &str, url: &str) -> String {
    if command.contains("%1") || command.contains("%L") {
        command.replace("%1", url).replace("%L", url)
    } else {
        format!("{command} {url}")
    }
}

/// A program id from the registry is used in a registry path, so it is only taken if it is plain.
fn plain_prog_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

#[cfg(windows)]
fn reg_query(key: &str, args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let out = Command::new("reg").arg("query").arg(key).args(args).creation_flags(0x0800_0000).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Open a page in the web browser the person has chosen as their default, whatever program .html files open with.
#[cfg(windows)]
fn open_in_default_browser(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let prog = ["https", "http"]
        .iter()
        .find_map(|scheme| {
            reg_query(&format!(r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\{scheme}\UserChoice"), &["/v", "ProgId"]).and_then(|o| reg_value(&o))
        })
        .filter(|id| plain_prog_id(id))
        .ok_or("No default web browser is set.")?;
    let command = reg_query(&format!(r"HKCR\{prog}\shell\open\command"), &["/ve"]).and_then(|o| reg_value(&o)).ok_or("The default browser has no way to open a page.")?;
    let line = browser_command_line(&command, &file_url(path));
    Command::new("cmd")
        .raw_arg("/C")
        .raw_arg(format!("\"{line}\""))
        .creation_flags(0x0800_0000)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn read_asset(dir: String, path: String) -> Result<tauri::ipc::Response, String> {
    read_asset_at(Path::new(&dir), &path).map(tauri::ipc::Response::new)
}

// ---- keys that work while another program has the focus
//
// Recording means working in some other program, so starting, pausing and stopping have to work from there. The page names the
// combinations; this registers them with the system and tells the page when one is pressed (a `hotkey` event carrying the id).

#[derive(Deserialize)]
struct HotkeyBinding {
    id: String,
    keys: String,
}

#[derive(Serialize, Debug, PartialEq)]
struct HotkeyResult {
    id: String,
    ok: bool,
    message: String,
}

/// Ids are short plain words, so the page can tell them apart and nothing odd travels in an event.
fn hotkey_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A combination such as Ctrl+Shift+F9, or the reason it cannot be used.
fn parse_hotkey(keys: &str) -> Result<Shortcut, String> {
    let keys = keys.trim();
    if keys.is_empty() || keys.len() > 64 {
        return Err("Choose a key combination.".into());
    }
    // Something that is not a key combination at all is said so first.
    let shortcut = keys.parse::<Shortcut>().map_err(|_| "That is not a key combination the system understands. Write it like Ctrl+Shift+F9.".to_string())?;
    // A combination with only a plain letter or number would be pressed all the time while typing anywhere.
    let parts: Vec<&str> = keys.split('+').map(str::trim).collect();
    let modifiers = ["ctrl", "control", "commandorcontrol", "cmdorctrl", "alt", "option", "shift", "super", "meta", "cmd", "command", "win", "windows"];
    let has_modifier = parts[..parts.len() - 1].iter().any(|p| modifiers.contains(&p.to_ascii_lowercase().as_str()));
    let last = parts[parts.len() - 1].to_ascii_lowercase();
    let is_function_key = last.len() >= 2 && last.starts_with('f') && last[1..].parse::<u8>().map(|n| (1..=24).contains(&n)).unwrap_or(false);
    if !has_modifier && !is_function_key {
        return Err("Use Ctrl, Alt or Shift with the key, or a function key on its own, so it is not pressed by accident while typing.".into());
    }
    Ok(shortcut)
}

/// Replace every registered key with these. Each binding comes back with whether it worked and, if not, why (another program may already
/// use the combination). Nothing stays registered from before, and a failure of one does not stop the rest.
#[tauri::command]
fn hotkeys_set(app: tauri::AppHandle, bindings: Vec<HotkeyBinding>) -> Result<Vec<HotkeyResult>, String> {
    let keys = app.global_shortcut();
    keys.unregister_all().map_err(|e| e.to_string())?;
    let mut taken: Vec<Shortcut> = Vec::new();
    let mut out = Vec::new();
    for b in bindings.into_iter().take(16) {
        let result = (|| -> Result<(), String> {
            if !hotkey_id_ok(&b.id) {
                return Err("That key has no usable name.".into());
            }
            let shortcut = parse_hotkey(&b.keys)?;
            if taken.contains(&shortcut) {
                return Err("Two of these use the same keys. Give each its own.".into());
            }
            let id = b.id.clone();
            keys.on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = app.emit("hotkey", id.clone());
                }
            })
            .map_err(|_| "Another program already uses those keys. Choose different ones.".to_string())?;
            taken.push(shortcut);
            Ok(())
        })();
        out.push(match result {
            Ok(()) => HotkeyResult { id: b.id, ok: true, message: String::new() },
            Err(message) => HotkeyResult { id: b.id, ok: false, message },
        });
    }
    Ok(out)
}

/// Let go of every key, for example when recording is not in use.
#[tauri::command]
fn hotkeys_clear(app: tauri::AppHandle) -> Result<(), String> {
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())
}

// ---- playing a large video from the project

/// Let the page play files from this project's assets folder directly from disk, with seeking, instead of reading them into memory.
/// The folder must be a project (it has project.json), and only its assets folder is opened up. The page builds the address with
/// `convertFileSrc`. Opening a project adds its folder for the rest of the session; nothing outside a project folder is ever added.
#[tauri::command]
fn allow_project_media(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let dir = Path::new(&dir);
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let assets = dir.join("assets");
    if !assets.is_dir() {
        return Ok(()); // nothing to play yet
    }
    let assets = plain_path(assets.canonicalize().map_err(|e| e.to_string())?);
    app.asset_protocol_scope().allow_directory(&assets, true).map_err(|e| e.to_string())
}

// ---- the recordings of a course (OpenScreen)
//
// A recording is a folder `<course>/captures/<name>.capture` that the recorder made. The editing screens read its small JSON files, write
// `edit.json` back into it, and play its videos. Every command here takes the course's folder and the recording's folder NAME, never a path, so
// nothing outside the course's `captures` folder can be reached: a name is one plain folder name ending in `.capture`, a path inside a recording
// is plain names joined by `/`, only `.json` files are read as text, and the only file ever written is `edit.json`.

/// The most text read from, or written to, a recording's JSON file. An edit of a long recording is far smaller than this.
const MAX_RECORDING_TEXT: u64 = 8 * 1024 * 1024;

/// The most a take's interaction log may weigh when it is read. The cursor is noted about thirty times a second, so an hour is a few megabytes.
const MAX_INTERACTION_LOG: u64 = 32 * 1024 * 1024;

/// Whether a place inside a recording is a take's interaction log: `takes/take-001/events.jsonl`, and nothing else.
fn is_interaction_log(rel: &Path) -> bool {
    let parts: Vec<&str> = rel.iter().filter_map(|p| p.to_str()).collect();
    parts.len() == 3
        && parts[0] == "takes"
        && parts[1].len() > 5
        && parts[1].starts_with("take-")
        && parts[1][5..].chars().all(|c| c.is_ascii_digit())
        && parts[2] == "events.jsonl"
}

/// A recording's folder name: something, then `.capture`, with no way to name another folder or a drive.
fn recording_name_ok(name: &str) -> bool {
    let named = name.strip_suffix(".capture").is_some_and(|stem| !stem.trim().is_empty());
    named
        && name.chars().count() <= 100
        && !name.contains("..")
        && name.chars().all(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}

/// A path inside a recording, as the page writes it: plain names joined by `/` (empty means the recording's own folder).
fn recording_rel(rel: &str) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    if rel.is_empty() {
        return Ok(out);
    }
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() > 6 {
        return Err("That is not a place inside a recording.".into());
    }
    for part in parts {
        let plain = !part.is_empty() && part != "." && part != ".." && part.chars().count() <= 100 && part.chars().all(|c| !c.is_control() && !matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'));
        if !plain {
            return Err("That is not a place inside a recording.".into());
        }
        out.push(part);
    }
    Ok(out)
}

/// The folder of one recording of a course, if the course is a project and the recording is really inside its `captures` folder.
fn recording_at(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if !recording_name_ok(name) {
        return Err("That is not the name of a recording.".into());
    }
    let captures = dir.join("captures");
    let folder = captures.join(name);
    if !folder.join("capture.json").is_file() {
        return Err("That recording was not found in this course's captures folder.".into());
    }
    // A folder that is really a link to somewhere else is not followed out of captures.
    let base = captures.canonicalize().map_err(|e| e.to_string())?;
    let real = folder.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(&base) {
        return Err("That recording is not inside this course's captures folder.".into());
    }
    Ok(plain_path(real))
}

/// The recordings in a course's `captures` folder, by folder name.
fn list_recordings_at(dir: &Path) -> Result<Vec<String>, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let Ok(entries) = fs::read_dir(dir.join("captures")) else { return Ok(Vec::new()) };
    let mut out: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().join("capture.json").is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| recording_name_ok(n))
        .collect();
    out.sort();
    out.truncate(500);
    Ok(out)
}

/// The text of a `.json` file inside a recording, or None if there is no such file.
fn read_recording_text_at(dir: &Path, name: &str, rel: &str) -> Result<Option<String>, String> {
    let base = recording_at(dir, name)?;
    let rel = recording_rel(rel)?;
    let log = is_interaction_log(&rel);
    if rel.extension().and_then(|e| e.to_str()) != Some("json") && !log {
        return Err("Only the recording's .json files and its interaction logs can be read as text.".into());
    }
    let file = base.join(rel);
    let Ok(meta) = fs::metadata(&file) else { return Ok(None) };
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > if log { MAX_INTERACTION_LOG } else { MAX_RECORDING_TEXT } {
        return Err("That file is larger than a recording's notes should be.".into());
    }
    fs::read_to_string(&file).map(Some).map_err(|e| format!("Could not read the file: {e}"))
}

/// The names of the folders directly inside a place in a recording.
fn recording_folders_at(dir: &Path, name: &str, rel: &str) -> Result<Vec<String>, String> {
    let base = recording_at(dir, name)?;
    let place = base.join(recording_rel(rel)?);
    let Ok(entries) = fs::read_dir(&place) else { return Ok(Vec::new()) };
    let mut out: Vec<String> = entries.flatten().filter(|e| e.path().is_dir()).filter_map(|e| e.file_name().into_string().ok()).collect();
    out.sort();
    out.truncate(2000);
    Ok(out)
}

/// Write one of the two files the editor keeps in a recording, `edit.json` (the edit) or `steps.json` (the steps made from what the author did), and nothing
/// else ever. It has to be a JSON object, and it is put in place whole or not at all.
fn write_recording_json_at(dir: &Path, name: &str, file: &str, what: &str, text: &str) -> Result<(), String> {
    let base = recording_at(dir, name)?;
    if file != "edit.json" && file != "steps.json" {
        return Err("Only the edit and the steps can be saved in a recording.".into());
    }
    if text.len() as u64 > MAX_RECORDING_TEXT {
        return Err(format!("That {what} is larger than a {what} should be."));
    }
    if !serde_json::from_str::<serde_json::Value>(text).map(|v| v.is_object()).unwrap_or(false) {
        return Err(format!("The {what} is not in a form that can be saved."));
    }
    let temp = base.join(format!("{file}.tmp"));
    fs::write(&temp, text).map_err(|e| format!("Could not save the {what}: {e}"))?;
    fs::rename(&temp, base.join(file)).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Could not save the {what}: {e}")
    })
}

/// Write `edit.json` into a recording.
fn write_recording_edit_at(dir: &Path, name: &str, text: &str) -> Result<(), String> {
    write_recording_json_at(dir, name, "edit.json", "edit", text)
}

/// Write `steps.json` into a recording.
fn write_recording_steps_at(dir: &Path, name: &str, text: &str) -> Result<(), String> {
    write_recording_json_at(dir, name, "steps.json", "list of steps", text)
}

/// The recordings in this course, by folder name.
#[tauri::command]
fn list_recordings(dir: String) -> Result<Vec<String>, String> {
    list_recordings_at(Path::new(&dir))
}

/// The text of a `.json` file inside a recording (`capture.json`, `edit.json`, a take's `take.json`), or null if there is none.
#[tauri::command]
fn recording_read(dir: String, name: String, rel: String) -> Result<Option<String>, String> {
    read_recording_text_at(Path::new(&dir), &name, &rel)
}

/// The folders directly inside a place in a recording.
#[tauri::command]
fn recording_folders(dir: String, name: String, rel: String) -> Result<Vec<String>, String> {
    recording_folders_at(Path::new(&dir), &name, &rel)
}

/// Save the edit of a recording as its `edit.json`.
#[tauri::command]
fn recording_write_edit(dir: String, name: String, text: String) -> Result<(), String> {
    write_recording_edit_at(Path::new(&dir), &name, &text)
}

/// Save the steps made from a recording as its `steps.json`.
#[tauri::command]
fn recording_write_steps(dir: String, name: String, text: String) -> Result<(), String> {
    write_recording_steps_at(Path::new(&dir), &name, &text)
}

/// Let the page play the videos and sounds of one recording straight from disk, with seeking. Only that recording's `takes` folder is opened up, for
/// the rest of the session, and only after the recording has been found inside the course's `captures` folder.
#[tauri::command]
fn allow_recording_media(app: tauri::AppHandle, dir: String, name: String) -> Result<(), String> {
    let takes = recording_at(Path::new(&dir), &name)?.join("takes");
    if !takes.is_dir() {
        return Ok(());
    }
    app.asset_protocol_scope().allow_directory(&takes, true).map_err(|e| e.to_string())
}

// ---- captions
//
// A course keeps its captions as WebVTT files in assets/captions. The page decides what the words are; these commands only read and write the files
// safely: one plain name under assets/captions, text only, never larger than a caption file should be, and put in place whole or not at all.

const MAX_CAPTION_FILE: u64 = 5 * 1024 * 1024;

/// A caption file's name: one plain name ending in `.vtt`, nothing that climbs out of the folder.
fn caption_name_ok(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".vtt") else { return false };
    !stem.is_empty()
        && !stem.starts_with('.')
        && name.chars().count() <= 100
        && !name.contains("..")
        && name.chars().all(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}

/// Where a caption file is, from the path the page keeps (`assets/captions/<name>.vtt`), if the course is a project and the path is really that.
fn captions_path_at(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let name = rel.strip_prefix("assets/captions/").unwrap_or("");
    if !caption_name_ok(name) {
        return Err("That is not the path of a caption file in this course.".into());
    }
    Ok(dir.join("assets").join("captions").join(name))
}

fn read_caption_text(file: &Path) -> Result<String, String> {
    let meta = fs::metadata(file).map_err(|e| format!("Could not read the caption file: {e}"))?;
    if !meta.is_file() {
        return Err("That is not a file.".into());
    }
    if meta.len() > MAX_CAPTION_FILE {
        return Err(format!("That caption file is larger than {} MB.", MAX_CAPTION_FILE / (1024 * 1024)));
    }
    let bytes = fs::read(file).map_err(|e| format!("Could not read the caption file: {e}"))?;
    String::from_utf8(bytes).map_err(|_| "That caption file is not saved as UTF-8 text. Open it in Notepad, choose Save As, and set Encoding to UTF-8.".to_string())
}

/// The text of a caption file already in the course, or None if there is no such file.
fn read_captions_at(dir: &Path, rel: &str) -> Result<Option<String>, String> {
    let file = captions_path_at(dir, rel)?;
    if !file.is_file() {
        return Ok(None);
    }
    read_caption_text(&file).map(Some)
}

/// The text of a caption file the author picked from anywhere (`.vtt` or `.srt`), to be read and turned into captions. Nothing is copied or kept.
fn read_caption_source_at(source: &Path) -> Result<String, String> {
    let ext = source.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if ext != "vtt" && ext != "srt" {
        return Err("Caption files must be .vtt or .srt files.".into());
    }
    read_caption_text(source)
}

/// Save captions as a WebVTT file in the course. With `existing` (the path of a caption file already in the course) that file is replaced; otherwise a
/// new file is made from `name_hint`, and nothing already there is overwritten. Returns the course-relative path.
fn write_captions_at(dir: &Path, name_hint: &str, existing: Option<&str>, text: &str) -> Result<String, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    if text.len() as u64 > MAX_CAPTION_FILE {
        return Err(format!("Those captions are larger than {} MB.", MAX_CAPTION_FILE / (1024 * 1024)));
    }
    if !text.starts_with("WEBVTT") {
        return Err("The captions are not in the WebVTT form (the first line has to be WEBVTT).".into());
    }
    let folder = dir.join("assets").join("captions");
    let target = match existing {
        Some(rel) if captions_path_at(dir, rel)?.is_file() => captions_path_at(dir, rel)?,
        _ => {
            fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            folder.join(unique_name(&folder, &safe_stem(name_hint, "captions"), "vtt"))
        }
    };
    let temp = target.with_extension("vtt.tmp");
    fs::write(&temp, text).map_err(|e| format!("Could not save the captions: {e}"))?;
    fs::rename(&temp, &target).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Could not save the captions: {e}")
    })?;
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("captions.vtt");
    Ok(format!("assets/captions/{name}"))
}

/// The text of a caption file in this course (`assets/captions/<name>.vtt`), or null if there is none.
#[tauri::command]
fn captions_read(dir: String, rel: String) -> Result<Option<String>, String> {
    read_captions_at(Path::new(&dir), &rel)
}

/// The text of a `.vtt` or `.srt` file the author chose, to read it into the captions dialog.
#[tauri::command]
fn caption_source_read(source: String) -> Result<String, String> {
    read_caption_source_at(Path::new(&source))
}

/// Save WebVTT captions in the course and return their path.
#[tauri::command]
fn captions_write(dir: String, name_hint: String, existing: Option<String>, text: String) -> Result<String, String> {
    write_captions_at(Path::new(&dir), &name_hint, existing.as_deref(), &text)
}

// ---- the Capture recorder
//
// OpenStage Capture is a separate program that the editor starts and talks to (see stream.rs). Nothing here records anything.

const NO_CAPTURE: &str = "The recorder is not installed on this computer. OpenStage Capture is a separate program: put openstage-capture.exe in the same folder as the editor, or set OPENSTAGE_CAPTURE to its full path, then open OpenStage Author again.";

/// Where the recorder is: OPENSTAGE_CAPTURE if it is set, otherwise beside the editor or in the repository's usual build folders, found the
/// way the other helpers are. The Err is a message for the author.
fn capture_program_in(setting: Option<&str>, starts: &[PathBuf]) -> Result<PathBuf, String> {
    if let Some(p) = setting.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!("OPENSTAGE_CAPTURE is set to {}, but there is no program there. Set it to the full path of openstage-capture.exe, or remove it so the editor looks beside itself.", path.display()))
        };
    }
    let name = if cfg!(windows) { "openstage-capture.exe" } else { "openstage-capture" };
    for rel in [name.to_string(), format!("capture/target/release/{name}"), format!("target/release/{name}")] {
        if let Some(found) = find_in(starts, &rel) {
            return Ok(plain_path(found));
        }
    }
    Err(NO_CAPTURE.into())
}

fn capture_program() -> Result<PathBuf, String> {
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(repo) = std::env::var("OPENSTAGE_REPO") {
        starts.push(PathBuf::from(repo));
    }
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    capture_program_in(std::env::var("OPENSTAGE_CAPTURE").ok().as_deref(), &starts)
}

/// Whether the recorder can be found: its path if so, or a message that says what to do.
#[tauri::command]
fn capture_check() -> Result<String, String> {
    capture_program().map(|p| p.to_string_lossy().into_owned())
}

/// Start the recorder. Each line it prints reaches the page as a `stream-line` event, and its end as a `stream-exit` event.
#[tauri::command]
fn stream_start(app: tauri::AppHandle, args: Vec<String>) -> Result<(), String> {
    if args.len() > 32 || args.iter().any(|a| a.len() > 2000 || a.contains('\0')) {
        return Err("Those are not options the recorder can be started with.".into());
    }
    let program = capture_program()?;
    let for_lines = app.clone();
    stream::start(
        &program,
        &args,
        move |line| {
            let _ = for_lines.emit("stream-line", line);
        },
        move |exit| {
            let _ = app.emit("stream-exit", exit);
        },
    )
}

/// Send the recorder one command: one short line of JSON.
#[tauri::command]
fn stream_send(line: String) -> Result<(), String> {
    stream::send(&line)
}

/// The page says the recorder paused or resumed, so a publish or preview knows whether it may run.
#[tauri::command]
fn stream_set_paused(paused: bool) {
    stream::set_paused(paused)
}

#[tauri::command]
fn stream_state() -> stream::State {
    stream::state()
}

/// Stop the recorder: ask it to finish and print its result, give it ten seconds, and only then end it. Returns whether a recording was running.
#[tauri::command]
async fn stream_stop(stop_line: Option<String>) -> Result<bool, String> {
    let line = stop_line.unwrap_or_else(|| stream::DEFAULT_STOP_LINE.to_string());
    tauri::async_runtime::spawn_blocking(move || stream::stop(&line, stream::STOP_GRACE))
        .await
        .map_err(|e| e.to_string())?
}

// ---- speech recognition (story D3: captions from a recorded voice)
//
// The recogniser is a separate program, whisper.cpp's whisper-cli, that this starts and reads the answer of (see speech.rs). The page reads the sound of a video into a plain
// WAV file and hands it over; the models are downloaded only when the author presses the button, from one address written in speech.rs, and checked.

/// Where the recogniser is: OPENSTAGE_WHISPER if it is set, otherwise the `speech` folder beside the editor or in the repository, found the way the other helpers are.
/// The Err is a message for the author.
fn speech_program_in(setting: Option<&str>, starts: &[PathBuf]) -> Result<PathBuf, String> {
    if let Some(p) = setting.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!("OPENSTAGE_WHISPER is set to {}, but there is no program there. Set it to the full path of whisper-cli.exe, or remove it so the editor looks in the speech folder.", path.display()))
        };
    }
    let name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    for rel in [format!("speech/{name}"), name.to_string()] {
        if let Some(found) = find_in(starts, &rel) {
            return Ok(plain_path(found));
        }
    }
    Err(speech::NO_RECOGNISER.into())
}

fn speech_program() -> Result<PathBuf, String> {
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(repo) = std::env::var("OPENSTAGE_REPO") {
        starts.push(PathBuf::from(repo));
    }
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    speech_program_in(std::env::var("OPENSTAGE_WHISPER").ok().as_deref(), &starts)
}

/// Where the speech models are kept: the editor's own folder on this computer, never a course.
fn speech_models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("speech-models"))
}

/// The folder the sound being listened to is kept in for as long as it takes.
fn speech_temp_dir() -> PathBuf {
    std::env::temp_dir().join("openstage-speech")
}

static SPEECH_DOWNLOADING: AtomicBool = AtomicBool::new(false);
static SPEECH_DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);

/// Whether the recogniser is there and which models are downloaded, as JSON for the page.
#[tauri::command]
fn speech_status(app: tauri::AppHandle) -> Result<String, String> {
    let folder = speech_models_dir(&app)?;
    serde_json::to_string(&speech::status(speech_program(), &folder)).map_err(|e| e.to_string())
}

/// Download a model the author asked for. Progress reaches the page as `speech-download` events ({ id, done, total }). Only a model in the table in speech.rs can be asked for, and
/// it is fetched from the address written there, not from anything the page says.
#[tauri::command]
async fn speech_download(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let spec = speech::model(&id).ok_or("That is not a speech model OpenStage knows.")?;
    let folder = speech_models_dir(&app)?;
    if SPEECH_DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Err("A model is already being downloaded.".into());
    }
    SPEECH_DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let model_id = spec.id;
        speech::download(&folder, spec, spec.url, &SPEECH_DOWNLOAD_CANCELLED, &mut |done, total| {
            let _ = app.emit("speech-download", serde_json::json!({ "id": model_id, "done": done, "total": total }));
        })
    })
    .await
    .map_err(|e| e.to_string());
    SPEECH_DOWNLOADING.store(false, Ordering::SeqCst);
    result?
}

/// Keep the sound the page made (a 16 kHz mono 16-bit WAV, sent as the raw body of the request, so a long clip is not turned into text on the way). Returns the name to listen to it by.
#[tauri::command]
fn speech_audio_put(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The sound could not be passed to the recogniser: the window did not send it as bytes.".into());
    };
    speech::check_wav(bytes)?;
    let dir = speech_temp_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Could not make a place to keep the sound: {e}"))?;
    // Sounds left by a run that was cut short are cleared away after a day.
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|age| age > Duration::from_secs(24 * 3600)).unwrap_or(false);
            if old {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let name = format!("speech-{}-{stamp}.wav", std::process::id());
    fs::write(dir.join(&name), bytes).map_err(|e| format!("Could not keep the sound: {e}"))?;
    Ok(name)
}

/// Let go of a sound that was kept.
#[tauri::command]
fn speech_drop(audio: String) {
    if speech::audio_name_ok(&audio) {
        let dir = speech_temp_dir();
        let _ = fs::remove_file(dir.join(&audio));
        let _ = fs::remove_file(dir.join(audio.trim_end_matches(".wav")).with_extension("json"));
    }
}

/// Listen to a sound that was kept and return the recogniser's answer (its full JSON). Progress reaches the page as `speech-progress` events (a percent). It takes the one job
/// slot, so it does not run beside a preview, a publish, or an unpaused recording, and Cancel stops it.
#[tauri::command]
async fn speech_listen(app: tauri::AppHandle, audio: String, model: String, hint: String) -> Result<String, String> {
    if !speech::audio_name_ok(&audio) {
        return Err("That is not a sound that was kept for listening.".into());
    }
    let spec = speech::model(&model).ok_or("That is not a speech model OpenStage knows.")?;
    let program = speech_program()?;
    let folder = speech_models_dir(&app)?;
    if !speech::installed(&folder, spec) {
        return Err(format!("The speech model {} is not downloaded yet.", spec.id));
    }
    let wav = speech_temp_dir().join(&audio);
    if !wav.is_file() {
        return Err("The sound to listen to is not there any more. Try again.".into());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let _slot = JobSlot::take()?;
        let out_base = speech_temp_dir().join(audio.trim_end_matches(".wav"));
        let args = speech::listen_args(&speech::model_path(&folder, spec), &wav, &out_base, spec.id, &hint, speech::threads());
        let mut cmd = Command::new(&program);
        cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        if let Some(dir) = program.parent() {
            cmd.current_dir(dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // no console window flashing up
        }
        let mut child = cmd.spawn().map_err(|e| format!("The speech recogniser could not be started: {e}"))?;
        *job_pid() = Some(child.id());
        if JOB_CANCELLED.load(Ordering::SeqCst) {
            kill_tree(child.id()); // cancelled in the instant before it started
        }
        let stderr = child.stderr.take();
        let events = app.clone();
        let reader = std::thread::spawn(move || {
            let mut tail: Vec<String> = Vec::new();
            if let Some(mut s) = stderr {
                let mut pending: Vec<u8> = Vec::new();
                let mut buf = [0u8; 4096];
                while let Ok(n) = s.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    for &b in &buf[..n] {
                        if b == b'\n' || b == b'\r' {
                            let line = String::from_utf8_lossy(&pending).trim().to_string();
                            pending.clear();
                            if line.is_empty() {
                                continue;
                            }
                            if let Some(p) = speech::progress_of(&line) {
                                let _ = events.emit("speech-progress", p);
                            } else {
                                tail.push(line);
                                if tail.len() > 12 {
                                    tail.remove(0);
                                }
                            }
                        } else {
                            pending.push(b);
                        }
                    }
                }
            }
            tail
        });
        let status = child.wait().map_err(|e| e.to_string());
        let tail = reader.join().unwrap_or_default();
        *job_pid() = None;
        let json_path = out_base.with_extension("json");
        let finish = |outcome: Result<String, String>| {
            let _ = fs::remove_file(&json_path);
            outcome
        };
        if JOB_CANCELLED.swap(false, Ordering::SeqCst) {
            return finish(Err("Listening was stopped.".into()));
        }
        let status = status?;
        if !status.success() {
            let said = tail.iter().rev().take(3).rev().cloned().collect::<Vec<_>>().join(" ");
            return finish(Err(format!("The speech recogniser stopped with an error.{}", if said.is_empty() { String::new() } else { format!(" It said: {said}") })));
        }
        let text = match fs::metadata(&json_path) {
            Ok(m) if m.len() <= 128 * 1024 * 1024 => fs::read_to_string(&json_path).map_err(|e| format!("Could not read what the recogniser heard: {e}")),
            Ok(_) => Err("What the recogniser heard is too large to use.".to_string()),
            Err(_) => Err("The speech recogniser finished but wrote nothing.".to_string()),
        };
        finish(text)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop a download or a listening that is going on. Returns whether there was one.
#[tauri::command]
fn speech_cancel() -> bool {
    let downloading = SPEECH_DOWNLOADING.load(Ordering::SeqCst);
    if downloading {
        SPEECH_DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
    }
    cancel_job_now() || downloading
}

/// The bytes of a video or audio file in the course's assets, so the page can decode its sound. One plain file name directly in assets/video or assets/audio, of a kind a course
/// holds, and no larger than the course would take. Sent back raw, not as text.
fn read_media_at(dir: &Path, rel: &str) -> Result<Vec<u8>, String> {
    if !dir.join("project.json").is_file() {
        return Err("That folder is not an OpenStage project.".into());
    }
    let parts: Vec<&str> = rel.split('/').collect();
    let (kind, name) = match parts.as_slice() {
        ["assets", "video", name] => ("video", *name),
        ["assets", "audio", name] => ("audio", *name),
        _ => return Err("That file is not a video or sound in the course's assets.".into()),
    };
    let k = asset_kind(kind)?;
    let ext = name.rsplit('.').next().map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if name.starts_with('.') || name.contains(['\\', ':']) || name.contains("..") || !k.exts.contains(&ext.as_str()) {
        return Err("That file is not a video or sound in the course's assets.".into());
    }
    let path = dir.join("assets").join(k.folder).join(name);
    let size = fs::metadata(&path).map_err(|_| format!("{rel} is not in the course."))?.len();
    if size > k.max + 100 * 1024 * 1024 {
        return Err("That file is too large to listen to.".into());
    }
    fs::read(&path).map_err(|e| format!("Could not read {rel}: {e}"))
}

#[tauri::command]
fn read_media_bytes(dir: String, path: String) -> Result<tauri::ipc::Response, String> {
    read_media_at(Path::new(&dir), &path).map(tauri::ipc::Response::new)
}

/// The file `file` in the folder `folder` beside the program, if it is there: where an installed OpenStage Author keeps the Python and Node that travel with it.
fn bundled_helper_in(exe_dir: &Path, folder: &str, file: &str) -> Option<PathBuf> {
    let path = exe_dir.join(folder).join(file);
    path.is_file().then_some(path)
}

/// An installed OpenStage Author carries its own Python and Node (the `python` and `node` folders beside the program), so nothing has to be installed first. They are used
/// unless the author has named others with OPENSTAGE_PYTHON or OPENSTAGE_NODE. Run from the repository there are no such folders, and the ones on the PATH are used as before.
fn use_bundled_helpers() {
    let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) else { return };
    for (setting, folder, file) in [("OPENSTAGE_PYTHON", "python", "python.exe"), ("OPENSTAGE_NODE", "node", "node.exe")] {
        if std::env::var_os(setting).is_none() {
            if let Some(path) = bundled_helper_in(&dir, folder, file) {
                std::env::set_var(setting, path);
            }
        }
    }
}

pub fn run() {
    use_bundled_helpers();
    tauri::Builder::default()
        .setup(|app| {
            if let Ok(dir) = app.path().app_local_data_dir() {
                // The Python that travels with the editor keeps its compiled copies of modules in the editor's data folder, not in its own, so nothing is written into the install folder that the uninstaller does not know of.
                if bundled_python().is_some() && std::env::var_os("PYTHONPYCACHEPREFIX").is_none() {
                    std::env::set_var("PYTHONPYCACHEPREFIX", dir.join("pycache"));
                }
                let _ = DATA_DIR.set(dir);
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![open_project, save_files, import_image, save_generated_image, save_deck_picture, import_asset, list_assets, delete_asset, http_get, download_asset, read_settings, write_settings, create_project, migrate_project, validate, preview_project, publish_project, cancel_job, open_in_browser, narration_engine, narration_cache, read_narration_audio, reuse_narration_audio, about_info, engine_status, engine_install, engine_remove, delete_narration_audio, make_narration, ai_plugins, ai_plugins_folder, ai_service, ai_make, voice_sample, read_asset, read_asset_url, capture_check, stream_start, stream_send, stream_set_paused, stream_state, stream_stop, hotkeys_set, hotkeys_clear, allow_project_media, list_recordings, recording_read, recording_folders, recording_write_edit, recording_write_steps, save_step_picture, allow_recording_media, captions_read, captions_write, caption_source_read, speech_status, speech_download, speech_audio_put, speech_drop, speech_listen, speech_cancel, read_media_bytes])
        .on_window_event(|window, event| {
            // If the window is gone, a recording must not carry on with nothing to command it, and the keys are let go.
            if let tauri::WindowEvent::Destroyed = event {
                let _ = window.app_handle().global_shortcut().unregister_all();
                stream::shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the OpenStage Author editor");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openstage-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("slides")).unwrap();
        fs::write(
            dir.join("project.json"),
            "{\n  \"scenes\": [ { \"slides\": [\"slide-001\", \"slide-missing\", \"slide-001\"] } ]\n}\n",
        )
        .unwrap();
        fs::write(dir.join("slides/slide-001.json"), "{ \"id\": \"slide-001\" }").unwrap();
        dir
    }

    #[test]
    fn only_project_files_are_writable_paths() {
        assert!(safe_relative("project.json").is_ok());
        assert!(safe_relative("slides/slide-001.json").is_ok());
        for bad in [
            "../project.json", "slides/../project.json", "slides/a/b.json", "slides\\a.json",
            "slides/.json", "slides/.hidden.json", "slides/a.txt", "assets/x.png", "/etc/passwd",
            "C:/x.json", "slides/C:x.json", "project.json/..", "",
        ] {
            assert!(safe_relative(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn opening_returns_text_untouched_and_skips_missing_and_repeated_slides() {
        let dir = temp_project("open");
        let opened = open_project_at(&dir).unwrap();
        assert_eq!(opened.slides.len(), 1);
        assert_eq!(opened.slides[0].id, "slide-001");
        assert_eq!(opened.slides[0].text, "{ \"id\": \"slide-001\" }");
        assert!(opened.project.starts_with("{\n  \"scenes\""));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn saving_replaces_the_file_and_leaves_no_temp_file() {
        let dir = temp_project("save");
        let files = vec![FileText { path: "slides/slide-001.json".into(), text: "{\"id\":\"slide-001\",\"x\":1}\n".into() }];
        write_files(&dir, &files, &[]).unwrap();
        assert_eq!(fs::read_to_string(dir.join("slides/slide-001.json")).unwrap(), "{\"id\":\"slide-001\",\"x\":1}\n");
        assert!(!dir.join("slides/slide-001.json.tmp").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn saving_refuses_other_folders_and_other_paths() {
        let dir = std::env::temp_dir().join(format!("openstage-test-notproject-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = vec![FileText { path: "project.json".into(), text: "{}".into() }];
        assert!(write_files(&dir, &file, &[]).is_err(), "no project.json here");
        let project = temp_project("refuse");
        let bad = vec![FileText { path: "../escape.json".into(), text: "{}".into() }];
        assert!(write_files(&project, &bad, &[]).is_err());
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(project);
    }

    /// Runs the real validator through the same path the editor uses. Needs a Python with
    /// jsonschema, so it only runs when OPENSTAGE_PYTHON is set.
    #[test]
    fn validation_runs_the_real_validator_on_unsaved_files() {
        if std::env::var("OPENSTAGE_PYTHON").is_err() {
            eprintln!("skipped: OPENSTAGE_PYTHON is not set");
            return;
        }
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
        let minimal = repo.join("examples").join("minimal.osproj");
        let files: Vec<FileText> = ["project.json", "theme.json", "slides/slide-001.json", "slides/slide-002.json"]
            .iter()
            .map(|p| FileText { path: p.to_string(), text: fs::read_to_string(minimal.join(p)).unwrap() })
            .collect();
        let out = validate_blocking(&minimal, &files).unwrap();
        let findings: serde_json::Value = serde_json::from_str(&out).unwrap();
        let rules: Vec<&str> = findings.as_array().unwrap().iter().filter_map(|f| f["rule"].as_str()).collect();
        assert_eq!(rules, vec!["provenance-mixed"]);

        // Break it in memory: the validator must see the unsaved text, not the file on disk.
        let broken: Vec<FileText> = files
            .iter()
            .map(|f| FileText { path: f.path.clone(), text: f.text.replace("\"altText\": \"Continue to the next slide\"", "\"altText\": \"\"") })
            .collect();
        let out = validate_blocking(&minimal, &broken).unwrap();
        assert!(out.contains("alt-text-missing"), "expected the edited text to be validated: {out}");
    }

    fn new_files() -> Vec<FileText> {
        vec![
            FileText { path: "project.json".into(), text: "{\"scenes\":[]}\n".into() },
            FileText { path: "slides/slide-001.json".into(), text: "{}\n".into() },
        ]
    }

    #[test]
    fn a_new_project_is_made_in_a_new_or_empty_folder() {
        let base = std::env::temp_dir().join(format!("openstage-test-new-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        // A folder that does not exist yet is created.
        let fresh = base.join("fresh");
        create_project_at(&fresh, &new_files()).unwrap();
        assert!(fresh.join("project.json").is_file());
        assert!(fresh.join("slides/slide-001.json").is_file());
        assert!(fresh.join("assets/images/.gitkeep").is_file());
        assert!(fresh.join("assets/audio").is_dir() && fresh.join("assets/video").is_dir());
        // An existing empty folder is fine.
        let empty = base.join("empty");
        fs::create_dir_all(&empty).unwrap();
        create_project_at(&empty, &new_files()).unwrap();
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_new_project_never_overwrites_a_folder_that_has_files() {
        let dir = temp_project("create-refuse");
        assert!(create_project_at(&dir, &new_files()).is_err());
        assert_eq!(fs::read_to_string(dir.join("slides/slide-001.json")).unwrap(), "{ \"id\": \"slide-001\" }");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_new_project_checks_paths_before_writing_anything() {
        let base = std::env::temp_dir().join(format!("openstage-test-newbad-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let mut files = new_files();
        files.push(FileText { path: "../escape.json".into(), text: "{}".into() });
        assert!(create_project_at(&base, &files).is_err());
        assert!(!base.exists(), "nothing should have been created");
        let no_manifest = vec![FileText { path: "slides/slide-001.json".into(), text: "{}".into() }];
        assert!(create_project_at(&base, &no_manifest).is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn saving_can_remove_deleted_slide_files_but_nothing_else() {
        let dir = temp_project("remove");
        fs::write(dir.join("slides/slide-002.json"), "{}").unwrap();
        write_files(&dir, &[], &["slides/slide-002.json".to_string()]).unwrap();
        assert!(!dir.join("slides/slide-002.json").exists());
        assert!(dir.join("slides/slide-001.json").exists(), "other slides untouched");
        for bad in ["project.json", "assets/x.png", "../x", "slides/../project.json"] {
            assert!(write_files(&dir, &[], &[bad.to_string()]).is_err(), "should refuse {bad:?}");
        }
        assert!(dir.join("project.json").exists());
        // A bad removal must stop the whole save before anything is written.
        let files = vec![FileText { path: "slides/slide-001.json".into(), text: "CHANGED".into() }];
        assert!(write_files(&dir, &files, &["project.json".to_string()]).is_err());
        assert_eq!(fs::read_to_string(dir.join("slides/slide-001.json")).unwrap(), "{ \"id\": \"slide-001\" }");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn importing_an_image_copies_it_safely_and_never_overwrites() {
        let dir = temp_project("import");
        let src = std::env::temp_dir().join(format!("My Photo (1)-{}.PNG", std::process::id()));
        fs::write(&src, [9u8, 9, 9]).unwrap();
        let first = import_image_at(&dir, &src).unwrap();
        assert!(first.starts_with("assets/images/My-Photo--1--"), "{first}");
        assert!(first.ends_with(".png"), "extension is lower-cased: {first}");
        let second = import_image_at(&dir, &src).unwrap();
        assert_ne!(first, second);
        assert!(second.ends_with("-2.png"), "{second}");
        assert_eq!(fs::read(dir.join(&first)).unwrap(), vec![9, 9, 9]);
        let _ = fs::remove_file(&src);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn importing_refuses_other_file_types_and_non_projects() {
        let dir = temp_project("import-bad");
        let exe = std::env::temp_dir().join(format!("tool-{}.exe", std::process::id()));
        fs::write(&exe, [1u8]).unwrap();
        assert!(import_image_at(&dir, &exe).is_err());
        let png = std::env::temp_dir().join(format!("ok-{}.png", std::process::id()));
        fs::write(&png, [1u8]).unwrap();
        let elsewhere = std::env::temp_dir().join(format!("openstage-test-notproj2-{}", std::process::id()));
        fs::create_dir_all(&elsewhere).unwrap();
        assert!(import_image_at(&elsewhere, &png).is_err());
        let _ = fs::remove_file(&exe);
        let _ = fs::remove_file(&png);
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(elsewhere);
    }

    #[test]
    fn a_picture_from_a_deck_is_saved_under_its_own_name_once_and_only_if_it_is_what_it_says() {
        let dir = temp_project("deck-picture");
        let png = [0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
        let name = "pptx-0123456789abcd.png";
        assert_eq!(save_deck_picture_at(&dir, name, &png).unwrap(), "assets/images/pptx-0123456789abcd.png");
        assert_eq!(fs::read(dir.join("assets/images").join(name)).unwrap(), png);
        // The same picture again is the same file, left as it is.
        fs::write(dir.join("assets/images").join(name), b"kept").unwrap();
        save_deck_picture_at(&dir, name, &png).unwrap();
        assert_eq!(fs::read(dir.join("assets/images").join(name)).unwrap(), b"kept");
        for bad in ["../pptx-0123456789abcd.png", "pptx-0123456789abcd.svg", "pptx-0123456789abcd.exe", "pptx-0123456789abc.png", "pptx-0123456789ABCD.png", "x.png", "pptx-0123456789abcd", "pptx-0123456789abcd.png/x"] {
            assert!(save_deck_picture_at(&dir, bad, &png).is_err(), "{bad}");
        }
        assert!(save_deck_picture_at(&dir, "pptx-0123456789abce.png", b"<svg onload=alert(1)>").is_err(), "not a png inside");
        assert!(save_deck_picture_at(&dir, "pptx-0123456789abce.jpg", &png).is_err(), "a png is not a jpg");
        assert!(save_deck_picture_at(&dir, "pptx-0123456789abcf.jpg", &[0xff, 0xd8, 0xff, 0xe0]).is_ok());
        assert!(save_deck_picture_at(&dir, "pptx-0123456789abc0.gif", b"GIF89a....").is_ok());
        assert!(save_deck_picture_at(&dir, "pptx-0123456789abc1.webp", b"RIFF\0\0\0\0WEBPVP8 ").is_ok());
        let elsewhere = std::env::temp_dir().join("openstage-not-a-project-deck");
        let _ = fs::create_dir_all(&elsewhere);
        assert!(save_deck_picture_at(&elsewhere, name, &png).is_err(), "not a project");
        let _ = fs::remove_dir_all(elsewhere);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_picture_the_editor_drew_is_saved_in_the_images_and_never_overwrites() {
        let dir = temp_project("generated-svg");
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#cfe8d6"/><circle cx="100" cy="88" r="40" fill="#d9a273"/></svg>"##;
        let first = save_generated_svg_at(&dir, "Maya Reyes", svg).unwrap();
        assert_eq!(first, "assets/images/Maya-Reyes.svg");
        let second = save_generated_svg_at(&dir, "Maya Reyes", svg).unwrap();
        assert_eq!(second, "assets/images/Maya-Reyes-2.svg");
        assert_eq!(fs::read_to_string(dir.join(&first)).unwrap(), svg);
        assert_eq!(save_generated_svg_at(&dir, "../../evil", svg).unwrap(), "assets/images/evil.svg", "the name cannot climb out of the folder");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_drawn_picture_that_could_run_or_reach_out_is_refused() {
        let dir = temp_project("generated-svg-bad");
        let bad = [
            r##"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg"><rect onclick = "x"/></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><rect/></a></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg"><image href="x.png"/></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>"##,
            r##"<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(http://x)"/></svg>"##,
            r##"<html><body>not a picture</body></html>"##,
        ];
        for svg in bad {
            assert!(save_generated_svg_at(&dir, "x", svg).is_err(), "{svg}");
        }
        assert!(save_generated_svg_at(&dir, "x", &format!("<svg>{}</svg>", "a".repeat(GENERATED_SVG_MAX))).is_err(), "too big");
        assert!(!dir.join("assets/images").exists() || fs::read_dir(dir.join("assets/images")).unwrap().count() == 0, "nothing was written");
        let elsewhere = std::env::temp_dir().join(format!("openstage-test-notproj3-{}", std::process::id()));
        fs::create_dir_all(&elsewhere).unwrap();
        assert!(save_generated_svg_at(&elsewhere, "x", "<svg></svg>").is_err(), "not a project");
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(elsewhere);
    }

    #[test]
    fn an_attribute_that_only_contains_on_is_not_an_event_handler() {
        let dir = temp_project("generated-svg-on");
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 200 200"><path stroke-linejoin="round" d="M0 0"/></svg>"##;
        assert!(save_generated_svg_at(&dir, "ok", svg).is_ok());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn an_asset_comes_back_as_a_data_url_with_the_right_type() {
        let dir = temp_project("dataurl");
        fs::create_dir_all(dir.join("assets/images")).unwrap();
        fs::write(dir.join("assets/images/a.png"), [1u8, 2, 3]).unwrap();
        fs::write(dir.join("assets/images/b.SVG"), b"<svg/>").unwrap();
        assert_eq!(asset_data_url(&dir, "assets/images/a.png").unwrap(), "data:image/png;base64,AQID");
        assert!(asset_data_url(&dir, "assets/images/b.SVG").unwrap().starts_with("data:image/svg+xml;base64,"));
        assert!(asset_data_url(&dir, "../project.json").is_err());
        assert!(asset_data_url(&dir, "assets/images/missing.png").is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_theme_file_may_be_read_and_written_like_the_project_file() {
        assert!(safe_relative("theme.json").is_ok());
        for bad in ["themes.json", "theme.json/..", "sub/theme.json", "../theme.json", "Theme.json "] {
            assert!(safe_relative(bad).is_err(), "should reject {bad:?}");
        }
        let dir = temp_project("theme");
        fs::write(dir.join("project.json"), "{ \"theme\": { \"ref\": \"theme.json\" }, \"scenes\": [] }").unwrap();
        assert!(open_project_at(&dir).unwrap().theme.is_none(), "no file yet");
        fs::write(dir.join("theme.json"), "{ \"id\": \"x\" }").unwrap();
        assert_eq!(open_project_at(&dir).unwrap().theme.as_deref(), Some("{ \"id\": \"x\" }"));
        write_files(&dir, &[FileText { path: "theme.json".into(), text: "{\"id\":\"y\"}\n".into() }], &[]).unwrap();
        assert_eq!(fs::read_to_string(dir.join("theme.json")).unwrap(), "{\"id\":\"y\"}\n");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_project_that_names_no_theme_opens_without_one() {
        let dir = temp_project("notheme");
        fs::write(dir.join("project.json"), "{ \"theme\": null, \"scenes\": [] }").unwrap();
        fs::write(dir.join("theme.json"), "{}").unwrap();
        assert!(open_project_at(&dir).unwrap().theme.is_none(), "a theme file nobody refers to is not used");
        let _ = fs::remove_dir_all(dir);
    }

    /// Runs the real migrate.py on a copy of the 0.1.0 fixture. Needs Python, so only when OPENSTAGE_PYTHON is set.
    #[test]
    fn an_old_project_can_be_updated_through_the_same_path_the_editor_uses() {
        if std::env::var("OPENSTAGE_PYTHON").is_err() {
            eprintln!("skipped: OPENSTAGE_PYTHON is not set");
            return;
        }
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
        let fixture = repo.join("tools").join("fixtures").join("v0.1.0.osproj");
        let dir = std::env::temp_dir().join(format!("openstage-test-migrate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("slides")).unwrap();
        for f in ["project.json", "slides/slide-001.json", "slides/slide-002.json"] {
            fs::copy(fixture.join(f), dir.join(f)).unwrap();
        }
        let report: serde_json::Value = serde_json::from_str(&migrate_blocking(&dir).unwrap()).unwrap();
        assert_eq!(report["status"], "updated");
        assert_eq!(report["to"], "0.28.0");
        let opened = open_project_at(&dir).unwrap();
        assert!(opened.project.contains("\"0.28.0\""));
        assert!(opened.theme.is_some(), "the updated project has a theme");
        assert!(dir.join(".openstage-backup").join("0.1.0").join("project.json").is_file());
        // A second update has nothing to do.
        let again: serde_json::Value = serde_json::from_str(&migrate_blocking(&dir).unwrap()).unwrap();
        assert_eq!(again["status"], "current");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn assets_must_be_under_assets_and_cannot_climb_out() {
        let dir = temp_project("asset");
        fs::create_dir_all(dir.join("assets")).unwrap();
        fs::write(dir.join("assets/a.png"), [1u8, 2, 3]).unwrap();
        assert_eq!(read_asset_at(&dir, "assets/a.png").unwrap(), vec![1, 2, 3]);
        for bad in ["project.json", "assets/../project.json", "../x", "/abs", "assets"] {
            assert!(read_asset_at(&dir, bad).is_err(), "should reject {bad:?}");
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn assets_json_is_a_writable_project_file_and_opens_with_the_project() {
        assert!(safe_relative("assets.json").is_ok());
        let dir = temp_project("assetsjson");
        assert!(open_project_at(&dir).unwrap().assets.is_none());
        write_files(&dir, &[FileText { path: "assets.json".into(), text: "{\"assets\":[]}".into() }], &[]).unwrap();
        assert_eq!(open_project_at(&dir).unwrap().assets.as_deref(), Some("{\"assets\":[]}"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn each_kind_of_asset_goes_in_its_own_folder_and_only_with_an_allowed_extension() {
        let dir = temp_project("kinds");
        for (kind, file, folder) in [("video", "clip.MP4", "video"), ("audio", "song.mp3", "audio"), ("captions", "clip.vtt", "captions"), ("image", "a.png", "images"), ("document", "Guide.PDF", "documents"), ("document", "notes.docx", "documents")] {
            let src = std::env::temp_dir().join(format!("{}-{file}", std::process::id()));
            fs::write(&src, [1u8, 2]).unwrap();
            let got = import_asset_at(&dir, &src, kind).unwrap();
            assert!(got.starts_with(&format!("assets/{folder}/")), "{got}");
            assert!(got.ends_with(&file[file.rfind('.').unwrap()..].to_ascii_lowercase()), "{got}");
            let _ = fs::remove_file(&src);
        }
        let wrong = std::env::temp_dir().join(format!("{}-x.png", std::process::id()));
        fs::write(&wrong, [1u8]).unwrap();
        assert!(import_asset_at(&dir, &wrong, "video").is_err(), "a picture is not a video");
        assert!(import_asset_at(&dir, &wrong, "nonsense").is_err());
        let _ = fs::remove_file(&wrong);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_to_download_is_a_document_kind_and_a_program_is_refused() {
        let dir = temp_project("documents");
        for good in ["guide.pdf", "Handbook.DOCX", "old.doc", "data.csv", "slides.pptx", "bundle.zip"] {
            let src = std::env::temp_dir().join(format!("{}-doc-{good}", std::process::id()));
            fs::write(&src, [1u8, 2]).unwrap();
            let got = import_asset_at(&dir, &src, "document").unwrap();
            assert!(got.starts_with("assets/documents/"), "{got}");
            let _ = fs::remove_file(&src);
        }
        for bad in ["setup.exe", "run.bat", "script.js", "page.html", "tool.ps1", "noextension", "picture.png", "clip.mp4"] {
            let src = std::env::temp_dir().join(format!("{}-doc-{bad}", std::process::id()));
            fs::write(&src, [1u8, 2]).unwrap();
            let err = import_asset_at(&dir, &src, "document").unwrap_err();
            assert!(err.starts_with("Files to download must be one of:"), "{bad}: {err}");
            let _ = fs::remove_file(&src);
        }
        assert!(!dir.join("assets/documents/setup.exe").exists());
        let listed: Vec<String> = list_assets_at(&dir).unwrap().into_iter().filter(|a| a.kind == "document").map(|a| a.path).collect();
        assert_eq!(listed.len(), 6, "{listed:?}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_kinds_of_file_to_download_match_the_shared_list() {
        let path = find_tool("download-types.json").expect("tools/download-types.json");
        let shared: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        let from_file: Vec<&str> = shared["types"].as_array().unwrap().iter().map(|t| t["ext"].as_str().unwrap()).collect();
        assert_eq!(from_file, DOWNLOAD_EXTS, "tools/download-types.json and DOWNLOAD_EXTS in lib.rs must be the same list in the same order");
        for dangerous in ["exe", "bat", "cmd", "js", "html", "htm", "ps1", "sh", "msi", "jar", "vbs", "scr", "dll", "svg"] {
            assert!(!DOWNLOAD_EXTS.contains(&dangerous), "{dangerous} must never be offered");
        }
    }

    #[test]
    fn the_library_lists_every_asset_and_can_remove_one_safely() {
        let dir = temp_project("library");
        for (sub, name) in [("images", "b.png"), ("images", "a.png"), ("video", "v.mp4"), ("audio", "s.wav"), ("images", ".gitkeep")] {
            fs::create_dir_all(dir.join("assets").join(sub)).unwrap();
            fs::write(dir.join("assets").join(sub).join(name), [0u8; 3]).unwrap();
        }
        let got: Vec<(String, String)> = list_assets_at(&dir).unwrap().into_iter().map(|a| (a.kind, a.path)).collect();
        assert_eq!(got, vec![
            ("image".to_string(), "assets/images/a.png".to_string()), ("image".to_string(), "assets/images/b.png".to_string()),
            ("video".to_string(), "assets/video/v.mp4".to_string()), ("audio".to_string(), "assets/audio/s.wav".to_string()),
        ]);
        delete_asset_at(&dir, "assets/images/a.png").unwrap();
        assert!(!dir.join("assets/images/a.png").exists());
        for bad in ["project.json", "assets/../project.json", "../x", "/abs", "assets/images/missing.png"] {
            assert!(delete_asset_at(&dir, bad).is_err(), "should refuse {bad:?}");
        }
        assert!(dir.join("project.json").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn only_the_stock_libraries_can_be_contacted() {
        for ok in [
            "https://api.unsplash.com/search/photos?query=a", "https://images.unsplash.com/x.jpg", "https://pixabay.com/api/?key=k", "https://cdn.pixabay.com/photo/a.jpg",
            "https://api.pexels.com/v1/search?query=a", "https://videos.pexels.com/video-files/1/a.mp4", "https://images.pexels.com/photos/1/a.jpeg",
            "https://cdn.freesound.org/previews/1/1-hq.mp3", "https://freesound.org/apiv2/search/?query=a",
        ] {
            assert!(allowed_url(ok), "{ok}");
        }
        for bad in [
            "http://api.unsplash.com/x", "https://evil.example/x", "https://api.unsplash.com.evil.example/x", "https://user@api.unsplash.com/x",
            "https://pixabay.com.evil.example/", "file:///C:/secret", "https://localhost/x", "ftp://pixabay.com/x", "https:///x",
            "https://notpexels.com/x", "https://evilfreesound.org/x", "https://pexels.com:8443/x", "https://api.pexels.com.evil.example/x",
            "https://commons.wikimedia.org/w/api.php", "https://api.openverse.org/v1/images/",
        ] {
            assert!(!allowed_url(bad), "{bad}");
        }
        assert!(http_get_text("https://example.com/", &[]).is_err());
        assert_eq!(service_detail("{\"detail\":\"page_size may not exceed 20\"}"), "page_size may not exceed 20");
        assert_eq!(service_detail("[ERROR 400] bad key"), "[ERROR 400] bad key");
        assert_eq!(service_detail("<!DOCTYPE html><html><title>Some Service Error</title></html>"), "", "a web page is not an explanation");
        assert_eq!(service_detail(&"x".repeat(500)).len(), 160);
    }

    /// A one-shot local web server, so the download path is tested without the internet.
    fn serve_once(body: &'static [u8], content_type: &'static str) -> String {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let head = format!("HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body);
            }
        });
        format!("http://127.0.0.1:{port}/photo")
    }

    #[test]
    fn a_stock_picture_downloads_into_the_project_and_never_overwrites() {
        let dir = temp_project("download");
        let url = serve_once(&[137, 80, 78, 71], "image/png");
        let first = download_asset_at(&dir, &url, "A lovely view!", "image").unwrap();
        assert_eq!(first, "assets/images/A-lovely-view.png");
        assert_eq!(fs::read(dir.join(&first)).unwrap(), vec![137, 80, 78, 71]);
        let url2 = serve_once(&[1, 2, 3], "image/jpeg");
        assert_eq!(download_asset_at(&dir, &url2, "A lovely view!", "image").unwrap(), "assets/images/A-lovely-view.jpg");
        let url3 = serve_once(&[1], "image/png");
        assert_eq!(download_asset_at(&dir, &url3, "A lovely view!", "image").unwrap(), "assets/images/A-lovely-view-2.png");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn sounds_and_videos_download_into_their_own_folders_by_what_the_server_says_they_are() {
        let dir = temp_project("download-media");
        let sound = serve_once(&[1, 2, 3, 4], "audio/mpeg");
        assert_eq!(download_asset_at(&dir, &sound, "Rain on a roof", "audio").unwrap(), "assets/audio/Rain-on-a-roof.mp3");
        let ogg = serve_once(&[1], "application/ogg");
        assert_eq!(download_asset_at(&dir, &ogg, "Rain on a roof", "audio").unwrap(), "assets/audio/Rain-on-a-roof.ogg");
        let video = serve_once(&[9, 9], "video/webm");
        assert_eq!(download_asset_at(&dir, &video, "Waves", "video").unwrap(), "assets/video/Waves.webm");
        assert_eq!(fs::read(dir.join("assets/video/Waves.webm")).unwrap(), vec![9, 9]);
        let _ = fs::remove_dir_all(dir);
    }

    /// A local server that answers each connection in turn with a given status line and body.
    fn serve_in_turn(replies: Vec<(&'static str, &'static str, &'static [u8])>) -> String {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for (status, extra, body) in replies {
                let Ok((mut stream, _)) = listener.accept() else { return };
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let head = format!("HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body);
            }
        });
        format!("http://127.0.0.1:{port}/file")
    }

    #[test]
    fn a_service_that_says_wait_a_second_is_waited_for_and_then_asked_again() {
        let url = serve_in_turn(vec![
            ("429 Too many requests", "Retry-After: 0\r\nContent-Type: text/html\r\n", b"<html></html>"),
            ("200 OK", "Content-Type: text/plain\r\n", b"hello"),
        ]);
        assert_eq!(http_get_text(&url, &[]).unwrap(), "hello");
    }

    #[test]
    fn a_service_that_asks_for_a_long_wait_is_not_waited_for() {
        let url = serve_in_turn(vec![("429 Too many requests", "Retry-After: 600\r\n", b"{\"detail\":\"slow down\"}")]);
        let started = std::time::Instant::now();
        let err = http_get_text(&url, &[]).unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(5), "it must not sleep for a minute");
        assert!(err.contains("too many requests") && err.contains("10 minutes") && err.contains("slow down"), "{err}");
        assert_eq!(human_wait(45), "45 seconds");
        assert_eq!(human_wait(600), "10 minutes");
        assert_eq!(human_wait(100), "2 minutes");
    }

    #[test]
    fn errors_say_what_the_service_said_but_not_a_web_page() {
        let url = serve_in_turn(vec![("400 Bad Request", "", b"{\"detail\":\"page_size may not exceed 20\"}")]);
        assert!(http_get_text(&url, &[]).unwrap_err().contains("page_size may not exceed 20"));
        let url = serve_in_turn(vec![("403 Forbidden", "", b"<html><title>Nope</title></html>")]);
        let err = http_get_text(&url, &[]).unwrap_err();
        assert!(err.contains("refused") && !err.contains("<html>"), "{err}");
    }

    #[test]
    fn a_download_of_the_wrong_kind_is_refused_and_leaves_nothing_behind() {
        let dir = temp_project("download-wrong");
        let picture = serve_once(&[137, 80], "image/png");
        assert!(download_asset_at(&dir, &picture, "x", "video").is_err(), "a picture is not a video");
        let page = serve_once(b"<html></html>", "text/html");
        assert!(download_asset_at(&dir, &page, "x", "audio").is_err());
        assert!(download_asset_at(&dir, "https://evil.example/a.mp3", "x", "audio").is_err());
        assert!(download_asset_at(&dir, "http://127.0.0.1:1/a.png", "x", "nonsense").is_err());
        for sub in ["images", "audio", "video"] {
            let any = dir.join("assets").join(sub).read_dir().map(|mut d| d.next().is_some()).unwrap_or(false);
            assert!(!any, "{sub} should be empty");
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_address_is_used_when_the_server_gives_no_useful_type() {
        assert_eq!(ext_for("audio", "application/octet-stream", "https://cdn.freesound.org/previews/1/2-hq.mp3?x=1"), Some("mp3"));
        assert_eq!(ext_for("audio", "", "https://cdn.freesound.org/a/Rain.OGG"), Some("ogg"));
        assert_eq!(ext_for("image", "application/octet-stream", "https://x/photo.JPEG"), Some("jpg"));
        assert_eq!(ext_for("video", "text/html", "https://x/page"), None);
        assert_eq!(ext_for("captions", "text/vtt", "https://x/a.vtt"), None, "stock libraries never supply captions");
    }

    #[test]
    fn a_download_that_is_not_a_picture_is_refused() {
        let dir = temp_project("download-bad");
        let url = serve_once(b"<html>nope</html>", "text/html");
        assert!(download_asset_at(&dir, &url, "x", "image").is_err());
        assert!(!dir.join("assets/images").read_dir().map(|mut d| d.next().is_some()).unwrap_or(false));
        assert!(download_asset_at(&dir, "https://evil.example/x.png", "x", "image").is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn repository_files_are_found_by_looking_upward() {
        let root = std::env::temp_dir().join(format!("openstage-test-find-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("player")).unwrap();
        fs::create_dir_all(root.join("deep/er/still")).unwrap();
        fs::write(root.join("player/publish.ts"), "x").unwrap();
        let elsewhere = std::env::temp_dir().join("openstage-test-find-elsewhere-nothing-here");
        let found = find_in(&[elsewhere, root.join("deep/er/still")], "player/publish.ts").expect("found from a folder inside the repository");
        assert_eq!(found, root.join("player/publish.ts"));
        assert!(find_in(&[root.join("deep")], "tools/nothing.py").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_course_folder_is_named_after_the_project_folder() {
        assert_eq!(course_folder_name(Path::new("D:/Courses/Intro to Stats.osproj")), "Intro-to-Stats");
        assert_eq!(course_folder_name(Path::new("D:/Courses/minimal.OSPROJ")), "minimal");
        assert_eq!(course_folder_name(Path::new("D:/Courses/plain")), "plain");
        assert_eq!(course_folder_name(Path::new("D:/")), "course");
    }

    #[test]
    fn publishing_refuses_places_it_could_harm() {
        let project = temp_project("publish-project");
        // outside the project: fine, and the folder it makes is named after the project
        let elsewhere = std::env::temp_dir().join(format!("openstage-test-publish-out-{}", std::process::id()));
        let _ = fs::remove_dir_all(&elsewhere);
        let out = publish_target(&project, &elsewhere).unwrap();
        assert_eq!(out.file_name().unwrap().to_str().unwrap(), course_folder_name(&project));
        assert!(!out.exists() && !elsewhere.exists(), "choosing the target writes nothing, not even the folder chosen");
        // the project itself, a folder inside it, and the folder that holds it
        assert!(publish_target(&project, &project).is_err());
        assert!(publish_target(&project, &project.join("slides")).is_err());
        assert!(publish_target(&project, &project.join("not").join("made").join("yet")).is_err(), "a place inside the project that does not exist yet is refused too");
        assert!(!project.join("not").exists(), "and a refused place is not created");
        let holder = project.parent().unwrap().to_path_buf();
        let named_like_it = holder.join(course_folder_name(&project));
        // the holder's child with the project's own name is the project itself
        assert_eq!(named_like_it, holder.join(project.file_name().unwrap().to_str().unwrap()));
        assert!(publish_target(&project, &holder).is_err(), "publishing beside the project under the same name would replace it");
        // not a project
        assert!(publish_target(&elsewhere, &elsewhere).is_err());
        // a relative folder
        assert!(publish_target(&project, Path::new("relative/place")).is_err());
        let _ = fs::remove_dir_all(&elsewhere);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn publishing_does_not_empty_a_folder_that_holds_other_things() {
        let project = temp_project("publish-guard");
        let folder = std::env::temp_dir().join(format!("openstage-test-publish-guard-out-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        let name = course_folder_name(&project);
        // someone's own folder with the same name: refused
        fs::create_dir_all(folder.join(&name)).unwrap();
        fs::write(folder.join(&name).join("thesis.docx"), "mine").unwrap();
        assert!(publish_target(&project, &folder).is_err());
        assert!(folder.join(&name).join("thesis.docx").is_file());
        // an earlier publish: fine to replace
        fs::remove_file(folder.join(&name).join("thesis.docx")).unwrap();
        fs::write(folder.join(&name).join("index.html"), "").unwrap();
        fs::write(folder.join(&name).join("player.js"), "").unwrap();
        assert!(publish_target(&project, &folder).is_ok());
        // an empty folder: fine
        fs::remove_dir_all(folder.join(&name)).unwrap();
        fs::create_dir_all(folder.join(&name)).unwrap();
        assert!(publish_target(&project, &folder).is_ok());
        // a file in the way
        fs::remove_dir_all(folder.join(&name)).unwrap();
        fs::write(folder.join(&name), "a file").unwrap();
        assert!(publish_target(&project, &folder).is_err());
        let _ = fs::remove_dir_all(&folder);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn a_preview_copy_holds_the_editors_files_and_links_the_assets() {
        let project = temp_project("preview-src");
        fs::create_dir_all(project.join("assets/images")).unwrap();
        fs::write(project.join("assets/images/a.png"), [1u8, 2, 3]).unwrap();
        fs::create_dir_all(project.join(".cache")).unwrap();
        fs::write(project.join(".cache/n.wav"), [9u8]).unwrap();
        fs::write(project.join("slides/stale.json"), "{}").unwrap();
        let on_disk = fs::read_to_string(project.join("project.json")).unwrap();
        let root = std::env::temp_dir().join(format!("openstage-test-preview-root-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let files = vec![
            FileText { path: "project.json".into(), text: "{\"unsaved\":true}".into() },
            FileText { path: "slides/s1.json".into(), text: "{\"slide\":1}".into() },
        ];
        let (copy, out) = prepare_preview(&project, &files, &root).unwrap();
        assert_eq!(fs::read_to_string(copy.join("project.json")).unwrap(), "{\"unsaved\":true}", "the unsaved text, not the file on disk");
        assert!(copy.join("slides/s1.json").is_file());
        assert!(!copy.join("slides/stale.json").exists(), "a slide the editor has deleted is not in the preview");
        assert_eq!(fs::read(copy.join("assets/images/a.png")).unwrap(), vec![1, 2, 3]);
        assert_eq!(fs::read(copy.join(".cache/n.wav")).unwrap(), vec![9]);
        assert!(out.starts_with(copy.parent().unwrap()) && !out.starts_with(&copy));
        // the project on disk is untouched
        assert_eq!(fs::read_to_string(project.join("project.json")).unwrap(), on_disk);
        // clearing a preview never reaches the project's own files, however the files were linked
        clear_old_previews(&root, Duration::from_secs(0));
        assert!(!copy.exists());
        assert_eq!(fs::read(project.join("assets/images/a.png")).unwrap(), vec![1, 2, 3]);
        assert_eq!(fs::read(project.join(".cache/n.wav")).unwrap(), vec![9]);
        // a path that is not a project file is refused
        let bad = vec![FileText { path: "../escape.json".into(), text: "x".into() }];
        assert!(prepare_preview(&project, &bad, &root).is_err());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn old_previews_are_cleared_and_new_ones_are_kept() {
        let root = std::env::temp_dir().join(format!("openstage-test-clear-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("one")).unwrap();
        clear_old_previews(&root, Duration::from_secs(3600));
        assert!(root.join("one").is_dir(), "a preview from a moment ago stays");
        clear_old_previews(&root, Duration::from_secs(0));
        assert!(!root.join("one").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_running_job_can_be_cancelled_and_only_one_runs_at_a_time() {
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let slot = JobSlot::take().ok().expect("nothing else is running in this test");
        assert!(JobSlot::take().is_err(), "a second job is refused while one runs");
        assert!(cancel_job_now(), "there is a job to cancel");
        drop(slot);
        assert!(!cancel_job_now(), "and nothing to cancel afterwards");
        // a real process, stopped part way
        let Ok(node) = Command::new("node").arg("--version").output() else {
            eprintln!("skipped: node is not available");
            return;
        };
        assert!(node.status.success());
        let slot = JobSlot::take().ok().expect("free again");
        let stopper = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(1500));
            cancel_job_now()
        });
        let mut cmd = Command::new("node");
        cmd.args(["-e", "setTimeout(() => {}, 60000)"]);
        let started = std::time::Instant::now();
        let result = run_job(cmd);
        assert!(matches!(result, Err(JobError::Cancelled)), "the job reports that it was cancelled");
        assert!(started.elapsed() < Duration::from_secs(20), "it did not wait for the 60 seconds");
        assert!(stopper.join().unwrap());
        drop(slot);
        // and the slot is free again
        assert!(JobSlot::take().is_ok());
    }

    #[test]
    fn a_preview_that_cannot_run_leaves_no_folder_behind() {
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let project = temp_project("preview-fail");
        let root = std::env::temp_dir().join("openstage-author-preview");
        let count = || fs::read_dir(&root).map(|d| d.flatten().count()).unwrap_or(0);
        let before = count();
        std::env::set_var("OPENSTAGE_NODE", "openstage-no-such-node-xyz");
        let result = preview_blocking(&project, &[FileText { path: "project.json".into(), text: "{}".into() }]);
        std::env::remove_var("OPENSTAGE_NODE");
        assert!(result.is_err(), "no Node: the preview cannot be made");
        assert!(result.unwrap_err().contains("need Node.js"));
        assert!(count() <= before, "the temporary folder it made is gone again");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn the_speech_recogniser_is_found_by_the_setting_then_in_the_speech_folder_and_a_missing_one_says_what_to_do() {
        let dir = std::env::temp_dir().join(format!("openstage-speechfind-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
        fs::create_dir_all(dir.join("repo/speech")).unwrap();
        fs::create_dir_all(dir.join("repo/editor/src-tauri/target/release")).unwrap();
        let editor = dir.join("repo/editor/src-tauri/target/release/openstage-editor.exe");
        // nothing built: the message says how to build it
        let missing = speech_program_in(None, &[editor.clone()]).unwrap_err();
        assert!(missing.contains("BUILD SPEECH RECOGNISER.bat") && missing.contains("OPENSTAGE_WHISPER"), "{missing}");
        // built into the speech folder of the repository, found by looking upward from the editor
        fs::write(dir.join("repo/speech").join(name), b"x").unwrap();
        assert_eq!(speech_program_in(None, &[editor.clone()]), Ok(dir.join("repo/speech").join(name)));
        // an empty setting is none; a setting wins wherever it points; one that points at nothing is an error that names it
        assert_eq!(speech_program_in(Some(" "), &[editor.clone()]), Ok(dir.join("repo/speech").join(name)));
        fs::write(dir.join("elsewhere.exe"), b"x").unwrap();
        assert_eq!(speech_program_in(Some(dir.join("elsewhere.exe").to_str().unwrap()), &[editor.clone()]), Ok(dir.join("elsewhere.exe")));
        let bad = speech_program_in(Some(dir.join("nope.exe").to_str().unwrap()), &[editor]).unwrap_err();
        assert!(bad.starts_with("OPENSTAGE_WHISPER is set to") && bad.contains("nope.exe"), "{bad}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_video_or_a_sound_directly_in_the_courses_assets_can_be_read_for_listening() {
        let dir = temp_project("listen-read");
        fs::create_dir_all(dir.join("assets/video")).unwrap();
        fs::create_dir_all(dir.join("assets/audio")).unwrap();
        fs::create_dir_all(dir.join("assets/images")).unwrap();
        fs::write(dir.join("assets/video/Lesson.MP4"), [1u8, 2, 3]).unwrap();
        fs::write(dir.join("assets/audio/voice.wav"), [9u8]).unwrap();
        fs::write(dir.join("assets/images/pic.png"), [5u8]).unwrap();
        fs::write(dir.join("assets/video/notes.txt"), [5u8]).unwrap();
        assert_eq!(read_media_at(&dir, "assets/video/Lesson.MP4").unwrap(), vec![1, 2, 3]);
        assert_eq!(read_media_at(&dir, "assets/audio/voice.wav").unwrap(), vec![9]);
        for bad in [
            "assets/images/pic.png", "assets/video/notes.txt", "assets/video/../../project.json", "assets/video/sub/Lesson.MP4", "project.json", "../x.mp4",
            "assets/video/..\\Lesson.MP4", "assets/video/C:Lesson.mp4", "assets/video/.hidden.mp4", "assets/video/missing.mp4", "assets\\video\\Lesson.MP4", "",
        ] {
            assert!(read_media_at(&dir, bad).is_err(), "{bad}");
        }
        assert!(read_media_at(&std::env::temp_dir(), "assets/video/Lesson.MP4").unwrap_err().contains("not an OpenStage project"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_recorder_is_found_by_the_setting_then_beside_the_editor_and_a_missing_one_says_what_to_do() {
        let dir = std::env::temp_dir().join(format!("openstage-test-capture-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("bin")).unwrap();
        let name = if cfg!(windows) { "openstage-capture.exe" } else { "openstage-capture" };
        // nothing anywhere: the message tells the author what to do
        let none = capture_program_in(None, &[dir.join("bin").join("editor.exe")]);
        assert_eq!(none, Err(NO_CAPTURE.to_string()));
        assert!(NO_CAPTURE.contains("OPENSTAGE_CAPTURE"));
        // beside the editor
        fs::write(dir.join("bin").join(name), b"x").unwrap();
        assert_eq!(capture_program_in(None, &[dir.join("bin").join("editor.exe")]), Ok(dir.join("bin").join(name)));
        // an empty setting is the same as none
        assert_eq!(capture_program_in(Some("  "), &[dir.join("bin").join("editor.exe")]), Ok(dir.join("bin").join(name)));
        // the setting wins, wherever it points
        fs::write(dir.join("elsewhere.exe"), b"x").unwrap();
        assert_eq!(capture_program_in(Some(dir.join("elsewhere.exe").to_str().unwrap()), &[dir.join("bin").join("editor.exe")]), Ok(dir.join("elsewhere.exe")));
        // a setting that points at nothing is an error that names the setting and the place, and does not quietly fall back
        let bad = capture_program_in(Some(dir.join("nope.exe").to_str().unwrap()), &[dir.join("bin").join("editor.exe")]);
        let message = bad.unwrap_err();
        assert!(message.starts_with("OPENSTAGE_CAPTURE is set to"), "{message}");
        assert!(message.contains("nope.exe"));
        // the repository's usual build folder
        let repo = dir.join("repo");
        fs::create_dir_all(repo.join("capture/target/release")).unwrap();
        fs::write(repo.join("capture/target/release").join(name), b"x").unwrap();
        assert_eq!(capture_program_in(None, &[repo.join("editor/src-tauri/target/debug/x.exe")]), Ok(repo.join("capture/target/release").join(name)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn key_combinations_are_checked_before_they_are_registered() {
        for good in ["Ctrl+Shift+F9", "CommandOrControl+Shift+F10", "Alt+F11", "F12", "ctrl+alt+r"] {
            assert!(parse_hotkey(good).is_ok(), "{good} should be accepted");
        }
        let plain = parse_hotkey("R").unwrap_err();
        assert!(plain.contains("not pressed by accident"), "{plain}");
        assert!(parse_hotkey("Shift").is_err());
        assert!(parse_hotkey("").is_err());
        assert!(parse_hotkey("   ").is_err());
        assert!(parse_hotkey("Ctrl+Banana").unwrap_err().contains("not a key combination"));
        assert!(parse_hotkey(&format!("Ctrl+{}", "A".repeat(80))).is_err());
        assert_eq!(parse_hotkey("Ctrl+Shift+F9").unwrap(), parse_hotkey("control + shift + f9").unwrap(), "case and spaces do not matter");
    }

    #[test]
    fn a_key_id_is_a_short_plain_word() {
        for good in ["start", "pause", "stop", "start-again", "f9"] {
            assert!(hotkey_id_ok(good), "{good}");
        }
        for bad in ["", "Start", "has space", "x\"y", "a".repeat(33).as_str(), "../x"] {
            assert!(!hotkey_id_ok(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_missing_program_is_reported_as_missing() {
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let _slot = JobSlot::take().ok().expect("free");
        assert!(matches!(run_job(Command::new("openstage-no-such-program-xyz")), Err(JobError::Missing)));
    }

    /// Runs the real publish.ts in preview mode on a copy of the minimal example. Needs Node and Python, so it
    /// only runs when OPENSTAGE_PYTHON is set.
    #[test]
    fn a_preview_runs_the_real_publishing_tool() {
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        if std::env::var("OPENSTAGE_PYTHON").is_err() || Command::new("node").arg("--version").output().is_err() {
            eprintln!("skipped: OPENSTAGE_PYTHON is not set, or node is missing");
            return;
        }
        let Some(script) = find_repo_file("player/publish.ts") else {
            eprintln!("skipped: publish.ts not found");
            return;
        };
        let example = script.parent().unwrap().parent().unwrap().join("examples/minimal.osproj");
        let mut files = vec![FileText { path: "project.json".into(), text: read_text(&example.join("project.json")).unwrap() }];
        for entry in fs::read_dir(example.join("slides")).unwrap().flatten() {
            files.push(FileText { path: format!("slides/{}", entry.file_name().to_str().unwrap()), text: read_text(&entry.path()).unwrap() });
        }
        if example.join("theme.json").is_file() {
            files.push(FileText { path: "theme.json".into(), text: read_text(&example.join("theme.json")).unwrap() });
        }
        let json = preview_blocking(&example, &files).expect("the preview is made");
        assert!(json.contains("\"ok\":true") && json.contains("\"preview\":true"), "{json}");
        let index = json.split("\"indexHtml\":\"").nth(1).and_then(|s| s.split('"').next()).expect("the page is named").replace("\\\\", "\\");
        assert!(Path::new(&index).is_file(), "{index}");
        assert!(Path::new(&index).parent().unwrap().join("player.js").is_file());
        // a project with problems still previews: a preview is for looking
        let _ = fs::remove_dir_all(Path::new(&index).parent().unwrap().parent().unwrap());
    }

    #[test]
    fn the_audio_cache_lists_only_complete_pairs() {
        let project = temp_project("narr-cache");
        let folder = project.join(".cache").join("narration");
        assert!(narration_cache_at(&project).unwrap().is_empty(), "no cache folder: nothing made yet");
        fs::create_dir_all(&folder).unwrap();
        let (a, b, c) = ("a".repeat(64), "b".repeat(64), "c".repeat(64));
        // a: sound and timings; b: sound only; c: timings only; plus junk
        fs::write(folder.join(format!("{a}.wav")), b"RIFF").unwrap();
        fs::write(folder.join(format!("{a}.json")), r#"{"duration": 12.345, "exactTimings": true, "cues": []}"#).unwrap();
        fs::write(folder.join(format!("{b}.wav")), b"RIFF").unwrap();
        fs::write(folder.join(format!("{c}.json")), r#"{"duration": 1}"#).unwrap();
        fs::write(folder.join("notes.json"), "{}").unwrap();
        // capitals are not a key (and Windows file names ignore case, so these must not share a letter with a, b or c)
        fs::write(folder.join(format!("{}.json", "E".repeat(64))), "{}").unwrap();
        fs::write(folder.join(format!("{}.wav", "E".repeat(64))), "x").unwrap();
        let listed = narration_cache_at(&project).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].hash, a);
        assert_eq!(listed[0].duration, 12.345);
        assert!(listed[0].exact_timings);
        // damaged timings are skipped, not fatal
        fs::write(folder.join(format!("{b}.json")), "{not json").unwrap();
        assert_eq!(narration_cache_at(&project).unwrap().len(), 1);
        // an estimate is reported as one
        fs::write(folder.join(format!("{b}.json")), r#"{"duration": 2.5, "exactTimings": false}"#).unwrap();
        let both = narration_cache_at(&project).unwrap();
        assert_eq!(both.iter().map(|n| (n.hash.clone(), n.exact_timings)).collect::<Vec<_>>(), vec![(a.clone(), true), (b.clone(), false)]);
        assert!(narration_cache_at(&std::env::temp_dir().join("openstage-no-such-folder-xyz")).is_err(), "not a project");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn audio_is_read_by_its_key_and_nothing_else_can_be_named() {
        let project = temp_project("narr-read");
        let folder = project.join(".cache").join("narration");
        fs::create_dir_all(&folder).unwrap();
        let key = "d".repeat(64);
        fs::write(folder.join(format!("{key}.wav")), [1u8, 2, 3]).unwrap();
        fs::write(project.join("secret.txt"), "private").unwrap();
        assert_eq!(read_narration_audio_at(&project, &key).unwrap(), vec![1, 2, 3]);
        for bad in ["", "d", "../../secret", "..\\..\\secret", &format!("{key}.wav"), &"D".repeat(64), &format!("{}g", "d".repeat(63)), &"d".repeat(65)] {
            assert!(read_narration_audio_at(&project, bad).is_err(), "{bad}");
        }
        assert!(read_narration_audio_at(&project, &"e".repeat(64)).is_err(), "a key with no audio");
        assert!(read_narration_audio_at(&std::env::temp_dir(), &key).is_err(), "not a project");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn a_place_for_the_about_window_is_the_one_found_or_what_would_be_used() {
        assert_eq!(about_where(Some(PathBuf::from("C:/x/python.exe")), "python, found on the PATH"), "C:/x/python.exe");
        assert_eq!(about_where(None, "python, found on the PATH"), "python, found on the PATH");
    }

    #[test]
    fn the_time_is_written_as_iso_in_utc() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso_utc(951_782_400), "2000-02-29T00:00:00Z", "a leap day");
        assert_eq!(iso_utc(1_792_000_000), "2026-10-14T17:46:40Z");
    }

    #[cfg(windows)]
    #[test]
    fn a_command_is_read_line_by_line_from_both_streams_and_a_failure_is_seen() {
        let _guard = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let _slot = JobSlot::take().expect("a free slot");
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "echo one& echo two 1>&2& echo three& exit 3"]);
        let mut lines = Vec::new();
        let status = run_streaming(cmd, |l| lines.push(l.to_string())).ok().expect("it ran");
        lines.sort();
        assert_eq!(lines, vec!["one", "three", "two"]);
        assert_eq!(status.code(), Some(3));
        let missing = run_streaming(Command::new("openstage-no-such-program-xyz"), |_| {});
        assert!(matches!(missing, Err(JobError::Missing)));
    }

    #[cfg(windows)]
    #[test]
    fn stopping_a_streamed_command_stops_it() {
        let _guard = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let _slot = JobSlot::take().expect("a free slot");
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "ping -n 30 127.0.0.1"]);
        let stopper = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(800));
            cancel_job_now();
        });
        let started = std::time::Instant::now();
        let outcome = run_streaming(cmd, |_| {});
        stopper.join().unwrap();
        assert!(matches!(outcome, Err(JobError::Cancelled)), "cancelled");
        assert!(started.elapsed() < Duration::from_secs(15), "it did not run to the end");
    }

    #[test]
    fn python_and_node_that_travel_with_the_program_are_found_beside_it() {
        let dir = std::env::temp_dir().join(format!("openstage-bundled-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("python")).unwrap();
        assert!(bundled_helper_in(&dir, "python", "python.exe").is_none(), "an empty folder holds nothing");
        fs::write(dir.join("python").join("python.exe"), b"x").unwrap();
        assert_eq!(bundled_helper_in(&dir, "python", "python.exe"), Some(dir.join("python").join("python.exe")));
        assert!(bundled_helper_in(&dir, "node", "node.exe").is_none(), "no node folder");
        fs::create_dir_all(dir.join("node").join("node.exe")).unwrap();
        assert!(bundled_helper_in(&dir, "node", "node.exe").is_none(), "a folder is not a program");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn audio_is_kept_under_a_second_key_when_the_two_name_the_same_sound() {
        let project = temp_project("narr-reuse");
        let folder = project.join(".cache").join("narration");
        fs::create_dir_all(&folder).unwrap();
        let (a, b) = ("a".repeat(64), "b".repeat(64));
        fs::write(folder.join(format!("{a}.wav")), [9u8, 8, 7]).unwrap();
        fs::write(folder.join(format!("{a}.json")), format!(r#"{{"hash": "sha256:{a}", "duration": 3.5, "exactTimings": false, "cues": [{{"text": "Hi"}}]}}"#)).unwrap();
        assert!(reuse_narration_audio_at(&project, &a, &b).unwrap(), "copied");
        assert_eq!(fs::read(folder.join(format!("{b}.wav"))).unwrap(), vec![9, 8, 7]);
        assert!(folder.join(format!("{a}.wav")).is_file(), "the first is still there");
        let meta: serde_json::Value = serde_json::from_str(&fs::read_to_string(folder.join(format!("{b}.json"))).unwrap()).unwrap();
        assert_eq!(meta["hash"], format!("sha256:{b}"), "the copy names itself");
        assert_eq!(meta["duration"], 3.5);
        assert_eq!(meta["cues"][0]["text"], "Hi");
        let listed = narration_cache_at(&project).unwrap();
        assert_eq!(listed.iter().map(|n| n.hash.clone()).collect::<Vec<_>>(), vec![a.clone(), b.clone()]);
        assert!(!folder.join(format!("{b}.wav.part")).exists(), "no temporary file is left");
        // Nothing is overwritten, and nothing is copied that is not there.
        fs::write(folder.join(format!("{b}.wav")), [1u8]).unwrap();
        assert!(!reuse_narration_audio_at(&project, &a, &b).unwrap(), "the new key already has its own audio");
        assert_eq!(fs::read(folder.join(format!("{b}.wav"))).unwrap(), vec![1]);
        assert!(!reuse_narration_audio_at(&project, &"c".repeat(64), &"d".repeat(64)).unwrap(), "no audio for the old key");
        assert!(!reuse_narration_audio_at(&project, &a, &a).unwrap(), "the same key");
        for bad in ["", "../x", &"A".repeat(64), &format!("{a}.wav")] {
            assert!(reuse_narration_audio_at(&project, bad, &b).is_err(), "{bad}");
            assert!(reuse_narration_audio_at(&project, &a, bad).is_err(), "{bad}");
        }
        assert!(reuse_narration_audio_at(&std::env::temp_dir(), &a, &b).is_err(), "not a project");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn a_failing_speech_engine_is_explained_plainly() {
        let said = engine_failure("Kokoro is not available in this Python (kokoro). Set OPENSTAGE_KOKORO_PYTHON to a Python that has it, or use --no-generate.\n");
        assert!(said.starts_with("The speech engine is set up, but Kokoro is not installed in it."), "{said}");
        assert!(!said.contains("--no-generate"), "no command-line words for the author");
        let other = engine_failure("noise\nTraceback (most recent call last):\n  File x\nValueError: bad voice\n");
        assert!(other.starts_with("The speech engine stopped before it finished.") && other.contains("ValueError: bad voice"), "{other}");
        assert!(!other.contains("noise"), "only the last few lines");
        assert_eq!(engine_failure(""), "The speech engine stopped before it finished.");
    }

    #[test]
    fn making_audio_refuses_what_it_should_before_it_starts() {
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let project = temp_project("narr-make-checks");
        let engine = Path::new("python");
        assert!(make_narration_blocking(engine, &std::env::temp_dir(), &[], &[]).is_err(), "not a project");
        for bad in ["", "a,b", "a b", "../x", "a;b", "obj\"1", "a//b", "/a", "a/", "a/b/c", "a/../b", "a\\b"] {
            assert!(make_narration_blocking(engine, &project, &[], &[bad.to_string()]).is_err(), "{bad}");
        }
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn an_object_or_an_interaction_item_can_be_named_but_nothing_else() {
        for good in ["obj-0001", "obj_1", "obj-0012/item-3", "a/b"] {
            assert!(narration_key_ok(good), "{good}");
        }
        for bad in ["", "/", "a/", "/b", "a//b", "a/b/c", "..", "../x", "a/..", "a b", "a,b", "a;b", "a\\b", "a/b c"] {
            assert!(!narration_key_ok(bad), "{bad}");
        }
    }

    fn narrated_slide_files(script: &str) -> Vec<FileText> {
        let slide = format!(
            r#"{{"baseLayer":{{"objects":[{{"id":"obj-1","narration":{{"script":"{script}","voice":"af_heart","speed":1.0,"lang":"en-US","pronunciations":[],"audioCache":null}}}}]}},"layers":[]}}"#
        );
        vec![
            FileText { path: "project.json".into(), text: r#"{"scenes":[{"slides":["s1"]}]}"#.into() },
            FileText { path: "slides/s1.json".into(), text: slide },
        ]
    }

    /// A speech engine that is a Python without Kokoro: the failure has to come back as a plain message, and
    /// the temporary copy of the project must not be left behind. Needs Python, so only with OPENSTAGE_PYTHON.
    #[test]
    fn an_engine_without_kokoro_says_so_and_cleans_up() {
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let Ok(python) = std::env::var("OPENSTAGE_PYTHON") else {
            eprintln!("skipped: OPENSTAGE_PYTHON is not set");
            return;
        };
        let project = temp_project("narr-nokokoro");
        let leftovers = || fs::read_dir(std::env::temp_dir()).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with(&format!("openstage-author-narrate-{}-", std::process::id()))).count();
        let found = std::process::Command::new(&python).arg("-c").arg("import kokoro").output().map(|o| o.status.success()).unwrap_or(false);
        if found {
            eprintln!("skipped: this Python has Kokoro, so it would really make audio");
            let _ = fs::remove_dir_all(&project);
            return;
        }
        let engine = PathBuf::from(&python);
        let json = make_narration_blocking(&engine, &project, &narrated_slide_files("A sentence nobody has narrated yet."), &["obj-1".to_string()]).expect("a failing engine is a result, not a crash");
        assert!(json.contains("\"ok\":false") && json.contains("Kokoro is not installed"), "{json}");
        assert_eq!(leftovers(), 0, "the temporary copy is removed");
        assert!(!project.join(".cache").exists(), "nothing was made, so nothing was cached");
        let _ = fs::remove_dir_all(&project);
    }

    /// Audio that already exists needs no speech model at all, so this can run with any Python.
    #[test]
    fn audio_that_exists_is_found_without_the_speech_model() {
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let Ok(python) = std::env::var("OPENSTAGE_PYTHON") else {
            eprintln!("skipped: OPENSTAGE_PYTHON is not set");
            return;
        };
        let Some(script) = find_repo_file("player/publish.ts") else {
            eprintln!("skipped: repository not found");
            return;
        };
        let example = script.parent().unwrap().parent().unwrap().join("examples/minimal.osproj");
        let mut files = vec![FileText { path: "project.json".into(), text: read_text(&example.join("project.json")).unwrap() }];
        for entry in fs::read_dir(example.join("slides")).unwrap().flatten() {
            files.push(FileText { path: format!("slides/{}", entry.file_name().to_str().unwrap()), text: read_text(&entry.path()).unwrap() });
        }
        let before = narration_cache_at(&example).unwrap();
        assert!(!before.is_empty(), "the example comes with its audio");
        let json = make_narration_blocking(Path::new(&python), &example, &files, &["obj-0002".to_string()]).expect("runs");
        assert_eq!(json, r#"{"ok":true}"#);
        assert_eq!(narration_cache_at(&example).unwrap().len(), before.len(), "nothing new was made or lost");
    }

    // ---- AI services and voice plugins

    fn args_of(cmd: &Command) -> Vec<String> {
        cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect()
    }
    fn env_of(cmd: &Command, name: &str) -> Option<String> {
        cmd.get_envs().find(|(k, _)| *k == std::ffi::OsStr::new(name)).and_then(|(_, v)| v.map(|v| v.to_string_lossy().into_owned()))
    }

    const AI_JSON: &str = r#"{"keys":{"pexels":"stock-key"},"ai":{
        "keys":{"openai":" sk-live-1 ","elevenlabs":"xi-2","somewhere":"else"},
        "allowed":{"openai":"2026-10-14T10:00:00Z","elevenlabs":"2026-10-14T10:00:00Z"},
        "models":{"openai":{"speech":"tts-1","picture":"bad name!"}},
        "plugins":{"tone-voice":true,"Evil One":true,"off-one":false,"../x":true}}}"#;

    #[test]
    fn what_the_author_allowed_is_read_from_the_settings() {
        let ai = AiSettings::parse(AI_JSON);
        assert_eq!(ai.keys.get("openai").map(String::as_str), Some("sk-live-1"), "the key is trimmed");
        assert!(ai.keys.contains_key("openai") && !ai.keys.contains_key("elevenlabs") && !ai.keys.contains_key("somewhere") && !ai.keys.contains_key("pexels"), "only the services OpenStage knows; an old file that names another is not trusted");
        assert!(ai.allowed.contains("openai") && !ai.allowed.contains("elevenlabs"), "a yes to a service OpenStage does not know means nothing");
        assert_eq!(ai.models.get(&("openai".to_string(), "speech".to_string())).map(String::as_str), Some("tts-1"));
        assert!(!ai.models.contains_key(&("openai".to_string(), "picture".to_string())), "a model name with odd characters is dropped");
        assert_eq!(ai.plugins, vec!["tone-voice".to_string()], "only valid ids that are switched on");
    }

    #[test]
    fn nothing_is_allowed_when_the_settings_say_nothing() {
        for text in ["", "{}", "not json", r#"{"ai":[]}"#, r#"{"ai":{"keys":{"openai":"k"}}}"#] {
            let ai = AiSettings::parse(text);
            assert!(!ai.may_use("openai") && !ai.may_use("elevenlabs"), "{text}");
            assert!(ai.plugins.is_empty());
        }
        let ai = AiSettings::parse(r#"{"ai":{"allowed":{"openai":true}}}"#);
        assert!(!ai.may_use("openai"), "yes without a key is still nothing to send with");
        assert!(AiSettings::parse(r#"{"ai":{"keys":{"openai":"k"},"allowed":{"openai":true}}}"#).may_use("openai"));
    }

    #[test]
    fn a_tool_is_given_the_key_only_of_a_service_that_was_allowed_and_never_on_the_command_line() {
        let ai = AiSettings::parse(AI_JSON);
        let mut cmd = Command::new("python");
        apply_ai(&mut cmd, &ai, Some(Path::new("C:\\plugins")));
        assert_eq!(env_of(&cmd, "OPENSTAGE_KEY_OPENAI").as_deref(), Some("sk-live-1"));
        assert_eq!(env_of(&cmd, "OPENSTAGE_KEY_ELEVENLABS"), None, "a key for a service OpenStage does not know is not handed over, even with a yes beside it");
        assert_eq!(env_of(&cmd, "OPENSTAGE_MODEL_OPENAI_SPEECH").as_deref(), Some("tts-1"));
        assert_eq!(env_of(&cmd, "PYTHONIOENCODING").as_deref(), Some("utf-8"));
        let args = args_of(&cmd);
        assert_eq!(args, vec!["--allow-network", "openai", "--plugins-dir", "C:\\plugins", "--plugins-enabled", "tone-voice"]);
        assert!(!args.iter().any(|a| a.contains("sk-live-1")), "no key where other programs can read it");
    }

    #[test]
    fn nothing_is_offered_to_a_tool_when_nothing_is_allowed() {
        let mut cmd = Command::new("python");
        apply_ai(&mut cmd, &AiSettings::default(), None);
        assert!(args_of(&cmd).is_empty());
        assert_eq!(env_of(&cmd, "OPENSTAGE_KEY_OPENAI"), None);
    }

    #[test]
    fn a_picture_that_came_back_is_checked_before_it_is_saved() {
        let project = temp_project("ai-save");
        let png = [&[0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][..], &[0u8; 16][..]].concat();
        let webp = [&b"RIFF"[..], &[36u8, 0, 0, 0][..], &b"WEBPVP8 "[..], &[0u8; 28][..]].concat();
        let first = save_generated_picture_at(&project, "a-red-barn", &webp).unwrap();
        assert_eq!(first, "assets/images/ai-a-red-barn.webp");
        let second = save_generated_picture_at(&project, "a-red-barn", &webp).unwrap();
        assert_eq!(second, "assets/images/ai-a-red-barn-2.webp", "never overwrites");
        assert_eq!(fs::read(project.join(&first)).unwrap(), webp);
        assert!(save_generated_picture_at(&project, "x", &png).is_err(), "a PNG is not what was asked for");
        assert!(save_generated_picture_at(&project, "x", b"<html>not a picture</html>").is_err());
        assert!(save_generated_picture_at(&project, "x", &[]).is_err());
        assert!(save_generated_picture_at(&project, "x", b"ID3\x04\0\0\0\0\0\0").is_err(), "a sound is not a picture");
        assert!(save_generated_picture_at(&std::env::temp_dir(), "x", &webp).is_err(), "not a project");
        let odd = save_generated_picture_at(&project, "../../Windows/System32 evil", &webp).unwrap();
        assert!(odd.starts_with("assets/images/ai-") && !odd.contains(".."), "{odd}");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn a_name_for_the_file_comes_from_the_first_words() {
        assert_eq!(name_from_prompt("A red barn in the snow at dawn, painted"), "A-red-barn-in-the");
        assert_eq!(name_from_prompt("   "), "");
    }

    #[test]
    fn a_narration_failure_is_explained_in_the_engines_own_words() {
        let said = engine_failure("  failed      a  (OpenAI did not accept the key.)\nNOT MADE: OpenAI did not accept the key. Check the key in Settings.\nNOT MADE: The plugin 'x' stopped before it answered.\n");
        assert_eq!(said, "OpenAI did not accept the key. Check the key in Settings. The plugin 'x' stopped before it answered.");
        let both = engine_failure("NOT MADE: Kokoro is not available in this Python (kokoro). Set OPENSTAGE_KOKORO_PYTHON to a Python that has it, or use --no-generate.\nNOT MADE: Kokoro is not available in this Python (kokoro). Set OPENSTAGE_KOKORO_PYTHON to a Python that has it, or use --no-generate.\n");
        assert!(both.starts_with("The speech engine is set up, but Kokoro is not installed in it.") && !both.contains("--no-generate"), "{both}");
    }

    #[test]
    fn plugins_are_listed_and_a_service_that_was_not_allowed_is_refused_by_the_tool() {
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let Ok(python) = std::env::var("OPENSTAGE_PYTHON") else {
            eprintln!("skipped: OPENSTAGE_PYTHON is not set");
            return;
        };
        let Some(script) = find_repo_file("tools/generate.py") else {
            eprintln!("skipped: repository not found");
            return;
        };
        let plugins = script.parent().unwrap().parent().unwrap().join("examples").join("plugins");
        let ai = AiSettings::parse(r#"{"ai":{"plugins":{"tone-voice":true}}}"#);
        let listed = run_generate(Path::new(&python), "plugins", &serde_json::json!({}), &ai, Some(&plugins)).expect("runs");
        assert_eq!(listed["ok"], true);
        assert_eq!(listed["plugins"][0]["id"], "tone-voice");
        assert_eq!(listed["plugins"][0]["enabled"], true);
        let refused = run_generate(Path::new(&python), "check", &serde_json::json!({ "service": "openai" }), &AiSettings::default(), None).expect("runs");
        assert_eq!(refused["ok"], false);
        assert!(refused["message"].as_str().unwrap().contains("has not been allowed"), "{refused}");
    }

    #[test]
    fn making_a_picture_refuses_what_it_should_before_it_starts() {
        let project = temp_project("ai-make-checks");
        let ai = AiSettings::default();
        let request = serde_json::json!({ "service": "openai", "prompt": "a barn" });
        assert!(ai_make_blocking(Path::new("python"), &std::env::temp_dir(), "picture", &request, &ai).is_err(), "not a project");
        assert!(ai_make_blocking(Path::new("python"), &project, "video", &request, &ai).is_err(), "only a picture can be made");
        assert!(ai_make_blocking(Path::new("python"), &project, "sound", &request, &ai).is_err(), "a sound maker is not built");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn a_path_becomes_a_safe_file_address() {
        assert_eq!(file_url(r"C:\Users\Jason\AppData\Local\Temp\openstage-author-preview\index.html"), "file:///C:/Users/Jason/AppData/Local/Temp/openstage-author-preview/index.html");
        assert_eq!(file_url(r"D:\My Course & Notes #1\a%b.html"), "file:///D:/My%20Course%20%26%20Notes%20%231/a%25b.html");
        assert_eq!(file_url("C:\\caf\u{e9}\\x.html"), "file:///C:/caf%C3%A9/x.html");
        for hostile in ["a\"b", "a^b", "a|b", "a<b>", "a b", "a;b", "a'b"] {
            let url = file_url(hostile);
            assert!(url.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'/' | b':' | b'%')), "{url}");
        }
    }

    #[test]
    fn a_registry_answer_is_read_for_its_value() {
        let prog = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\r\n    ProgId    REG_SZ    ChromeHTML\r\n\r\n";
        assert_eq!(reg_value(prog).as_deref(), Some("ChromeHTML"));
        let cmd = "\r\nHKEY_CLASSES_ROOT\\ChromeHTML\\shell\\open\\command\r\n    (Default)    REG_SZ    \"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --single-argument %1\r\n\r\n";
        assert_eq!(reg_value(cmd).as_deref(), Some("\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --single-argument %1"));
        let expand = "    (Default)    REG_EXPAND_SZ    %ProgramFiles%\\Mozilla Firefox\\firefox.exe -osint -url \"%1\"";
        assert_eq!(reg_value(expand).as_deref(), Some("%ProgramFiles%\\Mozilla Firefox\\firefox.exe -osint -url \"%1\""));
        assert_eq!(reg_value(""), None);
        assert_eq!(reg_value("ERROR: The system was unable to find the specified registry key or value."), None);
    }

    #[test]
    fn a_browsers_own_command_is_given_the_page_in_place_of_its_percent_one() {
        let url = "file:///C:/p/index.html";
        assert_eq!(browser_command_line("\"C:\\chrome.exe\" --single-argument %1", url), "\"C:\\chrome.exe\" --single-argument file:///C:/p/index.html");
        assert_eq!(browser_command_line("firefox.exe -osint -url \"%1\"", url), "firefox.exe -osint -url \"file:///C:/p/index.html\"");
        assert_eq!(browser_command_line("\"C:\\edge.exe\" --app=%L", url), "\"C:\\edge.exe\" --app=file:///C:/p/index.html");
        assert_eq!(browser_command_line("\"C:\\odd.exe\"", url), "\"C:\\odd.exe\" file:///C:/p/index.html", "a command with no place for it gets it on the end");
    }

    #[test]
    fn only_a_plain_program_id_is_used_in_a_registry_path() {
        for good in ["ChromeHTML", "MSEdgeHTM", "FirefoxURL-308046B0AF4A39CB", "AppXabc123"] {
            assert!(plain_prog_id(good), "{good}");
        }
        for bad in ["", "a\\b", "a b", "a\"b", "..\\x", "a&b", &"x".repeat(81)] {
            assert!(!plain_prog_id(bad), "{bad}");
        }
    }

    #[test]
    fn unused_narration_audio_is_deleted_by_key_and_nothing_else_is_touched() {
        let project = temp_project("clear-audio");
        let folder = project.join(".cache").join("narration");
        fs::create_dir_all(&folder).unwrap();
        let (a, b, c) = ("a".repeat(64), "b".repeat(64), "c".repeat(64));
        for key in [&a, &b, &c] {
            fs::write(folder.join(format!("{key}.wav")), [1u8, 2, 3, 4]).unwrap();
            fs::write(folder.join(format!("{key}.json")), "{}").unwrap();
        }
        fs::write(folder.join("notes.txt"), "mine").unwrap();
        fs::write(project.join("project.json.keep"), "mine").unwrap();
        let listed = narration_cache_at(&project).unwrap();
        assert!(listed.iter().all(|c| c.size == 4), "the size of each audio file is reported");

        assert_eq!(delete_narration_audio_at(&project, &[a.clone(), b.clone()]).unwrap(), 2);
        assert!(!folder.join(format!("{a}.wav")).exists() && !folder.join(format!("{a}.json")).exists());
        assert!(!folder.join(format!("{b}.wav")).exists());
        assert!(folder.join(format!("{c}.wav")).exists() && folder.join(format!("{c}.json")).exists(), "audio not named is kept");
        assert!(folder.join("notes.txt").exists() && project.join("project.json.keep").exists() && project.join("project.json").exists(), "nothing else is touched");
        assert_eq!(delete_narration_audio_at(&project, &[a.clone()]).unwrap(), 0, "audio that is already gone counts for nothing");
        assert_eq!(delete_narration_audio_at(&project, &[]).unwrap(), 0);

        for bad in ["", "d", "../../project", "..\\..\\project", &format!("{c}.wav"), &"D".repeat(64), &"c".repeat(63), &"c".repeat(65)] {
            assert!(delete_narration_audio_at(&project, &[c.clone(), bad.to_string()]).is_err(), "{bad}");
        }
        assert!(folder.join(format!("{c}.wav")).exists(), "one bad key stops everything: nothing is deleted");
        assert!(delete_narration_audio_at(&std::env::temp_dir(), &[c.clone()]).is_err(), "not a project");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn a_voice_and_a_language_are_checked_before_anything_is_asked_of_the_tool() {
        for good in ["af_heart", "openai:alloy", "my-plugin:narrator", "ef_dora"] {
            assert!(voice_name_ok(good), "{good}");
        }
        for bad in ["", "bad\nvoice", "bad\u{0}voice", &"v".repeat(101)] {
            assert!(!voice_name_ok(bad), "{bad:?}");
        }
        for good in ["en-US", "fr", "pt-BR", "zh"] {
            assert!(language_ok(good), "{good}");
        }
        for bad in ["", "en US", "en_US", "../x", &"l".repeat(17), "\u{e9}n"] {
            assert!(!language_ok(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_sample_is_read_only_if_it_is_named_like_one_and_is_a_sensible_size() {
        let cache = temp_project("sample-read");
        let key = "a".repeat(64);
        fs::write(cache.join(format!("{key}.wav")), b"RIFFdata").unwrap();
        assert_eq!(read_sample_at(&cache, &format!("{key}.wav")).unwrap(), b"RIFFdata");
        fs::write(cache.join("project.json.bak"), "mine").unwrap();
        for bad in ["", "project.json", "project.json.bak", "../project.json", "..\\project.json", &format!("{key}.json"), &format!("{key}.wav.wav"), &format!("{}.wav", "A".repeat(64)), &format!("{}.wav", "a".repeat(63)), &format!("sub/{key}.wav")] {
            assert!(read_sample_at(&cache, bad).is_err(), "{bad}");
        }
        assert!(read_sample_at(&cache, &format!("{}.wav", "b".repeat(64))).is_err(), "named like a sample but not there");
        let big = cache.join(format!("{}.wav", "c".repeat(64)));
        fs::File::create(&big).unwrap().set_len(MAX_SAMPLE_BYTES + 1).unwrap();
        assert!(read_sample_at(&cache, &format!("{}.wav", "c".repeat(64))).unwrap_err().contains("larger"));
        let _ = fs::remove_dir_all(&cache);
    }

    #[test]
    fn a_voice_sample_is_made_by_the_tool_kept_and_asks_nothing_of_a_service_that_was_not_allowed() {
        use base64::Engine;
        let _turn = JOB_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let Ok(python) = std::env::var("OPENSTAGE_PYTHON") else {
            eprintln!("skipped: OPENSTAGE_PYTHON is not set");
            return;
        };
        let Some(script) = find_repo_file("tools/voice_sample.py") else {
            eprintln!("skipped: repository not found");
            return;
        };
        let plugins = script.parent().unwrap().parent().unwrap().join("examples").join("plugins");
        let cache = temp_project("sample-tool").join("samples");
        let ai = AiSettings::parse(r#"{"ai":{"plugins":{"tone-voice":true}}}"#);

        let first: serde_json::Value = serde_json::from_str(&voice_sample_blocking(Path::new(&python), "tone-voice:low", "en-US", &cache, &ai, Some(&plugins)).expect("runs")).unwrap();
        assert_eq!(first["ok"], true, "{first}");
        assert_eq!(first["cached"], false);
        assert_eq!((first["engine"].as_str(), first["where"].as_str()), (Some("tone-voice"), Some("computer")));
        let wav = base64::engine::general_purpose::STANDARD.decode(first["audio"].as_str().unwrap()).unwrap();
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        let second: serde_json::Value = serde_json::from_str(&voice_sample_blocking(Path::new(&python), "tone-voice:low", "en-US", &cache, &ai, Some(&plugins)).expect("runs")).unwrap();
        assert_eq!((second["ok"].clone(), second["cached"].clone()), (true.into(), true.into()), "the sample is kept");

        let off: serde_json::Value = serde_json::from_str(&voice_sample_blocking(Path::new(&python), "openai:alloy", "en-US", &cache, &AiSettings::default(), None).expect("runs")).unwrap();
        assert_eq!(off["ok"], false);
        assert!(off["message"].as_str().unwrap().contains("has not been allowed"), "{off}");
        assert!(voice_sample_blocking(Path::new(&python), "bad\nvoice", "en-US", &cache, &ai, None).is_err());
        assert!(voice_sample_blocking(Path::new(&python), "af_heart", "en US", &cache, &ai, None).is_err());
        let _ = fs::remove_dir_all(cache.parent().unwrap());
    }

    fn recording_in(project: &Path, name: &str) -> PathBuf {
        let folder = project.join("captures").join(name);
        fs::create_dir_all(folder.join("takes").join("take-001")).unwrap();
        fs::write(folder.join("capture.json"), "{\"format\":\"openstage-capture-project\",\"title\":\"Demo\"}").unwrap();
        fs::write(folder.join("takes").join("take-001").join("take.json"), "{\"id\":1}").unwrap();
        fs::write(folder.join("takes").join("take-001").join("screen.mp4"), [0u8, 1, 2]).unwrap();
        folder
    }

    #[test]
    fn a_recording_is_named_by_one_plain_folder_name() {
        for good in ["Demo.capture", "Week 3 demo.capture", "Caf\u{e9}.capture", "a-b_c.capture"] {
            assert!(recording_name_ok(good), "{good}");
        }
        for bad in ["", ".capture", " .capture", "Demo", "Demo.capture.txt", "../Demo.capture", "a/b.capture", "a\\b.capture", "C:.capture", "x..y.capture", "bad\u{0}.capture", "a*b.capture", &format!("{}.capture", "x".repeat(100))] {
            assert!(!recording_name_ok(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_place_inside_a_recording_is_plain_names_and_nothing_that_climbs_out() {
        assert_eq!(recording_rel("").unwrap(), PathBuf::new());
        assert_eq!(recording_rel("takes/take-001/take.json").unwrap(), PathBuf::from("takes").join("take-001").join("take.json"));
        for bad in ["/takes", "takes/", "takes//x", "..", "../x", "takes/../x", "./x", "a\\b", "C:/x", "takes/x:y", "a/b/c/d/e/f/g", "x\u{0}y"] {
            assert!(recording_rel(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn the_recordings_of_a_course_are_listed_and_read_and_nothing_else_is_reachable() {
        let project = temp_project("recordings");
        assert_eq!(list_recordings_at(&project).unwrap(), Vec::<String>::new(), "no captures folder yet");
        recording_in(&project, "B demo.capture");
        recording_in(&project, "A demo.capture");
        fs::create_dir_all(project.join("captures").join("not a recording")).unwrap();
        fs::create_dir_all(project.join("captures").join("empty.capture")).unwrap();
        assert_eq!(list_recordings_at(&project).unwrap(), vec!["A demo.capture".to_string(), "B demo.capture".to_string()], "only real recordings, in order");

        assert!(read_recording_text_at(&project, "A demo.capture", "capture.json").unwrap().unwrap().contains("openstage-capture-project"));
        assert_eq!(read_recording_text_at(&project, "A demo.capture", "takes/take-001/take.json").unwrap().as_deref(), Some("{\"id\":1}"));
        assert_eq!(read_recording_text_at(&project, "A demo.capture", "edit.json").unwrap(), None, "no edit yet");
        assert_eq!(recording_folders_at(&project, "A demo.capture", "takes").unwrap(), vec!["take-001".to_string()]);
        assert_eq!(recording_folders_at(&project, "A demo.capture", "nothing").unwrap(), Vec::<String>::new());

        assert!(read_recording_text_at(&project, "A demo.capture", "takes/take-001/screen.mp4").is_err(), "a video is not text");
        assert!(read_recording_text_at(&project, "A demo.capture", "../../project.json").is_err(), "cannot climb out");
        assert!(read_recording_text_at(&project, "../x.capture", "capture.json").is_err(), "a name is not a path");
        assert!(read_recording_text_at(&project, "Missing.capture", "capture.json").is_err());
        assert!(read_recording_text_at(&std::env::temp_dir(), "A demo.capture", "capture.json").is_err(), "not a project");
        assert!(list_recordings_at(&std::env::temp_dir()).is_err());
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn a_takes_interaction_log_can_be_read_as_text_and_no_other_file_that_is_not_json() {
        let project = temp_project("interaction-log");
        let folder = recording_in(&project, "Demo.capture");
        let log = "{\"t\":0,\"type\":\"window\",\"title\":\"x\",\"process\":\"x.exe\"}\n";
        fs::write(folder.join("takes").join("take-001").join("events.jsonl"), log).unwrap();
        assert_eq!(read_recording_text_at(&project, "Demo.capture", "takes/take-001/events.jsonl").unwrap().as_deref(), Some(log));
        assert_eq!(read_recording_text_at(&project, "Demo.capture", "takes/take-002/events.jsonl").unwrap(), None, "no such take, no log");
        for bad in ["events.jsonl", "takes/events.jsonl", "takes/take-001/other.jsonl", "takes/take-/events.jsonl", "takes/take-1a/events.jsonl", "takes/take-001/sub/events.jsonl", "takes/take-001/screen.mp4", "takes/take-001/mic.wav"] {
            assert!(read_recording_text_at(&project, "Demo.capture", bad).is_err() || read_recording_text_at(&project, "Demo.capture", bad).unwrap().is_none(), "{bad:?}");
        }
        assert!(read_recording_text_at(&project, "Demo.capture", "takes/take-001/screen.mp4").is_err(), "a video is still not text");
        assert!(read_recording_text_at(&project, "Demo.capture", "takes/take-001/other.jsonl").is_err(), "only the interaction log");
        assert!(read_recording_text_at(&project, "Demo.capture", "takes/take-001/../take-001/events.jsonl").is_err(), "no climbing");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn the_picture_of_a_step_is_saved_as_a_real_png_under_a_safe_name_and_nothing_is_overwritten() {
        let project = temp_project("step-picture");
        let png: Vec<u8> = [&[0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][..], &[0u8; 40][..]].concat();
        let first = save_step_picture_at(&project, "Sample lesson step-3!", &png).unwrap();
        assert_eq!(first, "assets/images/Sample-lesson-step-3.png");
        assert_eq!(fs::read(project.join(&first)).unwrap(), png);
        let second = save_step_picture_at(&project, "Sample lesson step-3!", &png).unwrap();
        assert_eq!(second, "assets/images/Sample-lesson-step-3-2.png", "a name that is taken is never overwritten");
        assert_eq!(save_step_picture_at(&project, "///", &png).unwrap(), "assets/images/step.png", "a hint with nothing usable still gets a name");
        let names: Vec<String> = fs::read_dir(project.join("assets").join("images")).unwrap().flatten().filter_map(|e| e.file_name().into_string().ok()).collect();
        assert!(names.iter().all(|n| n.ends_with(".png")), "no half-written file is left: {names:?}");
        for bad in [&b"GIF89a......"[..], &b"\x89PNG"[..], &b""[..], &[0xffu8, 0xd8, 0xff, 0xe0][..], &b"<svg></svg>"[..]] {
            assert!(save_step_picture_at(&project, "x", bad).is_err(), "{bad:?}");
        }
        let huge = [&png[..8], &vec![0u8; DECK_PICTURE_MAX + 1][..]].concat();
        assert!(save_step_picture_at(&project, "x", &huge).is_err(), "too large");
        assert!(save_step_picture_at(&std::env::temp_dir(), "x", &png).is_err(), "not a project");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn steps_are_saved_whole_into_steps_json_and_only_the_edit_and_the_steps_are_ever_written() {
        let project = temp_project("recording-steps");
        let folder = recording_in(&project, "Demo.capture");
        write_recording_steps_at(&project, "Demo.capture", "{\"steps\":[]}").unwrap();
        assert_eq!(fs::read_to_string(folder.join("steps.json")).unwrap(), "{\"steps\":[]}");
        write_recording_steps_at(&project, "Demo.capture", "{\"steps\":[1]}").unwrap();
        assert_eq!(read_recording_text_at(&project, "Demo.capture", "steps.json").unwrap().as_deref(), Some("{\"steps\":[1]}"), "replaced");
        assert!(!folder.join("steps.json.tmp").exists(), "no half-written file is left");
        for bad in ["", "not json", "[1,2]", "{\"unfinished\":"] {
            assert!(write_recording_steps_at(&project, "Demo.capture", bad).is_err(), "{bad:?}");
        }
        assert_eq!(fs::read_to_string(folder.join("steps.json")).unwrap(), "{\"steps\":[1]}", "a refused list changes nothing");
        assert!(write_recording_steps_at(&project, "../Demo.capture", "{}").is_err());
        assert!(write_recording_steps_at(&project, "Missing.capture", "{}").is_err());
        for bad_file in ["capture.json", "../edit.json", "edit.json.tmp", "takes/take-001/take.json", ""] {
            assert!(write_recording_json_at(&project, "Demo.capture", bad_file, "x", "{}").is_err(), "{bad_file:?}");
        }
        assert_eq!(fs::read_to_string(folder.join("capture.json")).unwrap(), "{\"format\":\"openstage-capture-project\",\"title\":\"Demo\"}", "nothing else was touched");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn an_edit_is_saved_whole_into_edit_json_and_nothing_else_is_written() {
        let project = temp_project("recording-edit");
        let folder = recording_in(&project, "Demo.capture");
        write_recording_edit_at(&project, "Demo.capture", "{\"version\":1,\"tracks\":[]}").unwrap();
        assert_eq!(fs::read_to_string(folder.join("edit.json")).unwrap(), "{\"version\":1,\"tracks\":[]}");
        write_recording_edit_at(&project, "Demo.capture", "{\"version\":2}").unwrap();
        assert_eq!(read_recording_text_at(&project, "Demo.capture", "edit.json").unwrap().as_deref(), Some("{\"version\":2}"), "replaced");
        assert!(!folder.join("edit.json.tmp").exists(), "no half-written file is left");
        for bad in ["", "not json", "[1,2]", "5", "{\"unfinished\":"] {
            assert!(write_recording_edit_at(&project, "Demo.capture", bad).is_err(), "{bad:?}");
        }
        assert_eq!(fs::read_to_string(folder.join("edit.json")).unwrap(), "{\"version\":2}", "a refused edit changes nothing");
        assert!(write_recording_edit_at(&project, "../Demo.capture", "{}").is_err());
        assert!(write_recording_edit_at(&project, "Missing.capture", "{}").is_err());
        assert!(write_recording_edit_at(&project, "Demo.capture", &format!("{{\"x\":\"{}\"}}", "a".repeat(9 * 1024 * 1024))).is_err(), "too large");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn captions_are_saved_as_webvtt_under_assets_captions_and_nothing_else_is_reachable() {
        let project = temp_project("captions");
        let text = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello\n";
        let first = write_captions_at(&project, "My lesson!", None, text).unwrap();
        assert_eq!(first, "assets/captions/My-lesson.vtt");
        assert_eq!(read_captions_at(&project, &first).unwrap().as_deref(), Some(text));
        let second = write_captions_at(&project, "My lesson!", None, text).unwrap();
        assert_eq!(second, "assets/captions/My-lesson-2.vtt", "a new file never overwrites one that is there");
        let changed = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\nChanged\n";
        assert_eq!(write_captions_at(&project, "ignored", Some(&first), changed).unwrap(), first, "an existing file is replaced in place");
        assert_eq!(read_captions_at(&project, &first).unwrap().as_deref(), Some(changed));
        assert_eq!(read_captions_at(&project, &second).unwrap().as_deref(), Some(text), "the other file is untouched");
        let gone = write_captions_at(&project, "fresh", Some("assets/captions/gone.vtt"), text).unwrap();
        assert_eq!(gone, "assets/captions/fresh.vtt", "an existing path that is not there makes a new file instead");
        assert_eq!(read_captions_at(&project, "assets/captions/none.vtt").unwrap(), None);
        let names: Vec<String> = fs::read_dir(project.join("assets").join("captions")).unwrap().flatten().filter_map(|e| e.file_name().into_string().ok()).collect();
        assert!(names.iter().all(|n| n.ends_with(".vtt")), "no half-written file is left: {names:?}");

        for bad in ["", "not captions", "wEBVTT\n", " WEBVTT\n", "1\n00:00:00,000 --> 00:00:01,000\nHi\n"] {
            assert!(write_captions_at(&project, "x", None, bad).is_err(), "{bad:?}");
        }
        assert!(write_captions_at(&project, "x", None, &format!("WEBVTT\n\n{}", "a".repeat(6 * 1024 * 1024))).is_err(), "too large");
        for bad in ["", "assets/captions/", "assets/captions/.vtt", "assets/captions/../project.json", "assets/captions/a/b.vtt", "assets/captions/a.srt", "assets/images/a.vtt", "../assets/captions/a.vtt", "assets\\captions\\a.vtt", "assets/captions/a:b.vtt", "/assets/captions/a.vtt"] {
            assert!(read_captions_at(&project, bad).is_err(), "{bad:?}");
            assert!(write_captions_at(&project, "x", Some(bad), text).is_err(), "{bad:?}");
        }
        assert!(read_captions_at(&std::env::temp_dir(), &first).is_err(), "not a project");
        assert!(write_captions_at(&std::env::temp_dir(), "x", None, text).is_err(), "not a project");
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn a_caption_file_the_author_picked_is_read_as_text_and_only_if_it_is_one() {
        let dir = std::env::temp_dir().join(format!("openstage-test-caption-source-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.srt"), "1\n00:00:01,000 --> 00:00:02,000\nHi\n").unwrap();
        fs::write(dir.join("b.VTT"), "WEBVTT\n").unwrap();
        fs::write(dir.join("c.txt"), "WEBVTT\n").unwrap();
        fs::write(dir.join("d.srt"), [0x31u8, 0x0a, 0xe9, 0xff]).unwrap();
        fs::create_dir_all(dir.join("e.vtt")).unwrap();
        assert!(read_caption_source_at(&dir.join("a.srt")).unwrap().contains("Hi"));
        assert_eq!(read_caption_source_at(&dir.join("b.VTT")).unwrap(), "WEBVTT\n");
        assert!(read_caption_source_at(&dir.join("c.txt")).is_err(), "only .vtt and .srt");
        let e = read_caption_source_at(&dir.join("d.srt")).unwrap_err();
        assert!(e.contains("UTF-8"), "{e}");
        assert!(read_caption_source_at(&dir.join("e.vtt")).is_err(), "a folder is not a file");
        assert!(read_caption_source_at(&dir.join("missing.vtt")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
