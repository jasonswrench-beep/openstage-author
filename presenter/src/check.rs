// SPDX-License-Identifier: Apache-2.0
//! What the computer can do, so the editor offers only the kinds of presenter that will finish. This version has one kind (the illustrated
//! Lite presenter, which any computer can make), so the check says what the computer has and why the photo kinds are not offered yet.

use serde_json::{json, Value};

/// Megabytes of memory the computer has, when it can be read.
#[cfg(windows)]
fn memory_mb() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    // SAFETY: the structure is zeroed and its length is set, which is what the call asks for.
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    if ok == 0 {
        None
    } else {
        Some(status.ullTotalPhys / (1024 * 1024))
    }
}

#[cfg(not(windows))]
fn memory_mb() -> Option<u64> {
    None
}

pub fn tiers() -> Value {
    json!([
        { "id": "lite", "offered": true, "default": true, "reason": null },
        { "id": "standard", "offered": false, "default": false, "reason": "A presenter made from a photo is not in this version of the add-on." },
        { "id": "studio", "offered": false, "default": false, "reason": "A presenter made from a photo is not in this version of the add-on." }
    ])
}

pub fn run() -> Value {
    json!({
        "os": std::env::consts::OS,
        "cpuThreads": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        "memoryMb": memory_mb(),
        "tiers": tiers(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_lite_kind_is_offered_and_the_others_say_why_not() {
        let r = run();
        let tiers = r["tiers"].as_array().unwrap();
        assert_eq!(tiers.len(), 3);
        assert_eq!(tiers[0]["id"], "lite");
        assert_eq!(tiers[0]["offered"], true);
        assert!(tiers[1..].iter().all(|t| t["offered"] == false && t["reason"].as_str().unwrap().contains("photo")));
        assert!(r["cpuThreads"].as_u64().unwrap() >= 1);
    }

    #[cfg(windows)]
    #[test]
    fn the_memory_is_read_on_windows() {
        assert!(memory_mb().unwrap() > 256);
    }
}
