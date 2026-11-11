# Voices and pictures from an AI service

OpenStage Author can make narration audio and pictures with OpenAI, using a key of your own, and can use other speech models
through plugins (docs/plugins.md). It is off until you set it up. Nothing is sent anywhere until you add a key **and** say yes.
The built-in voices (Kokoro) keep working on your computer exactly as before, with no key and no internet.

This was built from OpenAI's own documentation (checked 2026-10-14) and tested with stand-ins that answer the way the documentation
says they do. **It was then tried with a real key on 2026-10-14**, with TEST AI SERVICES.bat (below): the key was accepted, and OpenAI made
a voice and a picture. The author listened to and looked at what was made. The voice side has also been used from the editor window of the
desktop app: an OpenAI voice was chosen for a narration, its audio was made from the **Narration** dialog, and it was heard in a preview.
**Not yet confirmed:** making a picture from the editor window. If OpenAI changes something, its message will say what it said.

ElevenLabs (voices and sound effects) was built and tried the same day, then taken out at the author's request, because OpenAI is enough
for now. It is in the history of the project (the commits `2e403f2` and `c3f8abd`; the engine was `tools/engines/elevenlabs_engine.py`) if it is
wanted again. A settings file or a project that still mentions it is read without trouble: its key and permission are ignored, and a voice named
`elevenlabs:...` is simply unavailable.

## Trying it with your key

Double-click **TEST AI SERVICES.bat** (`tools/live_test.py`). It asks before it sends anything, says what it sends and that it costs a small
amount, and never shows or saves your key (it can use `OPENSTAGE_KEY_OPENAI` if you set it, or you paste the secret key and see a `*` for each
character, so you can tell the paste worked). It looks at what you pasted before sending it: a key has no spaces, is long, and starts `sk-`, and it
asks again if what you pasted cannot be one. If OpenAI does not accept the key, the rest is not tried. Free checks run first: that publishing sends
nothing even when a key is present, and that the example voice plugin works. Then, if you say yes: the key is accepted, a short line of speech is
made with captions, and a small low-quality picture is made. It uses the code the editor uses. What it made is kept in `dist/live-test` (play it
and look at it), with `live-test-results.txt`, which has no key in it. If a step fails, send that file back.

## What it can make

| Service | Voices | Pictures |
| --- | --- | --- |
| OpenAI | its 13 ready-made voices, in many languages | yes (a GPT image model) |
| A plugin you install | the voices it lists | no |

Midjourney is not here: it has no official programming interface.

**Voices are always ready-made.** OpenStage never makes a voice from a recording of a person. OpenAI voices made from a sample are not
offered, and a plugin has no way to be handed a recording (voice cloning is out of scope, CLAUDE.md).

## Setting it up

1. Choose **AI services...** in the **Tools** menu.
2. Paste your OpenAI key. The **Get your OpenAI key** button opens the page where you sign up and copy it. The key is from OpenAI's developer
   platform, billed separately from a ChatGPT subscription. You pay OpenAI for what you make; OpenStage does not charge anything and cannot
   see what it costs.
3. Tick **Allow OpenStage to send OpenAI ...**. This is your yes. Until it is ticked, nothing is sent. (If you first try to make something
   before saying yes, a question asks you the same thing, once.)
4. **Check the key** asks OpenAI whether it accepts the key (it costs nothing).
5. **Save.**

Your key is kept in OpenStage's own settings on your computer, with your stock-library keys. **It is never saved in a project**, so sharing a
project never shares a key. Changing the key takes back your yes, because a different key may be a different account; tick the box again.

## Voices

Once OpenAI is set up, its voices are in the **Voice** list of an object's Narration section, under "OpenAI, over the internet". Under the list,
a note says where the voice is made. Then:

