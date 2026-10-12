"""The narration cache key. Kept in its own file with no dependencies, so the speech
generator can use it from a Python that does not have the validator's packages.
Definition: docs/format-spec.md, section "The cache hash"."""
import hashlib


def narration_hash(n):
    """sha256 of a language-neutral canonical string of the narration inputs."""
    parts = [n["script"], n["voice"], f"{float(n['speed']):.3f}", n["lang"]]
    parts += [f"{p['term']}\t{p['ipa']}" for p in n["pronunciations"]]
    return "sha256:" + hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
