# Voices, pictures and sounds from an AI service

OpenStage Author can make narration audio, pictures and sound effects with a service you have your own key for, and
can use other speech models through plugins (docs/plugins.md). It is off until you set it up. Nothing is sent anywhere
until you add a key **and** say yes to that service. The built-in voices (Kokoro) keep working on your computer exactly as
before, with no key and no internet.

This was built from the services' own documentation (checked 2026-10-14) and tested with stand-ins that answer the way the
documentation says they do. **It has not yet been tried with a live key.** The first real picture or voice is the real
test; if a service has changed something, the message will say what it said.

## What it can make

| Service | Voices | Pictures | Sound effects |
| --- | --- | --- | --- |
| OpenAI | its ready-made voices, in many languages | yes (a GPT image model) | no |
| ElevenLabs | the ready-made voices on your account | no | yes (up to 30 seconds) |
| A plugin you install | the voices it lists | no | no |

Midjourney is not here: it has no official programming interface.

**Voices are always ready-made.** OpenStage never makes a voice from a recording of a person. OpenAI voices made from a
sample, and ElevenLabs voices that are cloned, designed or professionally made, are not offered, and a plugin has no way to be
handed a recording (voice cloning is out of scope, CLAUDE.md).

## Setting it up

1. Choose **AI services** on the toolbar.
2. For a service, paste your key. Each service has a page where you sign up and copy it (the **Get a key** button). You pay the
   service for what you make; OpenStage does not charge anything and cannot see what it costs.
3. Tick **Allow OpenStage to send ...**. This is your yes. Until it is ticked, nothing is sent. (If you first try to make something
   with a service you have not said yes to, a question asks you the same thing, once.)
4. **Check the key** asks the service whether it accepts the key (it costs nothing). For ElevenLabs, **Get my voices** lists the ready-made
   voices on your account so they can be chosen.
5. **Save.**

Your keys are kept in OpenStage's own settings on your computer, with your stock-library keys. **They are never saved in a project**, so
sharing a project never shares a key. Changing a key takes back your yes for that service, because a different key may be a different
account; tick the box again.

## Voices

Once a service is set up, its voices are in the **Voice** list of an object's Narration section, under their own heading
("OpenAI, over the internet"). Under the list, a note says where the voice is made. Then:

- **Make the audio** from the **Narration** dialog, as always. Its first lines say, for each engine, where the audio will be made and whether
  anything is sent. Before the words of a script are sent to a service for the first time you are asked, and the question says how many
  narrations and characters. The scripts are sent; nothing else from your course is.
- **Language.** A voice that speaks many languages has a **Language of the script** box. It starts at the course's language.
- **Pronunciations** cannot be taught to these voices. If one says a word wrongly, spell the word as it sounds in the script. The captions show
  your spelling. Pronunciations you wrote for another voice stay in the file and are ignored.
- **Speed.** ElevenLabs holds the speed between 0.7 and 1.2.
- **Captions** are still made from your script. The services do not say when each word is spoken, so the caption times are estimated from
  the length of each sentence, and are not as exact as Kokoro's.
- **Previewing and publishing never send anything.** They use audio that is already made. A narration with no audio yet is published without
  audio, as when no speech engine is set up. Make the audio first.

## Pictures and sounds

**Assets**, then the **Make with AI** tab. Describe what you want, choose the shape and quality of a picture (or the length of a sound), and
choose **Make**. It can take up to a minute, and you can cancel. Each time you choose it, the service charges your account.

- The file is saved in your project at once, with a credit that says an AI service made it, the model, the words you gave and the time. The
  words are kept for you; learners are not shown them.
- **You still write the alt text.** OpenStage never writes it from the description, because the picture may not be what you asked for. The
  editor offers your words as a place to start, after you insert it.
- A picture can contain readable text. If it does, the alt text has to say what it says.
- A sound needs captions or a transcript like any other.

## Telling listeners

A picture, a sound or a voice made by an AI service is listed on the course's **credits page** ("Title, made with OpenAI (gpt-image-1)"), and
the narration is listed too ("Narration, made with OpenAI. Synthetic voices from an AI service, not a person."). OpenAI's rules ask that
listeners are told a voice is AI-made. If the credits page is off, the editor and the checker both warn (`credit-page-off`,
`voice-credit-page-off`). The Kokoro voices are listed as synthetic as well.

## What is sent, exactly

| Making | Sent to the service |
| --- | --- |
| A voice | the script of each narration being made, the voice name, the speed, and your key |
| A picture | the description, the shape, the quality, and your key |
| A sound | the description, the length, and your key |
| Checking a key, or getting voices | your key |

Nothing else: no slide, no image, no other part of your course, and nothing about you. The services have their own terms and privacy
rules for what they receive. Requests go straight from your computer to the service, only to its own address (`api.openai.com`,
`api.elevenlabs.io`). Errors from a service are shown in plain words, and a key is never shown in one.

## Models

A service changes the names of its models from time to time. **AI services** has a **models (advanced)** box for each: leave it empty to use
what OpenStage uses (a recent OpenAI speech model and image model, and ElevenLabs' multilingual model), or type a new name if one stops
working. The model that made a picture is recorded with it.

## For developers: the command line

The editor does none of this itself. It asks two Python tools, which are the only code that talks to a service, so there is one place that
checks permission and one place that handles a key. Both need only the standard library.

```
python tools/narrate.py PROJECT [--only ID,ID] [--cache-root DIR]
                        [--allow-network openai,elevenlabs] [--plugins-dir DIR] [--plugins-enabled ID,ID]
python tools/generate.py plugins|check|voices|picture|sound [same options]      (a JSON request on standard input)
```

- A voice of a service is made only if its service is in `--allow-network` **and** its key is in the environment
  (`OPENSTAGE_KEY_OPENAI`, `OPENSTAGE_KEY_ELEVENLABS`). Without `--allow-network` only Kokoro is used. That is what Publish does.
- `OPENSTAGE_MODEL_<SERVICE>_<KIND>` (`SPEECH`, `PICTURE`) names a model.
- If an engine fails, the others are still tried, the rest of that engine's narrations are not (a wrong key is not tried again and
  again), and `narrate.py` prints a `NOT MADE:` line for each and exits with 1. Audio that was made is kept.
- The editor's desktop shell (`editor/src-tauri/src/lib.rs`) reads the keys and the yes from the settings file, hands a tool only the keys
  of services that have both, in environment variables (never on a command line), and checks what comes back (is it a PNG, is it an
  MP3, is it a sensible size) before saving it in the project.
- Tests: `python tools/test_engines.py` (no internet: the services are stand-ins and the plugin tests run the example plugin for real),
  `editor/src/aiservices.test.ts`, `player/src/credits.test.ts`, and the Rust tests in `lib.rs`.

## What is not built

- Other services. Adding one is a new module beside `tools/engines/openai_engine.py` and an entry in `editor/src/aiservices.ts`.
- Picture and sound plugins. The plugin contract (docs/plugins.md) is for voices only; the `picture` and `sound` jobs are reserved.
- Choosing a voice by listening to a sample, and showing what a service has charged.
- Using a service from the command line in a way that asks for permission; the command line trusts its options.
