// Keys the author saved are kept in Windows Credential Manager, not in the settings file, and the page never sees one (src-tauri/src/secrets.rs).
// Where a key is saved, the settings carry a stand-in in its place, which the page uses as it would the key: in a request to that service, the
// editor puts the key where the stand-in is, and only there.

/** How a saved key's stand-in begins (secrets.rs MARK_PREFIX). */
export const SAVED_KEY_PREFIX = "OPENSTAGE-SAVED-KEY-";

/** Whether a key field holds the stand-in of a saved key rather than a key the author typed. */
export const isSavedKey = (value: string): boolean => value.trim().startsWith(SAVED_KEY_PREFIX);

/** What the Show button says when the field holds a saved key, which is never shown. */
export const SAVED_KEY_HIDDEN = "The saved key is kept in Windows Credential Manager and is not shown here. To change it, type the new key over it and save.";
