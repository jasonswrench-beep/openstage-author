// SPDX-License-Identifier: Apache-2.0
//! The narration engine (Kokoro) that the editor installs on the author's own computer, when the author asks.
//!
//! OpenStage Author's installer carries none of it: parts of what Kokoro needs for its English voices (phonemizer-fork and espeak-ng) are under the
//! GNU General Public License. Instead, one button in the editor asks, says what is going to be fetched and from where, and then runs `pip` and a
//! download of the voice model, with the voice's own Python that travels with the editor (`python-narration`, Python 3.12: Kokoro and its English text
//! tools do not run on a newer one yet), into a folder of the editor's own. Every package file is checked against its SHA-256 in the locked list
//! (pip --require-hashes), and the model is one fixed commit whose every file is checked too (tools/kokoro_model.py, tools/kokoro-model.json); once
//! installed, the engine works offline. Everything here that does not need a window or a network is in this file so it can be tested: where the engine
//! lives, whether it is there, the environment it runs in, and the steps that install it. Running the steps, with progress and Stop, is in `lib.rs`.

use std::path::{Path, PathBuf};

/// The folder, inside the editor's own data folder, that holds the engine.
pub const FOLDER: &str = "narration-engine";
/// Written last. An engine is installed if this file is there and says so.
pub const MARKER: &str = "engine.json";
/// What the last install printed, line by line.
pub const LOG: &str = "install-log.txt";
/// The voice model, from its publisher on Hugging Face (Apache-2.0). Which commit of it, and the hash of every file, are in tools/kokoro-model.json.
pub const MODEL_REPO: &str = "hexgrad/Kokoro-82M";
/// The folder beside the program that holds the voice's own Python.
pub const PYTHON_FOLDER: &str = "python-narration";
/// Which kind of engine a marker describes. 2 (2026-11-13): the voice's own Python 3.12, every package checked against its hash, the model fixed and
/// checked. An engine with an older marker is not used: its packages were made for another Python (3.11), so it has to be installed again.
pub const ENGINE_VERSION: u64 = 2;

/// What PyTorch (the part of the voice that makes the sound) needs from Microsoft's Visual C++ runtime and the Python that travels with the editor does not carry: a computer that has
/// only had Windows installed may lack it. (The Python carries vcruntime140.dll and vcruntime140_1.dll itself.) It is not carried by the editor either: Microsoft's own installer is the way.
pub const RUNTIME_FILES: [&str; 1] = ["msvcp140.dll"];
/// Microsoft's own permanent address for the 64-bit runtime installer.
pub const RUNTIME_URL: &str = "https://aka.ms/vs/17/release/vc_redist.x64.exe";

/// Which of the runtime's files are not in `system_dir` (Windows' System32).
pub fn runtime_missing(system_dir: &Path) -> Vec<&'static str> {
    RUNTIME_FILES.iter().copied().filter(|f| !system_dir.join(f).is_file()).collect()
}

/// Where the pieces of an engine are, under one root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub root: PathBuf,
    /// The Python packages (`pip install --target`).
    pub site: PathBuf,
    /// Where the voice model is kept (Hugging Face's own cache layout, under this).
    pub home: PathBuf,
    /// Where pip builds things while it installs (1.4 GB of it at its busiest). Inside the engine's own folder, so it is on the same drive as the packages
    /// (moving them in is quick) and a stopped or failed install does not leave it behind in the computer's temporary folder: it is cleared after every install.
    pub tmp: PathBuf,
}

impl Layout {
    /// The engine's layout inside `data_dir`, the editor's own folder on this computer.
    pub fn in_data_dir(data_dir: &Path) -> Layout {
        let root = data_dir.join(FOLDER);
        Layout { site: root.join("site-packages"), home: root.join("huggingface"), tmp: root.join("tmp"), root }
    }

    pub fn marker(&self) -> PathBuf {
        self.root.join(MARKER)
    }

