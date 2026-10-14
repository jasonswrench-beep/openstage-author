// Reading and writing zip files, for the editor. The editor imports it from here because this is where the zip library is installed.
// A zip file can claim to hold far more than it does, so reading one is bounded.

import { unzipSync, zipSync } from "fflate";

export { zipSync };

/** The most a zip file may hold once opened, and the most any one file in it may be. */
export const UNZIP_LIMITS = { total: 400 * 1024 * 1024, file: 80 * 1024 * 1024, entries: 5000 };

/** Open a zip file into its files by name. Throws a plain sentence if it is not a zip file or is too big once opened. */
export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let count = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        count += 1;
        total += f.originalSize;
        if (count > UNZIP_LIMITS.entries) throw new Error("This file holds too many parts to be a PowerPoint deck.");
        if (f.originalSize > UNZIP_LIMITS.file) throw new Error(`The part ${f.name} is too big once opened.`);
        if (total > UNZIP_LIMITS.total) throw new Error("This file is too big once opened.");
        return !f.name.endsWith("/");
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/too (big|many)|holds too/.test(message)) throw err instanceof Error ? err : new Error(message);
    throw new Error("That file is not a PowerPoint deck: it could not be opened as a zip file.");
  }
}
