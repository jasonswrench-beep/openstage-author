// Which files of a project stay out of the source/ copy that a published package carries.
//
// The package holds the editable project beside the course, so an author can get it back. Anything in the project folder would go
// with it, which is why a project can list what to leave out (sourceExclude in project.json). An entry with no slash matches a file or
// folder of that name at any depth; an entry with a slash is a path from the project folder, and a folder takes everything inside it.
// The validator has the same rule (source_excluded in tools/validate.py), and both are tested against tools/source-exclude-cases.json.

export function isExcluded(rel: string, patterns: readonly string[]): boolean {
  const parts = rel.split("/");
  for (const raw of patterns) {
    const pattern = raw.replace(/\/+$/, "");
    if (pattern === "") continue;
    if (!pattern.includes("/")) {
      if (parts.includes(pattern)) return true;
    } else if (rel === pattern || rel.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}
