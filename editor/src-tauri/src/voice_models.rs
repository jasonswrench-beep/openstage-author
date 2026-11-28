// SPDX-License-Identifier: Apache-2.0
//! `%ProgramData%\Voice Models`: the one folder on this computer where the OpenStage and Prism apps keep the voice models they share
//! (speech recognition, voice detection, speaker models and voices), so a model one app downloaded is there for the others and is not
//! downloaded again. Each kind has its own subfolder (`speech` holds the Whisper models). The rule is in the README; the GPU Voice Pack
//! follows the same one in `%ProgramData%\GPU Voice Pack`.
//!
//! **Trust.** Any account can make folders under `%ProgramData%` and, by default, add files to one, so a model there is used only while the
//! folder and the file are kept to this person, Windows itself (SYSTEM) and the Administrators: one of them owns it, and no one else may
//! change it or add to it. That is the same test the hubs use for the GPU Voice Pack. When the folder is not there, the editor makes it with
//! those permissions from the start (not inherited from `%ProgramData%`), so there is no moment when another account could put a file in it.
//! Other accounts may read what is in it. A folder that fails the test, made first by someone else, is never used: the editor keeps its
//! models in its own folder instead, as it did before.
//!
//! Only plain data is kept here (Whisper's model files). The narration engine is not: it is Python code and a PyTorch model, which runs code
//! when it is loaded, so it stays in the editor's own folder for this person alone (engine.rs).

use std::path::{Path, PathBuf};

/// The folder's name directly under %ProgramData%.
pub const FOLDER: &str = "Voice Models";
/// The subfolder for speech recognition models.
pub const SPEECH: &str = "speech";

/// `%ProgramData%\Voice Models\<kind>` when it can be used: there and kept to this person and the system, or, with `make`, made now with
/// those permissions. Nothing when it is not kept (another account made it or can change it) or cannot be made.
pub fn folder(kind: &str, make: bool) -> Option<PathBuf> {
    let root = os::program_data()?.join(FOLDER);
    let root = usable(&root, make, os::make_locked_folder)?;
    // A subfolder made inside the locked folder takes its permissions from it.
    usable(&root.join(kind), make, |p| std::fs::create_dir(p).map_err(|e| e.to_string()))
}

/// A folder that is there as a plain folder (not a link) and kept, or that `make` made and is then kept.
fn usable(path: &Path, make: bool, maker: impl Fn(&Path) -> Result<(), String>) -> Option<PathBuf> {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() && !os::is_reparse_point(&m) => os::kept_to_me_or_system(path).then(|| path.to_path_buf()),
        Ok(_) => None,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && make => {
            maker(path).ok()?;
            std::fs::symlink_metadata(path).ok().filter(|m| m.is_dir() && !os::is_reparse_point(m))?;
            os::kept_to_me_or_system(path).then(|| path.to_path_buf())
        }
        Err(_) => None,
    }
}

/// Whether a model file in the shared folder may be used: a plain file (not a link), kept to this person and the system.
pub fn trusted_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file() && !os::is_reparse_point(&m)) && os::kept_to_me_or_system(path)
}

#[cfg(windows)]
mod os {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
    use windows_sys::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::*;
    use windows_sys::Win32::Storage::FileSystem::CreateDirectoryW;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    /// %ProgramData% (C:\ProgramData), from Windows itself rather than the environment, which a parent program could set.
    pub fn program_data() -> Option<PathBuf> {
        use windows_sys::Win32::System::Com::CoTaskMemFree;
        use windows_sys::Win32::UI::Shell::{FOLDERID_ProgramData, SHGetKnownFolderPath};
        unsafe {
            let mut path: windows_sys::core::PWSTR = std::ptr::null_mut();
            if SHGetKnownFolderPath(&FOLDERID_ProgramData, 0, std::ptr::null_mut(), &mut path) != 0 || path.is_null() {
                return None;
            }
            let len = (0..).take_while(|&i| *path.add(i) != 0).count();
            let text = String::from_utf16(std::slice::from_raw_parts(path, len)).ok();
            CoTaskMemFree(path as *const c_void);
            text.filter(|t| !t.is_empty()).map(PathBuf::from)
        }
    }

    pub fn is_reparse_point(meta: &std::fs::Metadata) -> bool {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }

