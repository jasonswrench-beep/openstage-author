// SPDX-License-Identifier: Apache-2.0
//! Check for updates: when the author presses the button (never by itself), one request to the list of this program's releases on GitHub, and an
//! answer in words with a link to the newer release's page. Nothing is downloaded or installed; the author runs the new setup, which updates the
//! copy in place. It is the same in every tool of the suite (docs/UPDATE-CHECK.md says what and why).
//!
//! What is compared: the exact release this copy was built as (OPENSTAGE_RELEASE, set by tools/build_installer.py's RELEASE), with the highest
//! published tag: vMAJOR.MINOR.PATCH, or with -alpha.N, -beta.N or -rc.N after it (a final release comes after its pre-releases). Pre-releases
//! count, drafts never do. A copy not built by the installer (run from the source folder) is told the newest published version.
//! What is sent: nothing about the author or their courses, only a request for the list with a plain name for the program.
//! Turning it off: OPENSTAGE_UPDATE_CHECK=off in the environment, or a file update-check.txt that says off, beside the program.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

pub const RELEASES_API: &str = "https://api.github.com/repos/jasonswrench-beep/openstage-author/releases?per_page=30";
pub const RELEASES_PAGE: &str = "https://github.com/jasonswrench-beep/openstage-author/releases";
const USER_AGENT: &str = "OpenStageAuthor-update-check";
const MOST: u64 = 2 * 1024 * 1024;

/// The release this copy was built as, such as 0.1.0-alpha.5. Empty when it was not built by the installer.
pub fn release() -> &'static str {
    option_env!("OPENSTAGE_RELEASE").unwrap_or("")
}

/// A version as it sorts: the three numbers, then where it stands (alpha, beta, rc, final) and its number.
pub fn version_key(text: &str) -> Option<(u64, u64, u64, u8, u64)> {
    let text = text.trim().trim_start_matches('v');
    let (main, pre) = match text.split_once('-') {
        Some((m, p)) => (m, Some(p)),
        None => (text, None),
    };
    let mut nums = main.split('.').map(|n| if n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()) { None } else { n.parse::<u64>().ok() });
    let (a, b, c) = (nums.next()??, nums.next()??, nums.next()??);
    if nums.next().is_some() {
        return None;
    }
    let (stage, n) = match pre {
        None => (3, 0),
        Some(p) => {
            let (word, num) = p.split_once('.')?;
            let stage = match word {
                "alpha" => 0,
                "beta" => 1,
                "rc" => 2,
                _ => return None,
            };
            (stage, num.parse::<u64>().ok().filter(|_| num.bytes().all(|b| b.is_ascii_digit()))?)
        }
    };
    Some((a, b, c, stage, n))
}

/// "0.1.0 alpha 5" for 0.1.0-alpha.5.
pub fn spoken(version: &str) -> String {
    let v = version.trim_start_matches('v');
    match v.split_once('-') {
        Some((main, pre)) => format!("{main} {}", pre.replace('.', " ")),
        None => v.to_string(),
    }
}

/// The page of a release of this program, and only of this program: a tag that is not a plain version gives the list of releases.
pub fn release_page(tag: &str) -> String {
    if version_key(tag).is_some() && tag.starts_with('v') {
        format!("{RELEASES_PAGE}/tag/{tag}")
    } else {
        RELEASES_PAGE.to_string()
    }
}

/// The answer, for the page: "newer", "current", "unknown" (a copy from the source folder), "off" or "error".
pub fn answer(installed: &str, releases_json: &str) -> serde_json::Value {
    let Ok(serde_json::Value::Array(list)) = serde_json::from_str::<serde_json::Value>(releases_json) else {
        return serde_json::json!({ "state": "error", "message": "The list of releases could not be read. Try again later, or look at the releases page." , "url": RELEASES_PAGE });
    };
    let newest = list
        .iter()
        .filter(|r| r["draft"].as_bool() != Some(true))
        .filter_map(|r| r["tag_name"].as_str())
        .filter_map(|tag| version_key(tag).map(|k| (k, tag.to_string())))
        .max();
    let Some((newest_key, tag)) = newest else {
        return serde_json::json!({ "state": "error", "message": "No release is published yet.", "url": RELEASES_PAGE });
    };
    let latest = tag.trim_start_matches('v').to_string();
    match version_key(installed) {
        None => serde_json::json!({
            "state": "unknown", "latest": latest, "url": release_page(&tag),
            "message": format!("This copy was not made by the setup, so its release is not known. The newest published version is {}.", spoken(&latest)),
        }),
        Some(mine) if newest_key > mine => serde_json::json!({
            "state": "newer", "latest": latest, "url": release_page(&tag),
            "message": format!("A newer version is published: {} (this copy is {}). Its page has what changed and the setup; running the setup updates this copy and keeps your courses and settings.", spoken(&latest), spoken(installed)),
        }),
        Some(mine) => serde_json::json!({
            "state": "current", "latest": latest,
            "message": if newest_key == mine {
                format!("This copy is up to date: {} is the newest published version.", spoken(installed))
            } else {
                format!("This copy is up to date. It is {}, and the newest published version is {}.", spoken(installed), spoken(&latest))
            },
        }),
    }
}

/// Whether checking is turned off on this computer: OPENSTAGE_UPDATE_CHECK=off, or update-check.txt beside the program saying off.
pub fn turned_off(program_dir: Option<&Path>) -> bool {
    let off = |s: &str| s.trim().eq_ignore_ascii_case("off");
    std::env::var("OPENSTAGE_UPDATE_CHECK").is_ok_and(|v| off(&v))
        || program_dir.and_then(|d| std::fs::read_to_string(d.join("update-check.txt")).ok()).is_some_and(|t| off(&t))
}

