// How a folder or file path is written where the author reads it or copies it into a message: one kind of slash, and without the Windows user name.
//
//   C:\Users\Jo\AppData\Local\OpenStage Author\python\python.exe   is shown as   %LOCALAPPDATA%\OpenStage Author\python\python.exe
//
// Windows understands those names, and someone who is helping can tell where the folder is without being told who the author is. This is for
// reading and for pasting into a message only: a button that opens a folder, and the lines an assistant's settings need (mcpsettings.ts), keep the real path.

/** One kind of slash in a Windows path (one that starts with a drive letter or two backslashes). Anything else is left as it is. */
export function backslashed(path: string): string {
  return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path) ? path.replace(/\//g, "\\") : path;
}

/** Folders under C:\Users that belong to no person, so their name is not a user name. */
const SHARED_PROFILES = new Set(["public", "default", "default user", "all users"]);

/** A Windows path under a user's folder, shown by the name Windows gives that folder; any other text is returned as it came (with one kind of slash if it is a path). */
export function withoutUserName(path: string): string {
  const p = backslashed(path);
  const found = /^([A-Za-z]:\\Users\\([^\\]+))(\\.*)?$/i.exec(p);
  if (!found || SHARED_PROFILES.has((found[2] ?? "").toLowerCase())) return p;
  const rest = found[3] ?? "";
  const lower = rest.toLowerCase();
  const below = (folder: string): string | null =>
    lower === folder.toLowerCase() || lower.startsWith(`${folder.toLowerCase()}\\`) ? rest.slice(folder.length) : null;
  const local = below("\\AppData\\Local");
  if (local !== null) return `%LOCALAPPDATA%${local}`;
  const roaming = below("\\AppData\\Roaming");
  if (roaming !== null) return `%APPDATA%${roaming}`;
  return `%USERPROFILE%${rest}`;
}
