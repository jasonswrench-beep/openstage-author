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
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

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
fn run_job(mut cmd: Command) -> Result<std::process::Output, JobError> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window flashing up
    }
    let child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound { JobError::Missing } else { JobError::Failed(e.to_string()) }
    })?;
    let pid = child.id();
    *job_pid() = Some(pid);
    if JOB_CANCELLED.load(Ordering::SeqCst) {
        kill_tree(pid); // cancelled in the instant before it started
    }
    let out = child.wait_with_output().map_err(|e| JobError::Failed(e.to_string()))?;
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

const NO_ENGINE: &str = "No speech engine is set up on this computer, so audio cannot be made here. Transcripts and captions still work. OPEN EDITOR.bat looks for the speech engine in the Audiobook Studio folder; if yours is somewhere else, set OPENSTAGE_KOKORO_PYTHON to the Python that has Kokoro installed, then open OpenStage Author again.";

/// The speech engine's Python, if one is set up.
fn engine_path() -> Option<PathBuf> {
    std::env::var("OPENSTAGE_KOKORO_PYTHON").ok().map(PathBuf::from).filter(|p| p.is_file())
}

/// A narration cache key: the 64 hex digits of a SHA-256. Anything else is refused before it can name a file.
fn is_cache_key(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Serialize)]
struct CachedNarration {
    hash: String,
    duration: f64,
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
            exact_timings: meta["exactTimings"].as_bool().unwrap_or(false),
        });
    }
    out.sort_by(|a, b| a.hash.cmp(&b.hash));
    Ok(out)
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
fn make_narration_blocking(engine: &Path, dir: &Path, files: &[FileText], ids: &[String]) -> Result<String, String> {
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
        match run_job(cmd) {
            Ok(out) if out.status.success() => Ok(serde_json::json!({ "ok": true }).to_string()),
            Ok(out) => Ok(serde_json::json!({ "ok": false, "message": engine_failure(&String::from_utf8_lossy(&out.stderr)) }).to_string()),
            Err(JobError::Cancelled) => Ok(serde_json::json!({ "ok": false, "cancelled": true, "message": "Making audio was cancelled." }).to_string()),
            Err(JobError::Missing) => Err("The speech engine could not be started. Check OPENSTAGE_KOKORO_PYTHON.".into()),
            Err(JobError::Failed(e)) => Err(format!("Could not run the speech engine: {e}")),
        }
    })();
    let _ = fs::remove_dir_all(&temp);
    result
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

/// Make narration audio. The answer is JSON: ok, and if not, why.
#[tauri::command]
async fn make_narration(dir: String, files: Vec<FileText>, ids: Vec<String>) -> Result<String, String> {
    let engine = engine_path().ok_or(NO_ENGINE)?;
    tauri::async_runtime::spawn_blocking(move || make_narration_blocking(&engine, Path::new(&dir), &files, &ids))
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
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_asset(dir: String, path: String) -> Result<tauri::ipc::Response, String> {
    read_asset_at(Path::new(&dir), &path).map(tauri::ipc::Response::new)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_project, save_files, import_image, import_asset, list_assets, delete_asset, http_get, download_asset, read_settings, write_settings, create_project, migrate_project, validate, preview_project, publish_project, cancel_job, open_in_browser, narration_engine, narration_cache, read_narration_audio, make_narration, read_asset, read_asset_url])
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
        assert_eq!(report["to"], "0.15.0");
        let opened = open_project_at(&dir).unwrap();
        assert!(opened.project.contains("\"0.15.0\""));
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
            let src = std::env::temp_dir().join(format!("{}-{good}", std::process::id()));
            fs::write(&src, [1u8, 2]).unwrap();
            let got = import_asset_at(&dir, &src, "document").unwrap();
            assert!(got.starts_with("assets/documents/"), "{got}");
            let _ = fs::remove_file(&src);
        }
        for bad in ["setup.exe", "run.bat", "script.js", "page.html", "tool.ps1", "noextension", "picture.png", "clip.mp4"] {
            let src = std::env::temp_dir().join(format!("{}-{bad}", std::process::id()));
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

    /// Tests that use the one job slot take turns, because the slot is shared by the whole program.
    static JOB_TESTS: Mutex<()> = Mutex::new(());

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
}
