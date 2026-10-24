# Setting up narration (the Kokoro speech engine)

Spoken narration in a course is made by **Kokoro**, a speech model that runs on your own computer. It is not part of OpenStage Author and is not installed
with it. Without it everything else works: a course has transcripts and captions, and a narration made with an online voice (OpenAI) or a voice plugin does
not need Kokoro at all.

Why it is separate: Kokoro itself and its model are Apache-2.0, but the usual way of installing it also installs `phonemizer-fork` and `espeak-ng`, which are
under the GNU General Public License. OpenStage Author is Apache-2.0 and does not include, bundle or host them; the editor only runs the engine as a separate
program that you installed. The reasons, and the choices open about it, are in `docs/decisions/0004-packaging-and-narration.md`.

## The easy way: a button

In an installed OpenStage Author, open **Narration** (the button in the toolbar). The section "Narration voice on this computer" has **Install the narration voice...**. It asks first: what is
downloaded (about 670 MB, from pypi.org and huggingface.co), how much room it takes (2.1 GB, and about 1.5 GB more free on the same drive while it installs), that parts of it are GPL, and that nothing from your courses is sent. Then it installs into OpenStage's own
folder (`%LOCALAPPDATA%\com.openstageauthor.editor\narration-engine`), a step at a time, with Cancel. **Remove the narration voice...** takes it away again and frees the room. If you have named your own
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

* Python 3.11 (the version that works; others have not been tried).
* `kokoro` 0.9.4, with `misaki` 0.9.4, `torch` 2.5.1, `transformers` 4.57.1, `huggingface_hub`, `numpy`, `soundfile`, `loguru`.
* For English, `spacy` and `num2words`; Kokoro's English speech also uses `phonemizer-fork` and `espeakng-loader`, which is where the GPL parts come in.
* Other languages Kokoro speaks (Spanish, French, Hindi, Italian, Portuguese) use `espeak-ng` for everything. Japanese and Chinese need `misaki[ja]` and `misaki[zh]`.

Check it by running `python -c "import kokoro"` with that Python: if it prints nothing, Kokoro can be loaded.

## If it is not set up

The editor says so where it matters (the Narration dialog, the voice list) and publishes anyway, with transcripts and captions and no new audio. Audio that
was already made is reused.
