// SPDX-License-Identifier: Apache-2.0
//! What the computer can do, so the editor offers only the kinds of presenter that will finish (docs/avatar-addon-spec.md, "Hardware detection and fallbacks"). It reads the
//! graphics cards (vendor, name, dedicated video memory), the memory, the free space where models are kept, and whether an NVIDIA card can run CUDA, and works out
//! which kinds of presenter the computer is capable of. Capable is not the same as offered: a kind is offered only when its engine is installed too, and in this version
//! the photo engines are not, so the check says what the computer could do and why it is not offered yet.

use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct Gpu {
    pub name: String,
    /// "nvidia", "amd", "intel", "microsoft" (the software adapter) or "other".
    pub vendor: &'static str,
    pub dedicated_mb: u64,
    pub software: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Facts {
    pub gpus: Vec<Gpu>,
    pub memory_mb: Option<u64>,
    pub cuda: bool,
    pub disk_free_mb: Option<u64>,
}

/// Which engines are installed. The Lite kind needs none: the editor draws it.
#[derive(Debug, Clone, Copy, Default)]
pub struct Engines {
    pub standard: bool,
    pub studio: bool,
}

/// The kinds of presenter this computer is capable of, by the spec's table (a starting point, to be tuned by a benchmark): `standard` and `studio` are whether it could,
/// and `default` is the kind to start from.
#[derive(Debug, PartialEq)]
pub struct Capable {
    pub standard: bool,
    pub studio: bool,
    pub default: &'static str,
    /// In words, why the computer is where it is in the table: shown beside a kind that cannot be offered.
    pub why: String,
}

fn best_card(f: &Facts) -> Option<&Gpu> {
    f.gpus.iter().filter(|g| !g.software).max_by_key(|g| g.dedicated_mb)
}

/// The spec's table. A dedicated card is one with at least a gigabyte of its own memory.
pub fn capability(f: &Facts) -> Capable {
    let ram = f.memory_mb.unwrap_or(0);
    let card = best_card(f).filter(|g| g.dedicated_mb >= 1024);
    match card {
        Some(g) if g.vendor == "nvidia" && g.dedicated_mb >= 8000 => Capable {
            standard: true, studio: true, default: "standard",
            why: format!("{} has {} GB of its own memory, enough for the photo kinds.", g.name, (g.dedicated_mb + 512) / 1024),
        },
        Some(g) if g.dedicated_mb >= 4000 => Capable {
            standard: true, studio: false, default: "standard",
            why: format!("{} has {} GB of its own memory: enough for a presenter made from a photo, not for the Studio kind.", g.name, (g.dedicated_mb + 512) / 1024),
        },
        _ if ram >= 8000 => Capable {
            standard: true, studio: false, default: "lite",
            why: "This computer has no graphics card with memory of its own big enough, so a presenter made from a photo would be slow: it could be left to work overnight.".to_string(),
        },
        _ => Capable {
            standard: false, studio: false, default: "lite",
            why: "This computer has no graphics card with memory of its own and less than 8 GB of memory, so only the illustrated presenters suit it.".to_string(),
        },
    }
}

/// The three kinds with whether each is offered now (capable and its engine is here) and, when it is not, why.
pub fn tiers(f: &Facts, e: Engines) -> Value {
    let c = capability(f);
    let photo = |capable: bool, engine: bool, name: &str| -> (bool, Value) {
        if !capable {
            (false, json!(format!("This computer is not capable of the {name} kind. {}", c.why)))
        } else if !engine {
            (false, json!("A presenter made from a photo is not in this version of the add-on: its engine is not installed yet."))
        } else {
            (true, Value::Null)
        }
    };
    let (standard, standard_why) = photo(c.standard, e.standard, "Standard");
    let (studio, studio_why) = photo(c.studio, e.studio, "Studio");
    json!([
        { "id": "lite", "offered": true, "capable": true, "default": c.default == "lite" || !(standard), "reason": null },
        { "id": "standard", "offered": standard, "capable": c.standard, "default": standard && c.default == "standard", "reason": standard_why },
        { "id": "studio", "offered": studio, "capable": c.studio, "default": false, "reason": studio_why },
    ])
}

fn vendor(id: u32) -> &'static str {
    match id {
        0x10DE => "nvidia",
        0x1002 | 0x1022 => "amd",
        0x8086 => "intel",
        0x1414 => "microsoft",
        _ => "other",
    }
}