    /// This person's SID, from the program's own token, as a buffer holding a TOKEN_USER.
    fn my_token_user() -> Option<Vec<u8>> {
        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return None;
            }
            let mut size = 0u32;
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size);
            let mut buffer = vec![0u8; size as usize];
            let ok = size > 0 && GetTokenInformation(token, TokenUser, buffer.as_mut_ptr() as *mut c_void, size, &mut size) != 0;
            CloseHandle(token);
            ok.then_some(buffer)
        }
    }

    /// Makes the folder with its permissions set as it is made: full control for this person, SYSTEM and the Administrators, read and run for
    /// other accounts, passed on to everything made inside it, and nothing taken from %ProgramData%. It fails if the folder is already there.
    pub fn make_locked_folder(path: &Path) -> Result<(), String> {
        unsafe {
            let user = my_token_user().ok_or("this account could not be read")?;
            let me = (*(user.as_ptr() as *const TOKEN_USER)).User.Sid;
            let mut text: windows_sys::core::PWSTR = std::ptr::null_mut();
            if ConvertSidToStringSidW(me, &mut text) == 0 || text.is_null() {
                return Err("this account could not be read".into());
            }
            let len = (0..).take_while(|&i| *text.add(i) != 0).count();
            let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
            LocalFree(text as *mut c_void);
            // P: protected, so nothing is inherited from %ProgramData%. OICI: passed to files and folders made inside it. FA: full control.
            // 0x1200a9: read, read attributes, run and synchronize (no right to change anything).
            let sddl = format!("D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)");
            let sddl: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();
            let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut descriptor, std::ptr::null_mut()) == 0 {
                return Err("the folder's permissions could not be made".into());
            }
            let attributes = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: descriptor, bInheritHandle: 0 };
            let made = CreateDirectoryW(wide(path).as_ptr(), &attributes) != 0;
            let error = std::io::Error::last_os_error();
            LocalFree(descriptor);
            if made {
                Ok(())
            } else {
                Err(format!("the folder could not be made: {error}"))
            }
        }
    }

    /// The rights that let an account change a file or folder, or what is in a folder: write or append data (add a file or a subfolder),
    /// delete what is in it, delete it, change its permissions or owner, and the generic write and all. (The hubs' list.)
    const CHANGE_RIGHTS: u32 = 0x0002 | 0x0004 | 0x0040 | 0x0001_0000 | 0x0004_0000 | 0x0008_0000 | 0x4000_0000 | 0x1000_0000;

    /// Whether a file or folder is kept to this person, SYSTEM and the Administrators: one of them owns it, and its permissions let no one
    /// else change it or add to it. A permission that only passes to things made inside it later is not counted; any other kind of allowing
    /// permission, or none at all (anyone may change it), is refused. The same test as the hubs' (OpenStage Hub, src-tauri/src/system.rs).
    pub fn kept_to_me_or_system(path: &Path) -> bool {
        unsafe {
            let Some(user) = my_token_user() else { return false };
            let me = (*(user.as_ptr() as *const TOKEN_USER)).User.Sid;
            let trusted = |sid: PSID| IsWellKnownSid(sid, WinLocalSystemSid) != 0 || IsWellKnownSid(sid, WinBuiltinAdministratorsSid) != 0 || EqualSid(sid, me) != 0;

            let mut owner: PSID = std::ptr::null_mut();
            let mut dacl: *mut ACL = std::ptr::null_mut();
            let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            let name = wide(path);
            let wanted = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
            if GetNamedSecurityInfoW(name.as_ptr(), SE_FILE_OBJECT, wanted, &mut owner, std::ptr::null_mut(), &mut dacl, std::ptr::null_mut(), &mut descriptor) != 0 {
                return false;
            }
            let mut kept = !owner.is_null() && trusted(owner) && !dacl.is_null();
            if kept {
                let mut info: ACL_SIZE_INFORMATION = std::mem::zeroed();
                kept = GetAclInformation(dacl, &mut info as *mut _ as *mut c_void, std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32, AclSizeInformation) != 0;
                for index in 0..info.AceCount {
                    if !kept {
                        break;
                    }
                    let mut ace: *mut c_void = std::ptr::null_mut();
                    if GetAce(dacl, index, &mut ace) == 0 || ace.is_null() {
                        kept = false;
                        break;
                    }
                    let header = &*(ace as *const ACE_HEADER);
                    // 0x08: inherit-only, so it does not apply to this file or folder itself.
                    if header.AceFlags & 0x08 != 0 {
                        continue;
                    }
                    match header.AceType {
                        0 => {
                            let allowed = &*(ace as *const ACCESS_ALLOWED_ACE);
                            let sid = &allowed.SidStart as *const u32 as PSID;
                            if allowed.Mask & CHANGE_RIGHTS != 0 && !trusted(sid) {
                                kept = false;
                            }
                        }
                        4 | 5 | 9 | 11 => kept = false,
                        _ => {}
                    }
                }
            }
            LocalFree(descriptor as *mut c_void);
            kept
        }
    }
}

#[cfg(not(windows))]
mod os {
    use std::path::{Path, PathBuf};
    pub fn program_data() -> Option<PathBuf> {
        None
    }
    pub fn is_reparse_point(_meta: &std::fs::Metadata) -> bool {
        false
    }
    pub fn make_locked_folder(_path: &Path) -> Result<(), String> {
        Err("only on Windows".into())
    }
    pub fn kept_to_me_or_system(_path: &Path) -> bool {
        false
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("voice-models-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_folder_it_makes_is_kept_and_so_is_what_goes_in_it() {
        let dir = scratch("made");
        let root = usable(&dir.join(FOLDER), true, os::make_locked_folder).expect("made and kept");
        let speech = usable(&root.join(SPEECH), true, |p| std::fs::create_dir(p).map_err(|e| e.to_string())).expect("its subfolder is kept too");
        let model = speech.join("ggml-base.en.bin");
        std::fs::write(&model, b"model").unwrap();
        assert!(trusted_file(&model));
        assert!(!trusted_file(&speech.join("missing.bin")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_other_accounts_can_add_to_is_not_used() {
        let dir = scratch("open");
        let root = dir.join(FOLDER);
        std::fs::create_dir_all(&root).unwrap();
        // BUILTIN\Users may add files, as in a folder anyone made under %ProgramData%.
        let ok = std::process::Command::new("icacls").arg(&root).args(["/grant", "*S-1-5-32-545:(OI)(CI)(W)", "/Q"]).status().unwrap().success();
        assert!(ok);
        assert_eq!(usable(&root, true, os::make_locked_folder), None);
        let file = root.join("planted.bin");
        std::fs::write(&file, b"x").unwrap();
        assert!(!trusted_file(&file));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nothing_is_made_unless_asked() {
        let dir = scratch("ask");
        assert_eq!(usable(&dir.join(FOLDER), false, os::make_locked_folder), None);
        assert!(!dir.join(FOLDER).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn program_data_comes_from_windows() {
        let p = os::program_data().expect("Windows names it");
        assert!(p.is_absolute() && p.is_dir(), "{}", p.display());
    }
}
