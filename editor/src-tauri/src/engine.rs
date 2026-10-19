// SPDX-License-Identifier: Apache-2.0
//! The narration engine (Kokoro) that the editor installs on the author's own computer, when the author asks.
//!
//! OpenStage Author's installer carries none of it: parts of what Kokoro needs for its English voices (phonemizer-fork and espeak-ng) are under the
//! GNU General Public License. Instead, one button in the editor asks, says what is going to be fetched and from where, and then runs `pip` and a
//! download of the voice model, with the Python that travels with the editor, into a folder of the editor's own. Everything here that does not need a
//! window or a network is in this file so it can be tested: where the engine lives, whether it is there, the environment it runs in, and the steps that install it.
//! Running the steps, with progress and Stop, is in `lib.rs` beside the other jobs.

use std::path::{Path, PathBuf};

/// The folder, inside the editor's own data folder, that holds the engine.
pub const FOLDER: &str = "narration-engine";
/// Written last. An engine is installed if this file is there and says so.
pub const MARKER: &str = "engine.json";
/// The voice model, from its publisher on Hugging Face (Apache-2.0).
pub const MODEL_REPO: &str = "hexgrad/Kokoro-82M";

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
}

/// Whether an engine is installed: the marker is there and is a JSON object. A half-finished install has no marker.
pub fn installed(layout: &Layout) -> bool {
    std::fs::read_to_string(layout.marker())
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .is_some_and(|v| v.is_object())
}

/// What to say in the marker: when, and what was asked for.
pub fn marker_json(when: &str, requirements: &str) -> String {
    serde_json::to_string_pretty(&serde_json::json!({ "installedAt": when, "requirements": requirements.lines().filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#')).collect::<Vec<_>>() }))
        .unwrap_or_else(|_| "{}".into())
}

/// The environment the engine runs in. The packages are found through PYTHONPATH (the Python that travels with the editor honours it); the model is
/// kept in the engine's own folder, so removing the engine removes it; and Python is told to use UTF-8 everywhere, as the tools write Unicode.
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

/// The Python that fetches only what the engine's speech needs from the model repository: the settings, the model and the voices.
fn fetch_model() -> String {
    format!(
        "from huggingface_hub import snapshot_download; snapshot_download('{MODEL_REPO}', allow_patterns=['config.json', 'kokoro-v1_0.pth', 'voices/*.pt']); print('The voice model is here.')"
    )
}

/// The Python that proves the engine speaks: it makes a short word and checks that there is sound.
fn check_speaks() -> String {
    format!(
        "from kokoro import KPipeline; p = KPipeline(lang_code='a', repo_id='{MODEL_REPO}'); \
parts = [a for _, _, a in p('Hello.', voice='af_heart') if a is not None]; \
assert parts and len(parts[0]) > 1000, 'no sound was made'; print('It speaks.')"
    )
}

/// The commands that install the engine, in order, each run with the editor's Python and `environment`. `requirements` is the pinned list of Python packages.
pub fn steps(layout: &Layout, requirements: &Path) -> Vec<Step> {
    vec![
        Step {
            label: "Fetching and installing the Python packages for the voice".into(),
            args: [
                "-m", "pip", "install", "--upgrade", "--no-cache-dir", "--disable-pip-version-check", "--no-warn-script-location", "--progress-bar", "off", "--target",
            ]
            .iter()
            .map(|s| s.to_string())
            .chain([layout.site.to_string_lossy().into_owned(), "-r".into(), requirements.to_string_lossy().into_owned()])
            .collect(),
        },
        Step { label: "Fetching the voice model".into(), args: vec!["-c".into(), fetch_model()] },
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
        std::fs::write(layout.marker(), marker_json("2026-10-19T12:00:00Z", "kokoro==0.9.4\n# a note\n\ntorch==2.5.1\n")).unwrap();
        assert!(installed(&layout));
        let said: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(layout.marker()).unwrap()).unwrap();
        assert_eq!(said["requirements"], serde_json::json!(["kokoro==0.9.4", "torch==2.5.1"]), "notes and blank lines are left out");
        assert_eq!(said["installedAt"], "2026-10-19T12:00:00Z");
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn the_engine_runs_with_its_packages_found_and_its_model_kept_in_its_own_folder() {
        let layout = Layout::in_data_dir(Path::new("D:/data"));
        let env: std::collections::HashMap<_, _> = environment(&layout, None).into_iter().collect();
        assert_eq!(env["PYTHONPATH"], layout.site.to_string_lossy());
        assert_eq!(env["HF_HOME"], layout.home.to_string_lossy());
        assert_eq!(env["PYTHONUTF8"], "1");
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
        let list = steps(&layout, Path::new("D:/app/tools/narration-requirements.txt"));
        assert_eq!(list.len(), 3);
        let first = &list[0].args;
        assert_eq!(&first[..3], ["-m", "pip", "install"]);
        let at = first.iter().position(|a| a == "--target").unwrap();
        assert_eq!(first[at + 1], layout.site.to_string_lossy());
        let r = first.iter().position(|a| a == "-r").unwrap();
        assert_eq!(first[r + 1], "D:/app/tools/narration-requirements.txt");
        assert!(first.contains(&"--no-cache-dir".to_string()), "nothing is left in pip's own cache, so removing the engine frees all of it");
        assert!(list[1].args[1].contains("snapshot_download") && list[1].args[1].contains(MODEL_REPO));
        assert!(list[2].args[1].contains("KPipeline") && list[2].args[1].contains("assert"));
        assert!(list.iter().all(|s| !s.label.is_empty()));
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
    }
}
