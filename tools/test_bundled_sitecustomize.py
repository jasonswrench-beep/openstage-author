"""Tests for tools/bundled_sitecustomize.py, with a stand-in for the registry. Run with:  python tools/test_bundled_sitecustomize.py
"""
import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import bundled_sitecustomize as sc  # noqa: E402


class FakeRegistry:
    """Just enough of winreg: one PythonPath key per hive, with a default value and subkeys."""
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE = "HKCU", "HKLM"

    def __init__(self, keys):
        self.keys = keys  # {(hive, key name): {None: default, "sub": value}}

    def OpenKeyEx(self, hive, name):
        if (hive, name) not in self.keys:
            raise OSError("no key")
        return (hive, name)

    def EnumKey(self, key, i):
        subs = [k for k in self.keys[key] if k is not None]
        if i >= len(subs):
            raise OSError("no more")
        return subs[i]

    def QueryValue(self, key, name):
        if name not in self.keys[key]:
            raise OSError("no value")
        return self.keys[key][name]

    def CloseKey(self, key):
        pass


KEY = "Software\\Python\\PythonCore\\3.12\\PythonPath"


class Registry(unittest.TestCase):
    def test_the_default_value_and_each_subkey_are_read_for_both_hives(self):
        reg = FakeRegistry({
            ("HKCU", KEY): {None: r"C:\Other\Lib;C:\Other\DLLs", "PythonWin": r"C:\Other\Lib\site-packages\win32"},
            ("HKLM", KEY): {None: r"C:\Machine\Lib"},
        })
        self.assertEqual(sorted(sc.registry_paths(reg, "3.12")), sorted([r"C:\Other\Lib", r"C:\Other\DLLs", r"C:\Other\Lib\site-packages\win32", r"C:\Machine\Lib"]))

    def test_no_key_means_nothing(self):
        self.assertEqual(sc.registry_paths(FakeRegistry({}), "3.12"), [])


class Path(unittest.TestCase):
    def test_another_pythons_folders_go_and_everything_else_stays_in_order(self):
        own = os.path.abspath("bundled")
        path = ["", os.path.join(own, "python312.zip"), r"C:\Other\Lib", r"C:\Other\DLLs", own, os.path.join(own, "Lib", "site-packages"), r"D:\engine\site-packages"]
        self.assertEqual(sc.without_foreign(path, [r"C:\Other\Lib", r"c:\other\dlls\\"], own),
                         ["", os.path.join(own, "python312.zip"), own, os.path.join(own, "Lib", "site-packages"), r"D:\engine\site-packages"])

    def test_a_folder_of_this_python_itself_is_never_taken_off(self):
        own = os.path.abspath("bundled")
        self.assertEqual(sc.without_foreign([own, os.path.join(own, "Lib")], [own, os.path.join(own, "Lib")], own), [own, os.path.join(own, "Lib")])


if __name__ == "__main__":
    unittest.main()
