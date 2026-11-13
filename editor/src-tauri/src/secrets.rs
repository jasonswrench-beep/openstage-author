// SPDX-License-Identifier: Apache-2.0
//! The keys an author gives for the stock libraries and the AI services, kept in Windows Credential Manager rather than in the settings file.
//!
//! The settings file never holds a key. The page never sees one either: where a key is saved, the settings the page reads carry a stand-in
//! instead (`OPENSTAGE-SAVED-KEY-` and the service's name), and the page puts that stand-in into a request where the key would go. The editor
//! puts the real key in its place only when the request goes to that service's own address; a stand-in bound anywhere else stops the request.
//! The AI tools are given their keys by the editor itself (AiSettings), straight from the store. A key an earlier version left in the settings
//! file is moved into the store the first time the settings are read.

use serde_json::Value;

/// How a saved key's stand-in begins. The rest is the service's name in capitals.
pub const MARK_PREFIX: &str = "OPENSTAGE-SAVED-KEY-";

/// One key: its name, where it sits in the settings file, and the one host a request carrying it may go to (None: the page never sends it).
pub struct Slot {
    pub id: &'static str,
    pub path: &'static [&'static str],
    pub host: Option<&'static str>,
}

pub const SLOTS: &[Slot] = &[
    Slot { id: "pixabay", path: &["keys", "pixabay"], host: Some("pixabay.com") },
    Slot { id: "unsplash", path: &["keys", "unsplash"], host: Some("api.unsplash.com") },
    Slot { id: "pexels", path: &["keys", "pexels"], host: Some("api.pexels.com") },
    Slot { id: "freesound", path: &["keys", "freesound"], host: Some("freesound.org") },
    Slot { id: "openai", path: &["ai", "keys", "openai"], host: None },
];

/// The stand-in for a saved key.
pub fn mark(id: &str) -> String {
    format!("{MARK_PREFIX}{}", id.to_ascii_uppercase())
}

/// Where keys are kept. The real one is Windows Credential Manager; the tests use one in memory.
pub trait Vault {
    fn get(&self, id: &str) -> Option<String>;
    fn set(&self, id: &str, key: &str) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<(), String>;
}

fn at_mut<'a>(root: &'a mut Value, path: &[&str]) -> Option<&'a mut Value> {
    path.iter().try_fold(root, |v, k| v.get_mut(*k))
}

/// The settings as the page is to see them, from the file's text: a key still in the file (from an earlier version) is moved into the store
/// first, and every saved key is shown as its stand-in. Also the text to write back to the file when something was moved.
pub fn for_page(text: &str, vault: &dyn Vault) -> (String, Option<String>) {
    let Ok(mut file) = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) else { return (text.to_string(), None) };
    if !file.is_object() {
        return (text.to_string(), None);
    }
    let mut moved = false;
    for slot in SLOTS {
        if let Some(value) = at_mut(&mut file, slot.path) {
            let key = value.as_str().unwrap_or("").trim().to_string();
            if !key.is_empty() && !key.starts_with(MARK_PREFIX) && vault.set(slot.id, &key).is_ok() {
                *value = Value::String(String::new());
                moved = true;
            }
        }
    }
    let mut page = file.clone();
    for slot in SLOTS {
        if vault.get(slot.id).is_some() {
            if let Some(value) = at_mut(&mut page, slot.path) {
                *value = Value::String(mark(slot.id));
            } else if slot.path.len() > 1 {
                // The file has no place for it (an older file, or one the page wrote without it): make one, so the page knows a key is saved.
                let mut parent = &mut page;
                for k in &slot.path[..slot.path.len() - 1] {
                    if !parent.get(*k).is_some_and(Value::is_object) {
                        parent[*k] = Value::Object(Default::default());
                    }
                    parent = parent.get_mut(*k).expect("just made");
                }
                parent[slot.path[slot.path.len() - 1]] = Value::String(mark(slot.id));
            }
        }
    }
    let page_text = serde_json::to_string(&page).unwrap_or_else(|_| text.to_string());
    let file_text = if moved { serde_json::to_string_pretty(&file).ok() } else { None };
    (page_text, file_text)
}

