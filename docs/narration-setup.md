# Setting up narration (the Kokoro speech engine)

Spoken narration in a course is made by **Kokoro**, a speech model that runs on your own computer. It is not part of OpenStage Author and is not installed
with it. Without it everything else works: a course has transcripts and captions, and a narration made with an online voice (OpenAI) or a voice plugin does
not need Kokoro at all.

Why it is separate: Kokoro itself and its model are Apache-2.0, but the usual way of installing it also installs `phonemizer-fork` and `espeak-ng`, which are
under the GNU General Public License. OpenStage Author is Apache-2.0 and does not include, bundle or host them; the editor only runs the engine as a separate
program that you installed. The reasons, and the choices open about it, are in `docs/decisions/0004-packaging-and-narration.md`.

## The easy way: a button

In an installed OpenStage Author, open **Narration...** (in the **Narration** menu). The section "Narration voice on this computer" has **Install the narration voice...**. It asks first: what is
downloaded (about 590 MB, from pypi.org and huggingface.co), how much room it takes (1.5 GB, and about 1.5 GB more free on the same drive while it installs), that parts of it are GPL, and that nothing from your courses is sent. Then it installs into OpenStage's own
folder (`%LOCALAPPDATA%\com.openstageauthor.editor\narration-engine`), a step at a time, with Cancel. It runs in the voice's own copy of Python that comes with OpenStage
(Python 3.12, in the `python-narration` folder beside the program: Kokoro does not run on the newer Python the other tools use). Every file it downloads is checked
before it is used: each Python package against its SHA-256 in `tools/narration-requirements.txt`, and each file of the voice model against `tools/kokoro-model.json`,
which names one fixed version of the model. A file that does not match is refused and the install stops. Once installed, the voice works offline and never
looks online for a newer model. A voice installed by an earlier version of OpenStage Author (before 2026-11-13) has to be installed again: the section says so,
and installing again replaces it. Audio already made for your courses is kept. **Remove the narration voice...** takes it away again and frees the room. If you have named your own
engine (below), the editor leaves yours alone and offers neither button. Run from the source folder (not installed) there is no Python of its own to install with, and the section says so.

If a step of the install stops, the message says what it printed last and where all of it is: `install-log.txt`, in the same folder. Send that file when asking for help. Nothing is built on your computer (every Python package comes already built; the one that PyPI publishes only as source, docopt, comes with OpenStage in its tools folder), so a stop is almost always the network, a program that blocks downloads, or too little room on the drive.

If the computer does not have Microsoft's Visual C++ runtime (a Windows that has only just been installed may not), the section says so and has a button, **Get Microsoft's Visual C++ runtime...**, that opens Microsoft's own download page. Install that, then press **Install the narration voice**.

Where the editor offers it without being asked: after speaker notes are brought in from a PowerPoint deck (the last screen says the course is silent until the voice is installed and goes on to the Narration window), and whenever the Narration window opens with words that have no sound and nothing that could make it, the **Install the narration voice** button has the keyboard.

## How OpenStage finds one you set up yourself

The editor and the `.bat` files look for an environment variable, `OPENSTAGE_KOKORO_PYTHON`: the full path of a `python.exe` that has Kokoro installed.
The easy way to set it is a small file next to `OPEN EDITOR.bat` called `local-settings.bat`:

1. Copy `local-settings.example.bat` to `local-settings.bat` (the same folder).
2. Take the `REM` off the `OPENSTAGE_KOKORO_PYTHON` line and put in the path of your Python.
3. Open the editor with `OPEN EDITOR.bat`.

`local-settings.bat` is ignored by git, so it is never uploaded. Setting `OPENSTAGE_KOKORO_PYTHON` as an ordinary Windows environment variable works too.

## What to install in that Python

This is what is on the computer where narration works today, written down so it can be repeated. **A fresh install from this list has not been tried**, and
installing it downloads a lot (PyTorch alone is hundreds of megabytes, and the voice model, a few hundred more, is fetched the first time a voice is used).

* Python 3.12 (Kokoro 0.9.4 and misaki 0.9.4 do not install on 3.13 or later).
* `kokoro` 0.9.4, with `misaki` 0.9.4, `torch` 2.15.0, `transformers` 5.23.0, `huggingface_hub`, `numpy`, `soundfile`, `loguru`. Use torch 2.6.0 or later:
  older ones can be made to run code by a crafted model file. `tools/narration-requirements.txt` is the whole tried list, with hashes; installing it with
  `pip install --require-hashes --only-binary :all: --find-links tools -r tools/narration-requirements.txt` gives the same set the button installs.
* For English, `spacy` and `num2words`; Kokoro's English speech also uses `phonemizer-fork` and `espeakng-loader`, which is where the GPL parts come in.
* Other languages Kokoro speaks (Spanish, French, Hindi, Italian, Portuguese) use `espeak-ng` for everything. Japanese and Chinese need `misaki[ja]` and `misaki[zh]`.

Check it by running `python -c "import kokoro"` with that Python: if it prints nothing, Kokoro can be loaded.

## If it is not set up

The editor says so where it matters (the Narration dialog, the voice list) and publishes anyway, with transcripts and captions and no new audio. Audio that
was already made is reused.

## Moving to newer packages or a newer model (for whoever looks after OpenStage)

The packages and the model are fixed on purpose, so nothing changes under an author without being tried first.

* **Packages.** Change `tools/narration-wants.txt` (what is asked for), then lock it with the voice's own Python, the one the installer carries (unpack the
  3.12 embeddable Python into a scratch folder and put pip in it, as `tools/build_installer.py` does):
  `python tools/lock_python_packages.py --python <that python.exe> --wants tools/narration-wants.txt --out <new list> --find-links tools`.
  Install the new list into a scratch folder with the same pip command the button uses, check that `tools/narrate.py` speaks with it, then put the new list
  in `tools/narration-requirements.txt` with its heading. The tools' own Python (`tools/python-wants.txt`) and pip for the voice's Python
  (`tools/narration-python-wants.txt`) are locked the same way, with the Python each goes into.
* **The model.** `tools/kokoro-model.json` names one commit of the model's repository and the size and SHA-256 of every file the voice uses. To move to a newer
  commit, take the hashes the repository lists for that commit (the model and the voices are stored there with their SHA-256), work out the SHA-256 of
  `config.json` from the file, check that the voices are still the ones in `tools/kokoro-voices.json`, and write the new list. `tools/kokoro_model.py --check`
  checks a model that is already fetched, without the network.
