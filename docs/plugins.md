# Voice plugins (contract 1)

A voice plugin gives OpenStage Author another speech model: Piper, XTTS, a cloud voice you have an account with, anything that can turn text into
a WAV file. It is a small program in a folder of its own. This page is for the person who writes one, and for the author who wants to know what a
plugin can do.

The contract covers **voices only**. CLAUDE.md names three plugin contracts (audio from text, captions from media, image from prompt); this is the
first of them. The `picture` and `sound` jobs are reserved for later and a contract-1 plugin must say `"kinds": ["voice"]`.

## For an author

- A plugin is a folder you copy into the plugins folder (**AI services**, then **Open the plugins folder**). It does nothing until you switch it
  on in **AI services**.
- **A plugin is a program, and it runs as you.** It can read your files and use your internet connection. Switch on only plugins you trust.
- A plugin is never part of a project, so a project you are sent cannot bring one, and sharing yours does not share the plugin. A narration that uses
  a plugin's voice needs the plugin on the computer that makes the audio. Audio that is already made plays anywhere.
- A plugin says whether it uses the internet (`"network"`). That is its author's word and OpenStage cannot check it. It is shown beside the plugin.
- A plugin has a fixed list of voices. There is no way to give it a recording to copy.

## The folder

```
my-plugin/
  plugin.json        what it is (below)
  ...                whatever the program needs
```

```json
{
  "contract": 1,
  "id": "my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "licence": "MIT",
  "network": false,
  "description": "One sentence for the author.",
  "kinds": ["voice"],
  "command": ["{python}", "voice.py"],
  "pronunciations": false,
  "wordTimings": false,
  "voices": [
    { "id": "narrator", "name": "Narrator", "lang": "en-US", "description": "A calm voice." }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `contract` | `1`. A plugin for another contract is not used. |
| `id` | 2 to 31 lowercase letters, digits and hyphens, starting with a letter. Not `kokoro`, `openai` or `elevenlabs`. A voice is `my-plugin:narrator` in a project. |
| `name`, `licence` | Shown to the author. The licence is required. |
| `network` | `true` if the plugin sends the text over the internet. Required. |
| `kinds` | `["voice"]`. |
| `command` | The program and its arguments, run in the plugin's folder. The first part is `{python}` (the Python that runs the tool), `{env:NAME}` (the program named by an environment variable, for a model that lives in its own Python), a name found on the PATH, or a path inside the plugin's folder. Not an absolute path and not `..`. |
| `pronunciations` | `true` if the plugin can use the IPA pronunciations a narration carries. Most cannot. |
| `wordTimings` | `true` if the plugin reports when each word is spoken, so captions are exact. |
| `voices` | The fixed list. Each has an `id` (letters, digits, `.`, `_`, `-`), a `name`, and a `lang` such as `en-US` (or `null` for a voice that speaks many languages, so the author says which). The list is in the file, so nothing has to run to show it. |

## The conversation

OpenStage starts the program once for a run and talks to it one line of JSON at a time, as the Capture recorder does. It writes a request to the
program's standard input; the program answers on its standard output with one line of JSON, and exits when its input closes. Several narrations in
one run use the same process, so a model loads once.

Request:

```json
{"contract": 1, "op": "speak", "text": "Welcome to the course.", "voice": "narrator", "speed": 1.0, "lang": "en-US", "out": "C:\\Users\\...\\speech.wav"}
```

Answer, when it worked:

```json
{"ok": true, "duration": 2.4, "words": [{"text": "Welcome", "start": 0.0, "end": 0.5}]}
```

Answer, when it did not (the message is shown to the author, so write it for them):

```json
{"ok": false, "message": "The model file is missing. Run setup.bat in the plugin's folder."}
```

- `out` is a path the program writes a WAV file to (16-bit PCM, one or two channels, any sample rate). OpenStage checks it is a WAV file.
- `words` is read only if the manifest says `wordTimings`. Each `text` must be the word as it is in the script, in order; if the words do not line up with the
  script the times are not trusted and the captions are timed by estimate.
- `speed` is the author's number (0.5 to 2). A plugin that cannot do it should do its nearest.
- A line the program prints that does not begin with `{` is ignored, so progress and log lines are harmless. Standard error is kept for the
  message if the program stops.
- A request has no time limit short of 30 minutes. The author can cancel at any time and the whole process tree is stopped.
- One request at a time. The next is sent after the answer.

## Try it

`examples/plugins/tone-voice` is a complete plugin that beeps once for each word. Copy its folder into the plugins folder, switch it on, and choose
one of its voices for a narration. It is about forty lines (`voice.py`) and is what the tests run.

## What the format records

Nothing about the plugin is in the project except the voice name (`my-plugin:narrator`). See docs/format-spec.md, "Voices".