/// The text to write to the settings file from what the page sends. A stand-in keeps the saved key, an empty value removes it, and anything else
/// is saved as the new key; the file itself is given an empty value in every case. A key the store will not take stops the save.
pub fn from_page(text: &str, vault: &dyn Vault) -> Result<String, String> {
    let mut file = serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')).map_err(|_| "The settings could not be read, so they were not saved.".to_string())?;
    if !file.is_object() {
        return Err("The settings could not be read, so they were not saved.".into());
    }
    for slot in SLOTS {
        let Some(value) = at_mut(&mut file, slot.path) else { continue };
        let key = value.as_str().unwrap_or("").trim().to_string();
        if key.starts_with(MARK_PREFIX) {
            // The stand-in: the saved key stays as it is.
        } else if key.is_empty() {
            vault.delete(slot.id)?;
        } else {
            vault.set(slot.id, &key)?;
        }
        *value = Value::String(String::new());
    }
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

/// The host a request goes to: https only, lower case, without a port or anything after it.
fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?', '#']).next()?.rsplit('@').next()?;
    let host = host.split(':').next()?;
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// A key as it may stand in an address: every character other than letters, digits and - . _ ~ written as %XX.
fn url_safe(key: &str) -> String {
    key.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// A request from the page with each stand-in replaced by its key, where the request goes to that key's own service. A stand-in anywhere else,
/// or one whose key is not in the store, stops the request.
pub fn fill_marks(url: &str, headers: &[(String, String)], vault: &dyn Vault) -> Result<(String, Vec<(String, String)>), String> {
    let mut url = url.to_string();
    let mut headers = headers.to_vec();
    let host = host_of(&url);
    for slot in SLOTS {
        let m = mark(slot.id);
        if !url.contains(&m) && !headers.iter().any(|(_, v)| v.contains(&m)) {
            continue;
        }
        if slot.host.is_none() || host.as_deref() != slot.host {
            return Err("A saved key is only ever sent to its own service, and this request goes somewhere else.".into());
        }
        let key = vault.get(slot.id).ok_or("The saved key could not be read from Windows Credential Manager. Type it again in Settings.")?;
        url = url.replace(&m, &url_safe(&key));
        for (_, v) in headers.iter_mut() {
            *v = v.replace(&m, &key);
        }
    }
    if url.contains(MARK_PREFIX) || headers.iter().any(|(_, v)| v.contains(MARK_PREFIX)) {
        return Err("A saved key is only ever sent to its own service, and this request goes somewhere else.".into());
    }
    Ok((url, headers))
}

/// An address as it may appear in a message: without what follows ? or #, where a key can be.
pub fn without_query(url: &str) -> &str {
    url.split(['?', '#']).next().unwrap_or("")
}

/// Windows Credential Manager, as the current user's generic credentials named "OpenStage Author/<service>".
pub struct CredentialManager;

#[cfg(windows)]
mod windows_store {
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn target(id: &str) -> Vec<u16> {
        wide(&format!("OpenStage Author/{id}"))
    }

    pub fn read(id: &str) -> Option<String> {
        let name = target(id);
        let mut found: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: the name is a NUL-terminated wide string that outlives the call, and `found` is freed with CredFree below.
        let ok = unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut found) };
        if ok == 0 || found.is_null() {
            return None;
        }
        // SAFETY: CredReadW succeeded, so `found` points at a credential whose blob is CredentialBlobSize bytes long.
        let bytes = unsafe {
            let c = &*found;
            let blob = if c.CredentialBlob.is_null() { Vec::new() } else { std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec() };
            CredFree(found as *const core::ffi::c_void);
            blob
        };
        String::from_utf8(bytes).ok().filter(|k| !k.is_empty())
    }

    pub fn write(id: &str, key: &str) -> Result<(), String> {
        let mut name = target(id);
        let mut user = wide("OpenStage Author");
        let mut blob = key.as_bytes().to_vec();
        // SAFETY: CREDENTIALW is plain data, so all zeros is a valid empty value before the fields below are set.
        let mut cred: CREDENTIALW = unsafe { std::mem::zeroed() };
        cred.Type = CRED_TYPE_GENERIC;
        cred.TargetName = name.as_mut_ptr();
        cred.UserName = user.as_mut_ptr();
        cred.CredentialBlobSize = blob.len() as u32;
        cred.CredentialBlob = blob.as_mut_ptr();
        cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
        // SAFETY: every pointer in `cred` points into a buffer above that lives until after the call.
        if unsafe { CredWriteW(&cred, 0) } == 0 {
            return Err(format!("Windows Credential Manager did not take the key ({}).", std::io::Error::last_os_error()));
        }
        Ok(())
    }

    pub fn delete(id: &str) -> Result<(), String> {
        let name = target(id);
        // SAFETY: the name is a NUL-terminated wide string that outlives the call.
        if unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
            let e = std::io::Error::last_os_error();
            // 1168 is ERROR_NOT_FOUND: nothing was saved, which is what was asked for.
            if e.raw_os_error() != Some(1168) {
                return Err(format!("Windows Credential Manager did not remove the key ({e})."));
            }
        }
        Ok(())
    }
}

