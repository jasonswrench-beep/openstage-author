#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Lists the DLLs a Windows program asks for, and fails if it asks for Microsoft's Visual C++ runtime.

A program built the usual way needs the Visual C++ runtime (vcruntime140.dll, msvcp140.dll) on the computer, and a computer that has only had Windows installed may not have it. OpenStage Author's
programs are built with the C runtime inside them (editor/src-tauri/.cargo/config.toml, capture/.cargo/config.toml), so they start anywhere. This reads the import table of a finished program to check it.

  python tools/check_imports.py editor/src-tauri/target/release/openstage-editor.exe capture/target/release/openstage-capture.exe

Exit code 0 if none of them asks for the runtime, 1 if one does, 2 if a file could not be read.
"""

import struct
import sys
from pathlib import Path

# DLLs of the Visual C++ runtime. The Universal C Runtime (api-ms-win-crt-*, ucrtbase.dll) is part of Windows 10 and 11 and is fine.
RUNTIME_PREFIXES = ("vcruntime140", "msvcp140", "concrt140", "vcomp140", "vcruntime", "msvcr", "msvcp")


def imports(path):
    """The names of the DLLs a PE file imports (normal and delay-loaded), in lower case."""
    data = Path(path).read_bytes()
    if data[:2] != b"MZ":
        raise ValueError("not a Windows program")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("not a Windows program")
    sections_count = struct.unpack_from("<H", data, pe + 6)[0]
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    optional = pe + 24
    magic = struct.unpack_from("<H", data, optional)[0]
    directories = optional + (112 if magic == 0x20B else 96)
    sections = []
    table = optional + optional_size
    for i in range(sections_count):
        virtual_size, virtual_address, raw_size, raw_pointer = struct.unpack_from("<IIII", data, table + i * 40 + 8)
        sections.append((virtual_address, max(virtual_size, raw_size), raw_pointer))

    def offset(rva):
        for address, size, pointer in sections:
            if address <= rva < address + size:
                return rva - address + pointer
        raise ValueError("a table is outside the file")

    def name_at(rva):
        start = offset(rva)
        return data[start:data.index(b"\0", start)].decode("ascii", "replace").lower()

    names = []
    # Import directory (index 1): 20-byte entries, the name's address at +12, ending with an all-zero entry.
    rva, _size = struct.unpack_from("<II", data, directories + 1 * 8)
    if rva:
        at = offset(rva)
        while True:
            entry = struct.unpack_from("<IIIII", data, at)
            if entry == (0, 0, 0, 0, 0):
                break
            names.append(name_at(entry[3]))
            at += 20
    # Delay-load import directory (index 13): 32-byte entries, the name's address at +4.
    rva, _size = struct.unpack_from("<II", data, directories + 13 * 8)
    if rva:
        at = offset(rva)
        while True:
            entry = struct.unpack_from("<8I", data, at)
            if entry[1] == 0:
                break
            names.append(name_at(entry[1]))
            at += 32
    return sorted(set(names))


def runtime_imports(names):
    return [n for n in names if n.startswith(RUNTIME_PREFIXES)]


def main(paths):
    status = 0
    for path in paths:
        try:
            names = imports(path)
        except (OSError, ValueError, struct.error) as e:
            print(f"{path}: could not be read ({e})")
            return 2
        bad = runtime_imports(names)
        print(f"{Path(path).name}: {len(names)} DLLs" + (f"; ASKS FOR THE VISUAL C++ RUNTIME: {', '.join(bad)}" if bad else "; none of the Visual C++ runtime"))
        if bad:
            status = 1
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) if len(sys.argv) > 1 else 2)