#[cfg(windows)]
mod os {
    use super::{vendor, Facts, Gpu};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows::Win32::Foundation::FreeLibrary;
    use windows::Win32::System::LibraryLoader::LoadLibraryW;
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    fn gpus() -> Vec<Gpu> {
        let mut out = Vec::new();
        // SAFETY: plain COM calls on an interface this function creates and drops; every error is a card left out.
        unsafe {
            let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return out };
            let mut i = 0;
            while let Ok(adapter) = factory.EnumAdapters1(i) {
                i += 1;
                let Ok(d) = adapter.GetDesc1() else { continue };
                let end = d.Description.iter().position(|c| *c == 0).unwrap_or(d.Description.len());
                out.push(Gpu {
                    name: String::from_utf16_lossy(&d.Description[..end]).trim().to_string(),
                    vendor: vendor(d.VendorId),
                    dedicated_mb: d.DedicatedVideoMemory as u64 / (1024 * 1024),
                    software: d.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0,
                });
            }
        }
        out
    }

    fn memory_mb() -> Option<u64> {
        let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        // SAFETY: the structure is zeroed and its length is set, which is what the call asks for.
        unsafe { GlobalMemoryStatusEx(&mut status).ok()? };
        Some(status.ullTotalPhys / (1024 * 1024))
    }

    /// Whether the NVIDIA driver's CUDA library can be loaded, which is what the Studio kind needs besides the card.
    fn cuda() -> bool {
        // SAFETY: loading a system library by name and letting it go again.
        unsafe {
            match LoadLibraryW(w!("nvcuda.dll")) {
                Ok(h) => {
                    let _ = FreeLibrary(h);
                    true
                }
                Err(_) => false,
            }
        }
    }

    /// Megabytes free where `folder` is, or at the nearest folder above it that exists.
    fn disk_free_mb(folder: &std::path::Path) -> Option<u64> {
        let mut at = Some(folder);
        while let Some(p) = at {
            if p.exists() {
                let wide: Vec<u16> = p.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
                let mut free = 0u64;
                // SAFETY: a zero-ended path and one place to write the answer.
                unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut free), None, None).ok()? };
                return Some(free / (1024 * 1024));
            }
            at = p.parent();
        }
        None
    }

    pub fn facts(models_folder: &std::path::Path) -> Facts {
        Facts { gpus: gpus(), memory_mb: memory_mb(), cuda: cuda(), disk_free_mb: disk_free_mb(models_folder) }
    }
}

#[cfg(not(windows))]
mod os {
    use super::Facts;
    pub fn facts(_models_folder: &std::path::Path) -> Facts {
        Facts::default()
    }
}

/// Where models are kept: next to the add-ons, in the same OpenStage folder.
pub fn models_folder() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("OPENSTAGE_MODELS") {
        if !p.is_empty() {
            return std::path::PathBuf::from(p);
        }
    }
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local").join("share"));
    base.unwrap_or_else(std::env::temp_dir).join("OpenStage").join("models")
}

pub fn facts() -> Facts {
    os::facts(&models_folder())
}