    /// Everything the install commands printed, kept for the author to send when an install stops (the screen only has room for the last lines).
    pub fn log(&self) -> PathBuf {
        self.root.join(LOG)
    }
}

/// What the marker says, if it is there and is a JSON object.
fn marker(layout: &Layout) -> Option<serde_json::Map<String, serde_json::Value>> {
    std::fs::read_to_string(layout.marker()).ok().and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok()).and_then(|v| v.as_object().cloned())
}

/// Whether an engine is installed: the marker is there and describes this kind of engine. A half-finished install has no marker.
pub fn installed(layout: &Layout) -> bool {
    marker(layout).is_some_and(|m| m.get("engine").and_then(|v| v.as_u64()) == Some(ENGINE_VERSION))
}

/// Whether an engine of an older kind is installed (it finished, but for another Python): it is not used, and installing again replaces it.
pub fn outdated(layout: &Layout) -> bool {
    marker(layout).is_some_and(|m| m.get("engine").and_then(|v| v.as_u64()) != Some(ENGINE_VERSION))
}

/// What to say in the marker: which kind of engine, when, and what was installed (each package and its version, without the hashes).
pub fn marker_json(when: &str, requirements: &str) -> String {
    let packages: Vec<&str> = requirements
        .lines()
        .map(|l| l.split(" --hash").next().unwrap_or("").trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    serde_json::to_string_pretty(&serde_json::json!({ "engine": ENGINE_VERSION, "python": "3.12", "installedAt": when, "requirements": packages }))
        .unwrap_or_else(|_| "{}".into())
}

/// The environment the engine runs in. The packages are found through PYTHONPATH (the Python that travels with the editor honours it); the model is
/// kept in the engine's own folder, so removing the engine removes it; and Python is told to use UTF-8 everywhere, as the tools write Unicode.
/// It works offline (HF_HUB_OFFLINE): the model it was installed with is the one it uses, and it never looks online for another. The author's own
/// Python packages (the user site-packages folder) are not looked in.
pub fn environment(layout: &Layout, existing_pythonpath: Option<&str>) -> Vec<(String, String)> {
    let site = layout.site.to_string_lossy().into_owned();
    let pythonpath = match existing_pythonpath {
        Some(old) if !old.trim().is_empty() => format!("{site};{old}"),
        _ => site,
    };
    vec![
        ("PYTHONPATH".into(), pythonpath),
        ("HF_HOME".into(), layout.home.to_string_lossy().into_owned()),
        ("PYTHONUTF8".into(), "1".into()),
        ("HF_HUB_DISABLE_TELEMETRY".into(), "1".into()),
        ("HF_HUB_OFFLINE".into(), "1".into()),
        ("PYTHONNOUSERSITE".into(), "1".into()),
        // Python's compiled copies of the engine's modules (torch alone is hundreds of megabytes of them) are kept in the engine's own folder, so removing the engine removes them.
        ("PYTHONPYCACHEPREFIX".into(), layout.root.join("pycache").to_string_lossy().into_owned()),
    ]
}

/// What the install commands (not the engine when it runs) are also given: the engine's own temporary folder, instead of the computer's.
pub fn install_environment(layout: &Layout, existing_pythonpath: Option<&str>) -> Vec<(String, String)> {
    let mut env = environment(layout, existing_pythonpath);
    env.push(("TEMP".into(), layout.tmp.to_string_lossy().into_owned()));
    env.push(("TMP".into(), layout.tmp.to_string_lossy().into_owned()));
    env
}

/// One command of the install: what to tell the author, and what to run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub label: String,
    pub args: Vec<String>,
}

/// The Python that proves the engine speaks, offline as it will work: it makes a short word and checks that there is sound.
fn check_speaks() -> String {
    format!(
        "from kokoro import KPipeline; p = KPipeline(lang_code='a', repo_id='{MODEL_REPO}'); \
parts = [a for _, _, a in p('Hello.', voice='af_heart') if a is not None]; \
assert parts and len(parts[0]) > 1000, 'no sound was made'; print('It speaks.')"
    )
}

