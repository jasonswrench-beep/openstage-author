# SPDX-License-Identifier: Apache-2.0
"""Goes into the Lib/site-packages folder of each Python that travels with OpenStage Author, as sitecustomize.py (tools/build_installer.py).

Python on Windows adds to its search path the folders that the registry lists for an installed Python of the same version
(Software\\Python\\PythonCore\\<version>\\PythonPath, for the user and for the computer). For a Python that travels with a program those are
another Python's: its standard library and its compiled modules, which come before this Python's own and can crash it (seen on a computer
that has its own Python 3.12: pip stopped with an access violation). The user's own site-packages folder is another Python's packages too.
Python runs this file before anything else is imported, and it takes those folders off the path. Nothing else is changed.
"""

import os
import sys


def registry_paths(winreg, version):
    """The folders the registry lists for this version of Python, read the way Python itself reads them."""
    found = []
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            key = winreg.OpenKeyEx(hive, "Software\\Python\\PythonCore\\" + version + "\\PythonPath")
        except OSError:
            continue
        try:
            names = []
            i = 0
            while True:
                try:
                    names.append(winreg.EnumKey(key, i))
                except OSError:
                    break
                i += 1
            for name in names + [None]:
                try:
                    value = winreg.QueryValue(key, name)
                except OSError:
                    continue
                if isinstance(value, str):
                    found.extend(p for p in value.split(";") if p)
        finally:
            winreg.CloseKey(key)
    return found


def without_foreign(path, foreign, own):
    """`path` without the entries in `foreign`, apart from any inside this Python's own folder `own`."""
    def norm(p):
        return os.path.normcase(os.path.normpath(os.path.abspath(p)))

    own = norm(own)
    drop = {norm(p) for p in foreign if p}
    kept = []
    for entry in path:
        n = norm(entry) if entry else entry
        if entry and n in drop and not (n == own or n.startswith(own + os.sep)):
            continue
        kept.append(entry)
    return kept


def tidy():
    foreign = []
    if sys.platform == "win32":
        import winreg

        foreign += registry_paths(winreg, sys.winver)
    try:
        import site

        foreign.append(site.getusersitepackages())
    except Exception:
        pass
    sys.path[:] = without_foreign(sys.path, foreign, sys.prefix)


if __name__ == "sitecustomize":  # only as the file Python runs at start, not when a test imports it
    try:
        tidy()
    except Exception:  # never stop Python from starting
        pass