impl Vault for CredentialManager {
    #[cfg(windows)]
    fn get(&self, id: &str) -> Option<String> {
        windows_store::read(id)
    }
    #[cfg(windows)]
    fn set(&self, id: &str, key: &str) -> Result<(), String> {
        windows_store::write(id, key)
    }
    #[cfg(windows)]
    fn delete(&self, id: &str) -> Result<(), String> {
        windows_store::delete(id)
    }
    #[cfg(not(windows))]
    fn get(&self, _id: &str) -> Option<String> {
        None
    }
    #[cfg(not(windows))]
    fn set(&self, _id: &str, _key: &str) -> Result<(), String> {
        Err("Keys can only be kept on Windows.".into())
    }
    #[cfg(not(windows))]
    fn delete(&self, _id: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    #[derive(Default)]
    pub struct Memory(pub RefCell<BTreeMap<String, String>>);

    impl Vault for Memory {
        fn get(&self, id: &str) -> Option<String> {
            self.0.borrow().get(id).cloned()
        }
        fn set(&self, id: &str, key: &str) -> Result<(), String> {
            self.0.borrow_mut().insert(id.into(), key.into());
            Ok(())
        }
        fn delete(&self, id: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(id);
            Ok(())
        }
    }

    #[test]
    fn keys_an_earlier_version_left_in_the_file_move_to_the_store_and_the_page_sees_stand_ins() {
        let v = Memory::default();
        let file = r#"{"keys":{"pixabay":"pk-123","unsplash":"","pexels":"px 9"},"ai":{"keys":{"openai":"sk-abc"},"allowed":{"openai":"2026-11-01"}},"recent":["a"]}"#;
        let (page, rewrite) = for_page(file, &v);
        assert_eq!(v.get("pixabay").as_deref(), Some("pk-123"));
        assert_eq!(v.get("pexels").as_deref(), Some("px 9"));
        assert_eq!(v.get("openai").as_deref(), Some("sk-abc"));
        assert_eq!(v.get("unsplash"), None);
        let rewrite = rewrite.expect("the file is written again without the keys");
        for secret in ["pk-123", "px 9", "sk-abc"] {
            assert!(!rewrite.contains(secret) && !page.contains(secret), "{secret}");
        }
        let page: Value = serde_json::from_str(&page).unwrap();
        assert_eq!(page["keys"]["pixabay"], "OPENSTAGE-SAVED-KEY-PIXABAY");
        assert_eq!(page["keys"]["unsplash"], "", "nothing saved, nothing shown");
        assert_eq!(page["ai"]["keys"]["openai"], "OPENSTAGE-SAVED-KEY-OPENAI");
        assert_eq!(page["recent"], serde_json::json!(["a"]), "the rest is as it was");
        // Read again: nothing more to move.
        let (_, again) = for_page(&rewrite, &v);
        assert!(again.is_none());
    }

    #[test]
    fn a_saved_key_with_no_place_in_the_file_still_shows_as_saved() {
        let v = Memory::default();
        v.set("freesound", "fs-1").unwrap();
        v.set("openai", "sk-1").unwrap();
        let (page, _) = for_page("{}", &v);
        let page: Value = serde_json::from_str(&page).unwrap();
        assert_eq!(page["keys"]["freesound"], "OPENSTAGE-SAVED-KEY-FREESOUND");
        assert_eq!(page["ai"]["keys"]["openai"], "OPENSTAGE-SAVED-KEY-OPENAI");
    }

    #[test]
    fn saving_keeps_a_stand_in_removes_an_emptied_key_stores_a_new_one_and_writes_none_to_the_file() {
        let v = Memory::default();
        v.set("pixabay", "old-pix").unwrap();
        v.set("pexels", "old-pex").unwrap();
        let sent = r#"{"keys":{"pixabay":"OPENSTAGE-SAVED-KEY-PIXABAY","pexels":"","unsplash":" new-uns "},"ai":{"keys":{"openai":"sk-new"}}}"#;
        let file = from_page(sent, &v).unwrap();
        assert_eq!(v.get("pixabay").as_deref(), Some("old-pix"));
        assert_eq!(v.get("pexels"), None);
        assert_eq!(v.get("unsplash").as_deref(), Some("new-uns"));
        assert_eq!(v.get("openai").as_deref(), Some("sk-new"));
        for secret in ["old-pix", "new-uns", "sk-new", "OPENSTAGE-SAVED-KEY"] {
            assert!(!file.contains(secret), "{secret} in {file}");
        }
        assert!(from_page("not json", &v).is_err());
    }

    #[test]
    fn a_stand_in_becomes_the_key_only_on_the_way_to_its_own_service() {
        let v = Memory::default();
        v.set("pixabay", "12-ab/c").unwrap();
        v.set("unsplash", "u-key").unwrap();
        v.set("openai", "sk-1").unwrap();
        let (url, _) = fill_marks("https://pixabay.com/api/?key=OPENSTAGE-SAVED-KEY-PIXABAY&q=cat", &[], &v).unwrap();
        assert_eq!(url, "https://pixabay.com/api/?key=12-ab%2Fc&q=cat");
        let (_, headers) = fill_marks("https://api.unsplash.com/search/photos?query=cat", &[("Authorization".into(), "Client-ID OPENSTAGE-SAVED-KEY-UNSPLASH".into())], &v).unwrap();
        assert_eq!(headers[0].1, "Client-ID u-key");
        for (url, headers) in [
            ("https://evil.example/?key=OPENSTAGE-SAVED-KEY-PIXABAY", vec![]),
            ("https://pixabay.com.evil.example/?key=OPENSTAGE-SAVED-KEY-PIXABAY", vec![]),
            ("http://pixabay.com/api/?key=OPENSTAGE-SAVED-KEY-PIXABAY", vec![]),
            ("https://api.pexels.com/v1/search", vec![("Authorization".to_string(), "OPENSTAGE-SAVED-KEY-UNSPLASH".to_string())]),
            ("https://api.openai.com/v1/x", vec![("Authorization".to_string(), "Bearer OPENSTAGE-SAVED-KEY-OPENAI".to_string())]),
            ("https://pixabay.com/api/?key=OPENSTAGE-SAVED-KEY-SOMETHING", vec![]),
        ] {
            assert!(fill_marks(url, &headers, &v).is_err(), "{url} {headers:?}");
        }
        let missing = Memory::default();
        assert!(fill_marks("https://pixabay.com/api/?key=OPENSTAGE-SAVED-KEY-PIXABAY", &[], &missing).unwrap_err().contains("Credential Manager"));
        let (plain, _) = fill_marks("https://pixabay.com/get/x.jpg", &[], &v).unwrap();
        assert_eq!(plain, "https://pixabay.com/get/x.jpg", "a request without a stand-in is left alone");
    }

    #[test]
    fn an_address_in_a_message_loses_what_could_hold_a_key() {
        assert_eq!(without_query("https://pixabay.com/api/?key=secret&q=x"), "https://pixabay.com/api/");
        assert_eq!(without_query("https://a.example/b#token=1"), "https://a.example/b");
        assert_eq!(without_query("https://a.example/b"), "https://a.example/b");
    }

    /// The real store, with a name of its own that is removed again. Only on Windows.
    #[cfg(windows)]
    #[test]
    fn windows_credential_manager_keeps_reads_and_forgets_a_key() {
        let id = format!("test-{}", std::process::id());
        let store = CredentialManager;
        store.set(&id, "k\u{e9}y-1").unwrap();
        assert_eq!(store.get(&id).as_deref(), Some("k\u{e9}y-1"));
        store.set(&id, "key-2").unwrap();
        assert_eq!(store.get(&id).as_deref(), Some("key-2"));
        store.delete(&id).unwrap();
        assert_eq!(store.get(&id), None);
        store.delete(&id).expect("removing what is not there is fine");
    }
}