/// The commands that install the engine, in order, each run with the voice's own Python and `install_environment`. `requirements` is the locked list of
/// Python packages, and `model_tool` is tools/kokoro_model.py, which fetches the model and checks it against tools/kokoro-model.json beside it.
///
/// pip is told to use only packages that are already built (`--only-binary :all:`), to refuse any file whose SHA-256 is not the one in the list
/// (`--require-hashes`), and to look for them in the folder of the list as well as on PyPI. One package of the list (docopt) is published as source
/// only; building it makes pip fetch a build tool into a temporary space and run it there, which stopped on one computer ("Cannot import
/// 'setuptools.build_meta'"). Its built copy travels in that folder instead, so nothing is built on the author's computer.
pub fn steps(layout: &Layout, requirements: &Path, model_tool: &Path) -> Vec<Step> {
    let built_here = requirements.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    vec![
        Step {
            label: "Fetching and installing the Python packages for the voice".into(),
            args: [
                "-m", "pip", "install", "--upgrade", "--no-cache-dir", "--disable-pip-version-check", "--no-warn-script-location", "--progress-bar", "off", "--only-binary", ":all:",
                "--require-hashes", "--find-links",
            ]
            .iter()
            .map(|s| s.to_string())
            .chain([built_here, "--target".into()])
            .chain([layout.site.to_string_lossy().into_owned(), "-r".into(), requirements.to_string_lossy().into_owned()])
            .collect(),
        },
        Step { label: "Fetching the voice model and checking every file of it".into(), args: vec![model_tool.to_string_lossy().into_owned()] },
        Step { label: "Checking that it speaks".into(), args: vec!["-c".into(), check_speaks()] },
    ]
}

/// Whether `path` is the engine's folder and nothing else: only that folder, inside a data folder, may be removed.
pub fn is_engine_folder(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n == FOLDER) && path.parent().is_some_and(|p| p.file_name().is_some())
}

/// Remove a folder and everything in it. On Windows a file can be briefly held by a program that is looking at it (a virus scanner, a program that has only just
/// stopped) or be marked read-only, and the plain removal then gives up with the folder half gone. This goes on past what it cannot remove, clears a read-only mark,
/// tries again a few times, and if something still will not go, says which file it was.
pub fn remove_tree(path: &Path) -> Result<(), String> {
    const TRIES: u32 = 6;
    for attempt in 1..=TRIES {
        let mut stuck: Option<(PathBuf, String)> = None;
        remove_tree_once(path, &mut stuck);
        if !path.exists() {
            return Ok(());
        }
        if attempt == TRIES {
            return Err(match stuck {
                Some((file, why)) => format!("{} could not be removed: {why}", file.display()),
                None => format!("{} could not be removed.", path.display()),
            });
        }
        std::thread::sleep(std::time::Duration::from_millis(800));
    }
    Ok(())
}

fn remove_tree_once(path: &Path, stuck: &mut Option<(PathBuf, String)>) {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return };
    if meta.is_dir() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                remove_tree_once(&entry.path(), stuck);
            }
        }
        if let Err(e) = std::fs::remove_dir(path) {
            stuck.get_or_insert((path.to_path_buf(), e.to_string()));
        }
        return;
    }
    // A file, or a link (a link to a folder is removed like a folder, without touching what it points at).
    let mut result = std::fs::remove_file(path).or_else(|_| std::fs::remove_dir(path));
    if result.is_err() {
        let mut permissions = meta.permissions();
        if permissions.readonly() {
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            let _ = std::fs::set_permissions(path, permissions);
            result = std::fs::remove_file(path);
        }
    }
    if let Err(e) = result {
        stuck.get_or_insert((path.to_path_buf(), e.to_string()));
    }
}