/// Ask GitHub for the list of releases: HTTPS only, no redirects, at most 2 MB, 15 seconds.
fn fetch_releases() -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).redirects(0).user_agent(USER_AGENT).build();
    let resp = agent
        .get(RELEASES_API)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("GitHub answered with an error ({code}). Try again later, or look at the releases page."),
            _ => "GitHub could not be reached. Check the internet connection, or look at the releases page later.".to_string(),
        })?;
    let mut body = Vec::new();
    resp.into_reader().take(MOST + 1).read_to_end(&mut body).map_err(|_| "The list of releases did not arrive whole. Try again.".to_string())?;
    if body.len() as u64 > MOST {
        return Err("The list of releases was larger than expected, so it was not read.".into());
    }
    String::from_utf8(body).map_err(|_| "The list of releases could not be read.".to_string())
}

/// Check now, as the button asks.
pub fn check(program_dir: Option<&Path>) -> serde_json::Value {
    if turned_off(program_dir) {
        return serde_json::json!({ "state": "off", "message": "Checking for updates is turned off on this computer (by whoever looks after it)." });
    }
    match fetch_releases() {
        Ok(text) => answer(release(), &text),
        Err(message) => serde_json::json!({ "state": "error", "message": message, "url": RELEASES_PAGE }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_sort_with_pre_releases_before_the_final_one() {
        let order = ["0.1.0-alpha.1", "0.1.0-alpha.2", "0.1.0-alpha.10", "0.1.0-beta.1", "0.1.0-rc.1", "0.1.0", "0.1.1-alpha.1", "0.2.0", "1.0.0"];
        for pair in order.windows(2) {
            assert!(version_key(pair[0]).unwrap() < version_key(pair[1]).unwrap(), "{} < {}", pair[0], pair[1]);
        }
        assert_eq!(version_key("v0.1.0-alpha.4"), version_key("0.1.0-alpha.4"));
        for bad in ["", "0.1", "0.1.0.1", "0.1.0-gamma.1", "0.1.0-alpha", "0.1.0-alpha.x", "x.1.0", "0.1.0-alpha.1.2"] {
            assert_eq!(version_key(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_version_is_said_in_words() {
        assert_eq!(spoken("0.1.0-alpha.5"), "0.1.0 alpha 5");
        assert_eq!(spoken("v1.2.3"), "1.2.3");
    }

    #[test]
    fn only_this_programs_release_pages_are_offered() {
        assert_eq!(release_page("v0.1.0-alpha.5"), "https://github.com/jasonswrench-beep/openstage-author/releases/tag/v0.1.0-alpha.5");
        assert_eq!(release_page("v0.1.0-alpha.5/../../../evil"), RELEASES_PAGE);
        assert_eq!(release_page("https://example.org"), RELEASES_PAGE);
        assert_eq!(release_page("0.1.0"), RELEASES_PAGE, "a tag without its v is not one of ours");
    }

    #[test]
    fn the_answer_says_newer_current_or_unknown_and_never_counts_a_draft() {
        let list = r#"[{"tag_name":"v0.1.0-alpha.6","draft":true},{"tag_name":"v0.1.0-alpha.5","draft":false,"prerelease":true},{"tag_name":"v0.1.0-alpha.4","draft":false},{"tag_name":"nonsense"}]"#;
        let newer = answer("0.1.0-alpha.4", list);
        assert_eq!(newer["state"], "newer");
        assert_eq!(newer["latest"], "0.1.0-alpha.5");
        assert_eq!(newer["url"], "https://github.com/jasonswrench-beep/openstage-author/releases/tag/v0.1.0-alpha.5");
        assert!(newer["message"].as_str().unwrap().contains("0.1.0 alpha 5"));
        assert_eq!(answer("0.1.0-alpha.5", list)["state"], "current", "the draft alpha 6 is not offered");
        assert!(answer("0.1.0-alpha.5", list)["message"].as_str().unwrap().contains("0.1.0 alpha 5 is the newest published version"));
        let ahead = answer("0.1.0-alpha.6", list);
        assert_eq!(ahead["state"], "current");
        assert!(ahead["message"].as_str().unwrap().contains("It is 0.1.0 alpha 6, and the newest published version is 0.1.0 alpha 5."), "a copy newer than any release says so");
        assert_eq!(answer("0.1.0", list)["state"], "current", "a final release is newer than its pre-releases");
        let unknown = answer("", list);
        assert_eq!(unknown["state"], "unknown");
        assert_eq!(answer("0.1.0-alpha.4", "not json")["state"], "error");
        assert_eq!(answer("0.1.0-alpha.4", "[]")["state"], "error");
        assert_eq!(answer("0.1.0-alpha.4", r#"{"message":"rate limited"}"#)["state"], "error");
    }

    #[test]
    fn it_can_be_turned_off_with_a_file_beside_the_program() {
        let dir = std::env::temp_dir().join(format!("openstage-test-updates-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!turned_off(Some(&dir)));
        std::fs::write(dir.join("update-check.txt"), " OFF \r\n").unwrap();
        assert!(turned_off(Some(&dir)));
        std::fs::write(dir.join("update-check.txt"), "manual").unwrap();
        assert!(!turned_off(Some(&dir)));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