- **Hear the voice first.** The **Hear this voice** button under the Voice list plays a short sample, one fixed sentence in the voice (never any of your
  words). Press it again while the sample is being made to cancel, or while it plays to stop. The first time costs a few seconds, and for an OpenAI voice
  one short sentence goes to OpenAI and OpenAI may charge your account for it. The sample is then **kept on this computer** (in OpenStage's own cache
  folder, `%LOCALAPPDATA%\com.openstageauthor.editor\voice-samples`, never in a project), so hearing the same voice again sends nothing and costs nothing.
  A new sample is made when the voice, its language, the model (or the plugin's version) changes. The folder is only a convenience and can be emptied at any time.
- **Make the audio** from the **Narration** dialog, as always. Its first lines say, for each engine, where the audio will be made and whether
  anything is sent. Before the words of a script are sent for the first time you are asked, and the question says how many narrations and
  characters. The scripts are sent; nothing else from your course is.
- **Language.** A voice that speaks many languages has a **Language of the script** box. It starts at the course's language. OpenAI makes
  the same sound whatever it says. The language is part of what names the audio, so a new language is a new name; so that nothing is paid for twice, the editor keeps the audio you already have under the new name (a copy,
  made on this computer; "The audio you already had is kept for the new language..."), and the audio is ready at once. This is only done for OpenAI's voices. A voice from a plugin is told the language and may sound
  different, so changing its language makes the audio again.
- **Pronunciations** cannot be taught to these voices. If one says a word wrongly, spell the word as it sounds in the script. The captions show
  your spelling. Pronunciations you wrote for another voice stay in the file and are ignored.
- **Captions** are still made from your script. OpenAI does not say when each word is spoken, so the caption times are estimated from the
  length of each sentence, and are not as exact as Kokoro's.
- **Previewing and publishing never send anything.** They use audio that is already made. A narration with no audio yet is published without
  audio, as when no speech engine is set up. Make the audio first.
- **The preview plays every narrated object on a slide, one after another in reading order**, each in its own voice. Move an object in the
  Objects list to change when its narration plays.

## Pictures

**Assets**, then the **Make with AI** tab. Describe the picture, choose its shape and quality, and choose **Make the picture**. It can take up
to a minute, and you can cancel. Each time you choose it, OpenAI charges your account.

- The file is saved in your project at once, with a credit that says an AI service made it, the model, the words you gave and the time. The
  words are kept for you; learners are not shown them.
- **The picture is a compressed WebP** (OpenAI is asked for that, at 85 out of 100), about a tenth the size of the PNG it would send otherwise, so a
  course stays small. Every current browser shows it.
- **You still write the alt text.** OpenStage never writes it from the description, because the picture may not be what you asked for. The
  editor offers your words as a place to start, after you insert it.
- A picture can contain readable text. If it does, the alt text has to say what it says.

## Telling listeners

A picture made by an AI service is listed on the course's **credits page** ("Title, made with OpenAI (gpt-image-1)"), and the narration is
listed too ("Narration, made with OpenAI. Synthetic voices from an AI service, not a person."). OpenAI's rules ask that listeners are told a voice
is AI-made. If the credits page is off, the editor and the checker both warn (`credit-page-off`, `voice-credit-page-off`). The Kokoro voices are
listed as synthetic as well.

## Charges are yours to check

When you use an AI service with your own key, **you** are the customer and the service charges **your** account. OpenStage cannot see what you are charged and cannot
limit it, and it does not try to guess: any figure it showed could be wrong or out of date. So always check your charges on the service's own account page, and set
a spending limit there if it offers one. That is the author's job, not the software's. The editor says so where it matters: in **AI services**, in the question asked
before anything is sent, and under **Make the picture**.

## What is sent, exactly

| Making | Sent to OpenAI |
| --- | --- |
| A voice | the script of each narration being made, the voice name, the speed, and your key |
| A picture | the description, the shape, the quality, and your key |
| Hearing a voice (the first time only) | one fixed sample sentence, the voice name, and your key; none of your words |
| Checking the key | your key |

Nothing else: no slide, no image, no other part of your course, and nothing about you. OpenAI has its own terms and privacy rules for what it
receives. Requests go straight from your computer to OpenAI, only to its own address (`api.openai.com`). Errors are shown in plain words, and a
key is never shown in one.

## Models

OpenAI changes the names of its models from time to time. **AI services** has a **models (advanced)** box: leave it empty to use what
OpenStage uses (a recent speech model and image model), or type a new name if one stops working. The model that made a picture is recorded with it.

## For developers: the command line

The editor does none of this itself. It asks Python tools (`narrate.py`, `generate.py` and `voice_sample.py`), which are the only code that talks to a service, so there is one place that
checks permission and one place that handles a key. Both need only the standard library.

```
python tools/narrate.py PROJECT [--only ID,ID] [--cache-root DIR]
                        [--allow-network openai] [--plugins-dir DIR] [--plugins-enabled ID,ID]
python tools/generate.py plugins|check|picture [same options]      (a JSON request on standard input)
python tools/voice_sample.py --cache-dir DIR [same options]         ({"voice": "...", "lang": "..."} on standard input)
```

- A voice of a service is made only if its service is in `--allow-network` **and** its key is in the environment
  (`OPENSTAGE_KEY_OPENAI`). Without `--allow-network` only Kokoro is used. That is what Publish does.
- `OPENSTAGE_MODEL_<SERVICE>_<KIND>` (`SPEECH`, `PICTURE`) names a model.
- If an engine fails, the others are still tried, the rest of that engine's narrations are not (a wrong key is not tried again and
  again), and `narrate.py` prints a `NOT MADE:` line for each and exits with 1. Audio that was made is kept.
- The editor's desktop shell (`editor/src-tauri/src/lib.rs`) reads the key and the yes from the settings file, hands a tool only the key of a
  service that has both, in an environment variable (never on a command line), and checks what comes back (is it a real WebP, is it a sensible size)
  before saving it in the project.
- Tests: `python tools/test_engines.py` (no internet: the service is a stand-in and the plugin tests run the example plugin for real),
  `editor/src/aiservices.test.ts`, `player/src/credits.test.ts`, and the Rust tests in `lib.rs`.

## What is not built

- Other services. Adding one is a new module beside `tools/engines/openai_engine.py` and an entry in `editor/src/aiservices.ts`.
- Sound effects, and picture and sound plugins. The plugin contract (docs/plugins.md) is for voices only; the `picture` and `sound` jobs are reserved.
- Showing what a service has charged (on purpose: the software cannot see it, so it tells you to check your own account).
- Using a service from the command line in a way that asks for permission; the command line trusts its options.