/// How many bytes are under a folder (0 if it is not there). Used to say how much removing the engine frees.
pub fn folder_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => folder_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openstage-engine-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_engine_lives_in_one_folder_of_the_editors_own() {
        let data = Path::new("C:/Users/x/AppData/Local/com.openstageauthor.editor");
        let layout = Layout::in_data_dir(data);
        assert_eq!(layout.root, data.join("narration-engine"));
        assert_eq!(layout.site, layout.root.join("site-packages"));
        assert_eq!(layout.home, layout.root.join("huggingface"));
        assert_eq!(layout.tmp, layout.root.join("tmp"));
        assert_eq!(layout.marker(), layout.root.join("engine.json"));
        assert_eq!(layout.log(), layout.root.join("install-log.txt"));
    }

    #[test]
    fn an_engine_is_installed_only_when_the_marker_says_so() {
        let data = temp("marker");
        let layout = Layout::in_data_dir(&data);
        assert!(!installed(&layout), "nothing there");
        std::fs::create_dir_all(&layout.site).unwrap();
        assert!(!installed(&layout), "packages with no marker are a half-finished install");
        std::fs::write(layout.marker(), "not json").unwrap();
        assert!(!installed(&layout));
        std::fs::write(layout.marker(), marker_json("2026-10-19T12:00:00Z", "kokoro==0.9.4 --hash=sha256:00\n# a note\n\ntorch==2.15.0 --hash=sha256:11\n")).unwrap();
        assert!(installed(&layout));
        assert!(!outdated(&layout));
        let said: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(layout.marker()).unwrap()).unwrap();
        assert_eq!(said["requirements"], serde_json::json!(["kokoro==0.9.4", "torch==2.15.0"]), "notes, blank lines and hashes are left out");
        assert_eq!(said["installedAt"], "2026-10-19T12:00:00Z");
        assert_eq!(said["engine"], ENGINE_VERSION);
        // An engine an earlier editor installed (its marker has no "engine") was made for another Python: it is not used, and is to be installed again.
        std::fs::write(layout.marker(), r#"{ "installedAt": "2026-10-22T23:12:19Z", "requirements": ["kokoro==0.9.4"] }"#).unwrap();
        assert!(!installed(&layout));
        assert!(outdated(&layout));
        std::fs::remove_file(layout.marker()).unwrap();
        assert!(!outdated(&layout), "no marker is a half-finished install, not an older one");
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn the_engine_runs_with_its_packages_found_and_its_model_kept_in_its_own_folder() {
        let layout = Layout::in_data_dir(Path::new("D:/data"));
        let env: std::collections::HashMap<_, _> = environment(&layout, None).into_iter().collect();
        assert_eq!(env["PYTHONPATH"], layout.site.to_string_lossy());
        assert_eq!(env["HF_HOME"], layout.home.to_string_lossy());
        assert_eq!(env["PYTHONUTF8"], "1");
        assert_eq!(env["PYTHONPYCACHEPREFIX"], layout.root.join("pycache").to_string_lossy());
        assert_eq!(env["HF_HUB_OFFLINE"], "1", "at work it never looks online for a newer model");
        assert_eq!(env["PYTHONNOUSERSITE"], "1", "nor in the author's own Python packages");
        let kept: std::collections::HashMap<_, _> = environment(&layout, Some("C:/mine")).into_iter().collect();
        assert!(kept["PYTHONPATH"].ends_with(";C:/mine") && kept["PYTHONPATH"].starts_with(&*layout.site.to_string_lossy()), "{}", kept["PYTHONPATH"]);
        let blank: std::collections::HashMap<_, _> = environment(&layout, Some("  ")).into_iter().collect();
        assert_eq!(blank["PYTHONPATH"], layout.site.to_string_lossy());
        assert!(!env.contains_key("TEMP"), "the engine at work uses the computer's temporary folder as any program does");
        let install: std::collections::HashMap<_, _> = install_environment(&layout, None).into_iter().collect();
        assert_eq!(install["TEMP"], layout.tmp.to_string_lossy());
        assert_eq!(install["TMP"], layout.tmp.to_string_lossy());
        assert_eq!(install["HF_HOME"], layout.home.to_string_lossy());
    }

    #[test]
    fn the_install_is_three_commands_in_order_and_only_the_first_names_the_packages() {
        let layout = Layout::in_data_dir(Path::new("D:/data"));
        let list = steps(&layout, Path::new("D:/app/tools/narration-requirements.txt"), Path::new("D:/app/tools/kokoro_model.py"));
        assert_eq!(list.len(), 3);
        let first = &list[0].args;
        assert_eq!(&first[..3], ["-m", "pip", "install"]);
        let at = first.iter().position(|a| a == "--target").unwrap();
        assert_eq!(first[at + 1], layout.site.to_string_lossy());
        let r = first.iter().position(|a| a == "-r").unwrap();
        assert_eq!(first[r + 1], "D:/app/tools/narration-requirements.txt");
        assert!(first.contains(&"--no-cache-dir".to_string()), "nothing is left in pip's own cache, so removing the engine frees all of it");
        let only = first.iter().position(|a| a == "--only-binary").unwrap();
        assert_eq!(first[only + 1], ":all:", "pip builds nothing on the author's computer");
        let links = first.iter().position(|a| a == "--find-links").unwrap();
        assert_eq!(first[links + 1], "D:/app/tools", "what is built already travels beside the list");
        assert!(first.contains(&"--require-hashes".to_string()), "a package file whose SHA-256 is not the list's is refused");
        assert_eq!(list[1].args, ["D:/app/tools/kokoro_model.py"], "the model is fetched by the tool that checks it");
        assert!(list[2].args[1].contains("KPipeline") && list[2].args[1].contains("assert"));
        assert!(list.iter().all(|s| !s.label.is_empty()));
    }

    #[test]
    fn the_visual_cpp_runtime_is_looked_for_in_the_system_folder() {
        let dir = temp("runtime");
        assert_eq!(runtime_missing(&dir), vec!["msvcp140.dll"], "an empty folder has none of it");
        std::fs::write(dir.join("msvcp140.dll"), "x").unwrap();
        assert!(runtime_missing(&dir).is_empty());
        assert!(RUNTIME_URL.starts_with("https://aka.ms/"), "Microsoft's own address");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_the_engines_own_folder_may_be_removed() {
        assert!(is_engine_folder(Path::new("C:/Users/x/AppData/Local/com.openstageauthor.editor/narration-engine")));
        assert!(!is_engine_folder(Path::new("C:/Users/x/AppData/Local/com.openstageauthor.editor")));
        assert!(!is_engine_folder(Path::new("C:/Users/x/Documents")));
        assert!(!is_engine_folder(Path::new("narration-engine-old")));
        assert!(!is_engine_folder(Path::new("/")));
        assert!(!is_engine_folder(Path::new("")));
    }

    #[test]
    fn a_folder_is_removed_whole_even_with_a_read_only_file_in_it_and_a_missing_one_is_fine() {
        let data = temp("remove");
        std::fs::create_dir_all(data.join("a").join("b")).unwrap();
        std::fs::write(data.join("a").join("one"), "x").unwrap();
        let locked = data.join("a").join("b").join("read-only");
        std::fs::write(&locked, "x").unwrap();
        let mut p = std::fs::metadata(&locked).unwrap().permissions();
        p.set_readonly(true);
        std::fs::set_permissions(&locked, p).unwrap();
        remove_tree(&data).expect("removed");
        assert!(!data.exists());
        remove_tree(&data).expect("a folder that is not there is already gone");
    }

    #[cfg(windows)]
    #[test]
    fn a_file_that_is_held_for_a_moment_is_waited_for() {
        let data = temp("held");
        let held = data.join("held.dll");
        std::fs::write(&held, "x").unwrap();
        // Open without sharing delete, as a program using a library does; let go after a second.
        use std::os::windows::fs::OpenOptionsExt;
        let file = std::fs::OpenOptions::new().read(true).share_mode(1).open(&held).unwrap();
        let letting_go = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            drop(file);
        });
        remove_tree(&data).expect("removed once it was let go");
        letting_go.join().unwrap();
        assert!(!data.exists());
    }

    #[test]
    fn the_size_of_a_folder_counts_what_is_under_it() {
        let data = temp("size");
        std::fs::create_dir_all(data.join("a").join("b")).unwrap();
        std::fs::write(data.join("one"), [0u8; 10]).unwrap();
        std::fs::write(data.join("a").join("two"), [0u8; 20]).unwrap();
        std::fs::write(data.join("a").join("b").join("three"), [0u8; 30]).unwrap();
        assert_eq!(folder_size(&data), 60);
        assert_eq!(folder_size(&data.join("nothing")), 0);
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn the_pinned_list_is_a_complete_lock_that_names_kokoro_and_what_spacy_needs() {
        let text = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/narration-requirements.txt")).expect("tools/narration-requirements.txt");
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#')).collect();
        assert!(lines.iter().any(|l| l.starts_with("kokoro==")));
        // The newest typer no longer brings in click, which spaCy's command line imports: it must be named.
        assert!(lines.iter().any(|l| l.starts_with("click==")), "click is pinned");
        assert!(lines.len() > 60, "it is the whole closure, not a short list: {} lines", lines.len());
        assert!(lines.iter().all(|l| l.contains("==") || l.contains(" @ https://")), "every package is pinned: {lines:?}");
        assert!(lines.iter().all(|l| l.split(" --hash=sha256:").nth(1).is_some_and(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))), "every package has its SHA-256");
        let version = |name: &str| lines.iter().find_map(|l| l.strip_prefix(name)).and_then(|rest| rest.split_whitespace().next()).map(|v| v.split('.').map(|n| n.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>());
        assert!(version("torch==").is_some_and(|v| v >= vec![2, 6]), "torch 2.6.0 or later: the flaw that let a crafted file run code is fixed there");
        assert!(text.contains("# Locked for Python 3.12."), "locked for the voice's own Python");
    }

    /// The model is one fixed commit, and every file the engine uses has its size and SHA-256 in the list.
    #[test]
    fn the_model_list_names_one_commit_and_a_hash_for_every_voice() {
        let tools = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools");
        let model: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(tools.join("kokoro-model.json")).unwrap()).unwrap();
        assert_eq!(model["repo"], MODEL_REPO);
        assert_eq!(model["revision"].as_str().map(str::len), Some(40));
        let voices: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(tools.join("kokoro-voices.json")).unwrap()).unwrap();
        let files = model["files"].as_object().unwrap();
        for v in voices["voices"].as_array().unwrap() {
            let entry = &files[&format!("voices/{}.pt", v.as_str().unwrap())];
            assert_eq!(entry["sha256"].as_str().map(str::len), Some(64), "{v}");
        }
        assert!(files.contains_key("config.json") && files.contains_key("kokoro-v1_0.pth"));
    }

    /// docopt is published as source only. Installing with `--only-binary :all:` needs its built copy beside the list, at the pinned version.
    #[test]
    fn docopt_comes_already_built_beside_the_list_at_the_pinned_version() {
        let tools = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools");
        let text = std::fs::read_to_string(tools.join("narration-requirements.txt")).unwrap();
        let pin = text.lines().find_map(|l| l.trim().strip_prefix("docopt==")).and_then(|rest| rest.split_whitespace().next()).expect("docopt is pinned");
        let wheel = tools.join(format!("docopt-{pin}-py2.py3-none-any.whl"));
        assert!(wheel.is_file(), "{} is missing: build it from the source on PyPI when the pin changes", wheel.display());
    }
}