pub fn run() -> Value {
    let f = facts();
    json!({
        "os": std::env::consts::OS,
        "cpuThreads": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        "memoryMb": f.memory_mb,
        "diskFreeMb": f.disk_free_mb,
        "cuda": f.cuda,
        "gpus": f.gpus.iter().map(|g| json!({ "name": g.name, "vendor": g.vendor, "dedicatedMb": g.dedicated_mb, "software": g.software })).collect::<Vec<_>>(),
        "capable": { "why": capability(&f).why },
        // No photo engine is installed in this version, so only the illustrated kind is offered, whatever the computer could do.
        "tiers": tiers(&f, Engines::default()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(name: &str, vendor: &'static str, mb: u64) -> Gpu {
        Gpu { name: name.to_string(), vendor, dedicated_mb: mb, software: false }
    }

    fn facts(gpus: Vec<Gpu>, ram: u64) -> Facts {
        Facts { gpus, memory_mb: Some(ram), cuda: false, disk_free_mb: Some(100_000) }
    }

    #[test]
    fn the_specs_table_is_followed_row_by_row() {
        // no dedicated card, under 8 GB: only the illustrated presenters
        let a = capability(&facts(vec![], 6000));
        assert_eq!((a.standard, a.studio, a.default), (false, false, "lite"));
        // integrated graphics, 8 GB or more: the photo kind, slowly, but the illustrated one by default
        let b = capability(&facts(vec![gpu("Intel UHD Graphics 770", "intel", 128)], 16000));
        assert_eq!((b.standard, b.studio, b.default), (true, false, "lite"));
        assert!(b.why.contains("overnight"));
        // a dedicated card with 4 to 6 GB: the photo kind, by default
        let c = capability(&facts(vec![gpu("GeForce GTX 1650", "nvidia", 4096)], 16000));
        assert_eq!((c.standard, c.studio, c.default), (true, false, "standard"));
        let d = capability(&facts(vec![gpu("Radeon RX 6600", "amd", 6144)], 16000));
        assert_eq!((d.standard, d.studio, d.default), (true, false, "standard"));
        // NVIDIA with 8 GB or more: all three
        let e = capability(&facts(vec![gpu("NVIDIA GeForce RTX 3050", "nvidia", 8192)], 16000));
        assert_eq!((e.standard, e.studio, e.default), (true, true, "standard"));
        assert!(e.why.contains("8 GB"));
        // 8 GB on an AMD card is enough for the photo kind but the Studio pack is NVIDIA only
        let f = capability(&facts(vec![gpu("Radeon RX 7600", "amd", 8192)], 32000));
        assert_eq!((f.standard, f.studio), (true, false));
    }

    #[test]
    fn the_best_real_card_counts_and_the_software_adapter_never_does() {
        let soft = Gpu { name: "Microsoft Basic Render Driver".into(), vendor: "microsoft", dedicated_mb: 0, software: true };
        let a = capability(&facts(vec![soft.clone(), gpu("Intel UHD", "intel", 128), gpu("NVIDIA GeForce RTX 3050", "nvidia", 8192)], 16000));
        assert!(a.studio, "the integrated card and the software adapter do not hide the good one");
        let b = capability(&facts(vec![soft], 4000));
        assert_eq!((b.standard, b.default), (false, "lite"));
        let big_soft = Gpu { name: "Software".into(), vendor: "other", dedicated_mb: 16000, software: true };
        assert!(!capability(&facts(vec![big_soft], 4000)).standard, "a software adapter is not a card, however much memory it says");
        assert_eq!(capability(&Facts::default()).default, "lite", "nothing known: the illustrated kind");
    }

    #[test]
    fn a_kind_is_offered_only_when_the_computer_is_capable_and_its_engine_is_here() {
        let f = facts(vec![gpu("NVIDIA GeForce RTX 3050", "nvidia", 8192)], 32000);
        let none = tiers(&f, Engines::default());
        let t = none.as_array().unwrap();
        assert_eq!((t[0]["id"].as_str(), t[0]["offered"].clone(), t[0]["default"].clone()), (Some("lite"), json!(true), json!(true)), "with no engine, the illustrated kind is the default");
        assert_eq!((t[1]["offered"].clone(), t[1]["capable"].clone()), (json!(false), json!(true)));
        assert!(t[1]["reason"].as_str().unwrap().contains("engine is not installed"));
        let with = tiers(&f, Engines { standard: true, studio: false });
        let w = with.as_array().unwrap();
        assert_eq!((w[1]["offered"].clone(), w[1]["default"].clone(), w[0]["default"].clone()), (json!(true), json!(true), json!(false)));
        assert!(w[2]["reason"].as_str().unwrap().contains("engine is not installed"));
        let small = tiers(&facts(vec![], 4000), Engines { standard: true, studio: true });
        let s = small.as_array().unwrap();
        assert_eq!((s[1]["offered"].clone(), s[2]["offered"].clone()), (json!(false), json!(false)));
        assert!(s[1]["reason"].as_str().unwrap().contains("not capable"));
    }

    #[test]
    fn this_computers_facts_are_read_without_trouble() {
        let r = run();
        assert!(r["cpuThreads"].as_u64().unwrap() >= 1);
        assert_eq!(r["tiers"].as_array().unwrap().len(), 3);
        assert_eq!(r["tiers"][0]["offered"], true);
        assert_eq!(r["tiers"][1]["offered"], false, "no photo engine is installed");
        assert!(r["gpus"].is_array());
        #[cfg(windows)]
        {
            assert!(r["memoryMb"].as_u64().unwrap() > 256);
            assert!(r["diskFreeMb"].as_u64().unwrap() > 0, "the space where models are kept is read");
        }
    }

    #[test]
    fn vendors_are_named_from_their_pci_ids() {
        assert_eq!((vendor(0x10DE), vendor(0x1002), vendor(0x8086), vendor(0x1414), vendor(1)), ("nvidia", "amd", "intel", "microsoft", "other"));
    }
}
