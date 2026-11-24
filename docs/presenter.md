# Presenter clips (the OpenStage Presenter add-on)

A **presenter** is an illustrated person who speaks a slide's narration, made into a video you put on the slide. It comes from the **OpenStage Presenter**
add-on, a separate and optional download (`presenter/` in this repository), so the editor stays small for people who never use it. The specification it is built
from is `docs/avatar-addon-spec.md`; this page says what the first version does, how it works, and what it does not do yet. The published course plays a
presenter clip as an ordinary video with captions, so a learner needs nothing extra.

## For an author

With the add-on installed, **Insert > Presenter...** opens a dialog. (Without it, the item is not there.)

1. **The words to speak** are the narration of a text on the slide. Write the narration first (Narration menu, Narration...). The voice, the speed and the
   language are the ones that narration has; change them in Narration.
2. **Who speaks:** one of four illustrated presenters, each described in words (Guide, Coach, Professor, Mentor).
3. **The shape of the picture:** a square, a square with rounded corners, or a circle. This is the object's own rounding, so you can change it on the slide.
4. **The "AI presenter" label** in the corner of the clip is on unless you turn it off for the clip.
5. **Alt text** starts from the presenter described in words. It is yours to change.
6. Press **Make the clip**. The editor makes the speech if it is not made yet, listens to it to find the mouth shapes, draws the presenter and encodes the clip, saves it,
   writes captions from the words, timed from the voice, and puts it on the slide. The text it spoke stops speaking, so the words are not said twice. One undo step takes all of it back.

**It is quick:** the window encodes the picture and the sound as fast as the computer can, so a minute of speech takes a few seconds, and it does not matter whether the editor window
is in front. A window that has no encoders (the dialog says so) records in real time instead: then it takes as long as the speech does, and **the editor window has to stay in front**,
because a window nobody can see is drawn more slowly and the clip would stutter. Escape stops it either way.

**The captions** are timed from the narration's own timing: the speech engine says when each sentence is spoken, from its first word to its last, and keeps that with the audio, so each
caption comes in when its words are spoken. A long sentence is cut into captions of two lines at most, by their length, inside the time it is spoken. They are not marked as unchecked
when the engine timed them from the words. A voice that gives no word times (some online voices) gives estimated times by sentence, and then the captions are marked as not yet checked,
as everywhere else in the editor: play the clip and check them in Write captions.

**Making it again.** Choose a presenter clip and open **Insert > Presenter...**. The dialog says whether the clip is up to date or **out of date** (the narration, the
presenter, the shape or the label has changed since it was made) and offers **Make the clip again**: the same object, in the same place, with the same alt text, and a new
file. It can write new captions from the words too (the old captions file is kept).

**What it does not do (yet).** A presenter made from a photo and a voice of your own are not in this version (`ROADMAP.md`). **The mouth** follows the words when the speech engine kept them: Kokoro keeps each word it speaks with the sounds (phonemes) it said it with, in the narration's cache, and, since add-on 0.3.0, the length of
every sound too (Kokoro predicts it, and makes the audio from it), so a clip made from audio made since then has lips together for an "m", the upper teeth on the lower lip for an "f" and pushed-forward lips for an "oo",
each when the voice said it. Audio made before the sounds were kept has the words only, and the mouth shares each word's time among its sounds by weight, which puts a sound in the wrong picture about four times in ten; and voices that give no phonemes (the online
voices, a plugin's), follow the sound instead (how loud, and how high-pitched), which is a good likeness of talking and not of any particular word. The dialog says which it is going to
do. To time every sound, make the narration audio again with Kokoro: audio that is already made is reused, so delete the project's `.cache\narration` folder first.

**Telling learners.** The clip is credited in `assets.json` as made by a program, so when the credits page is on it says that a program made the presenter and that the voice is
synthetic (the validator warns when it is not credited, or when the credits page is off). The small label is part of the picture, so a screen reader does not read it; the alt
text and the credits page are what say it in words.

**Keyboard and screen reader.** The dialog is a native dialog like the others: focus moves in, Tab stays inside, Escape closes it (and while a clip is being made, the first
Escape stops the making). The presenters and the shapes are real radio buttons in labelled groups; what is happening is said in a status line a screen reader reads, at each quarter
of the way. It has been driven by keyboard in a real browser; it has not yet been tried with NVDA or VoiceOver (`TESTING-TODO.md`).

## Where things are

| What | Where |
| --- | --- |
| The add-on (a program, `openstage-presenter.exe`, and `addon.json`) | `presenter/` (Rust; its README says how to build it) |
| Installing it for development | `presenter/INSTALL FOR DEVELOPMENT.bat`, then `presenter/OPEN EDITOR WITH PRESENTER.bat` |
| The editor's side of the contract (finding it, asking it, saving the clip) | `editor/src-tauri/src/presenter.rs` |
| Drawing the presenter and making the clip | `editor/src/presenter/` (`draw.ts` draws; `fast.ts` and `webmwriter.ts` encode and write the file; `clip.ts` chooses the way and has the real-time recorder; `webm.ts` writes a recorded file's length; `cues.ts` times the captions) |
| The dialog | `editor/src/presenterdialog.ts` |
| What a clip is in a project | `docs/format-spec.md`, "Presenter clips" (format 0.52.0) |

## The add-on contract (contract 1)

### The folder

An add-on is a folder in the add-ons folder: `%LOCALAPPDATA%\OpenStage\addons\<folder>\` on Windows (`~/Library/Application Support/OpenStage/addons` on a Mac,
`$XDG_DATA_HOME/OpenStage/addons` or `~/.local/share/OpenStage/addons` elsewhere; in a developer's build, `OPENSTAGE_ADDONS` names another place). It holds an `addon.json`, the program and, once it is signed, `addon.sig`.

```json
{
  "contract": 1,
  "id": "presenter",
  "name": "OpenStage Presenter",
  "version": "0.3.0",
  "licence": "Apache-2.0",
  "description": "Illustrated presenters that speak a slide's narration, made into a video you put on the slide.",
  "formatMin": "0.52.0",
  "host": "openstage-presenter.exe",
  "commands": ["presenter.hello", "presenter.check", "presenter.presenters", "presenter.mouthTrack"],
  "tiers": ["lite"],
  "signature": null
}
```

| Field | Meaning |
| --- | --- |
| `contract` | `1`. Anything else is not used. |
| `id`, `name`, `version`, `licence` | The id is 2 to 31 lowercase letters, digits and hyphens, starting with a letter; the Presenter add-on is `presenter`. The version is three numbers. The licence is required. |
| `host` | The program, as a path inside the add-on's own folder. A path with `..`, a drive, or an absolute path is refused, and the file has to be there. |
| `commands` | What the program answers: any of the four below. The editor asks only for what is listed. |
| `tiers` | `lite`, `standard`, `studio` (the kinds of presenter the add-on can make). |
| `signature` | Not used. The signature is a file of its own, `addon.sig`, so that it can cover this manifest (see "Signing"). |

The manifest is read only if it is a file of 64 KB or less, and one that is not whole is passed over without a word (the editor never half uses an add-on).

### Who may use it, and signing

The spec has the editor show the Presenter command only for "a valid, signed manifest". The editor checks that, and an add-on is usable when **its signature verifies**.

**What is signed.** `addon.sig` holds an Ed25519 signature, written as base64, over these three lines of text (each ends with a line feed):

```
OpenStage add-on 1
<SHA-256 of addon.json, as lowercase hex>
<SHA-256 of the engine host program named by "host", as lowercase hex>
```

So changing one byte of the manifest or of the program, or putting a signature made for another add-on beside this one, makes it unusable. The editor reads the manifest once and checks and uses those same bytes, and it checks again each time it asks the add-on something.

**The key.** The public key is built into the editor (`ADDON_PUBLIC_KEY` in `editor/src-tauri/src/presenter.rs`). It is empty until the owner makes a key pair, offline, and gives the editor only the public half; the private half never comes into this repository or any build folder. **With no key built in, no add-on can verify, so none is usable in an editor made for other people**, which is why the Presenter add-on stays developer-only.

**Going back.** The editor writes the highest version of each signed add-on it has used in `last-used.json` in the add-ons folder, and does not use a signed version lower than that, so an old version with a known fault cannot be put back. To go back on purpose, delete that file.

**The developer route.** An editor built with the `dev-addons` feature (and any debug build) also reads `OPENSTAGE_DEV_ADDONS=1`, which lets an add-on that is not signed run, and `OPENSTAGE_ADDONS`, which names another add-ons folder. `OPEN EDITOR.bat` builds the editor on the owner's own computer with that feature and `presenter/OPEN EDITOR WITH PRESENTER.bat` sets the first one for one session. The installer's build never has the feature, so a setup made for other people ignores both settings. (`tools/test_build_installer.py` fails if the installer asks for it.)

What is left to the owner before any add-on is released: make the key pair, give the editor the public key, and sign each add-on release (`addon.sig`). A small program to sign with is not written yet.

### The messages

The editor starts the program, writes **one request line** on its standard input, and reads **lines** from its standard output until it ends. A request, and what comes back:

```
{"id": 1, "command": "presenter.check", "params": {}}
{"id": 1, "event": "progress", "message": "..."}                 (none or more; not used yet)
{"id": 1, "result": {...}}      or      {"id": 1, "error": {"code": "...", "message": "A sentence for the author."}}
```

One request, then the program ends, so a crash or a slow job never takes the editor down. Limits: the program may say 16 MB at most, and is stopped if it does not answer in time
(20 seconds, or 120 for the mouth track). What it writes on its standard error is shown only when it gave no answer. Only the answer with the request's own `id` counts.

| Command | Params | Result |
| --- | --- | --- |
| `presenter.hello` | none | `{ "name", "version", "protocol": 1, "tiers": [...] }` |
| `presenter.check` | none | `{ "os", "cpuThreads", "memoryMb", "diskFreeMb", "cuda", "gpus": [{ "name", "vendor", "dedicatedMb", "software" }], "capable": { "why" }, "tiers": [{ "id", "offered", "capable", "default", "reason" }] }`: the graphics cards (through DXGI), the memory, the free space where models are kept, whether an NVIDIA card can run CUDA, which kinds the computer is capable of (the specification's table: no card of its own and under 8 GB is Lite only; integrated graphics and 8 GB or more adds a slow Standard; a card with 4 to 6 GB makes Standard the default; an NVIDIA card with 8 GB or more adds Studio), and which are offered, which also needs the kind's engine installed, and why one is not |
| `presenter.presenters` | none | `{ "presenters": [{ "id", "name", "tier": "lite", "description", "look": { "skin", "hair": { "style": "short" or "curly" or "long", "color" }, "shirt", "background", "glasses", "eyes" } }] }`. The editor draws each presenter from its `look`, so a new presenter is a new entry and nothing in the editor changes. |
| `presenter.mouthTrack` | `{ "wav": path, "fps": 25, "words": [{ "start", "end", "phonemes", "times" }] }`. The words are optional: each with when it began and ended in seconds and the phonemes it was said with, and optionally `times`, a `[start, end]` pair in seconds for each character of its phonemes (when each sound began and ended, as the speech engine said). Times that do not fit (the wrong number, out of order, not numbers) are ignored and the word is timed by weight. | `{ "durationMs", "fps", "shapes": [...], "source": "phonemes" or "sound", "timing": "measured" or "estimated" or "none", "runs": [[startMs, shape], ...] }`. The shape (one of the eleven below) showing from each start, what they follow, and for the words whether every sound was laid by its own time (`measured`) or some word's time was shared among its sounds by weight (`estimated`; `none` when the shapes follow the sound). An editor that does not read `timing` loses nothing. |

The editor does not pass a path from the page: it names narration audio by its cache key, and the shell finds the file in the project's own `.cache/narration`. Everything the add-on says
is checked again in `editor/src/presenter/look.ts` before it is used.

The spec's other commands (`presenter.createAvatar`, `presenter.speak`, `presenter.render`, `presenter.cancel`) are for the photo kinds and the add-on's own voices (Phase 2 and 3).

## How a clip is made

1. **The speech** is the narration the author already has: made with the speech engine if it is not (`makeNarration`), then read from the cache.
2. **The mouth shapes** come from the add-on, as runs of shapes at 25 pictures a second. Given the words the speech engine said with their phonemes (from the narration's cache), it lays each phoneme where the speech engine said it was (`times`), or, for a word
   that has none, shares the word's time among its phonemes by how long each kind of sound lasts (a stop is short, a fricative long). A stress or length mark has a time of its own in Kokoro's lengths (59 milliseconds on average before a stressed vowel, up to 100); it goes to the vowel after it, because a
   vowel's loudness follows that reading better (checked against the audio of a test sentence: 0.264 against 0.222), and the lips begin shaping a vowel before it is heard. It makes each phoneme one of eleven mouth shapes (the table below; a diphthong is a move from one shape to another), and gives each picture the shape most of it shows, leaning toward the lips, the teeth and
   the tongue because they are the easiest to miss. Wherever the audio is quiet the mouth is shut, and if the sound is not where the words say it should be (the words are for other audio) they are not used. Without words
   it listens to the speech instead (how loud each moment is, and how fast the sound crosses zero, which follows how high-pitched it is), which needs no words, no language and no model.
   How good it is: measured against a real voice's own timing of every phoneme (the Windows voice, which reports it), the shape is right in 59 of 100 pictures from the words, against 34 from the sound alone (that is with the eleven shapes; with the six it first had, 59 and 36);
   the same rules given the true time of each phoneme get 93, so what is left is the guess at where each phoneme falls inside its word. Kokoro predicts those lengths, and add-on 0.3.0 reads them (the cache keeps them, `tools/narrate.py`): on a test sentence of 90 sounds the track made from them differs from the track made by weight in 65 of 167 pictures (39%), so by weight the mouth showed a different sound from the one heard in about four pictures in ten.
3. **The picture** is drawn on a canvas 720 pixels square, 25 times a second: a head and shoulders from the presenter's `look`, the mouth (one of the eleven shapes, or on its way from one to the next: see below), a blink every few seconds, a little sway
   and breathing, and the label if it is on.
4. **The encoding.** Where the window has encoders (WebCodecs: VP9 or VP8 for the picture, Opus for the sound), each picture is drawn and encoded at once, the speech is encoded in
   20 millisecond pieces, and `webmwriter.ts` writes them into a WebM file that says how long it is and has a table of where its keyframes are, so a player can show its length and jump
   about in it at once (what `seekMedia` in an interactive video needs). The speech starts at exactly 0, so the captions need no shifting. The clip is as long as the speech and a moment
   of quiet (`fast.ts`). Where the window has no encoders, the browser's own recorder is used instead (`clip.ts`): the speech plays into it while the picture is drawn, in real time. The file
   a recorder writes does not say how long it is, so `webm.ts` writes the length in, and the speech starts about 55 milliseconds in, which the captions allow for.
5. **The framing** is not in the pixels: the clip is always a plain square, and a rounded square or a circle is the object's own `radius`.
6. **The file and the captions** are saved (the captions from the narration's own timing, `cues.ts`, read by the shell from the project's cache), the object is added or replaced, and the credit is recorded; one undo step.

### The eleven mouth shapes

| Shape | What it is | Made by |
| --- | --- | --- |
| `closed` | lips together, and a mouth at rest | p, b, m, and the quiet between words |
| `small` | a small opening | t, d, k, g, n, r, h, y and the neutral vowel |
| `mid` | half open | the vowels of "bed", "cat" and "cup" |
| `open` | open wide | the vowel of "father" |
| `wide` | lips spread | the vowels of "see" and "sit", and the end of "day" |
| `round` | lips rounded into an "o" | the vowels of "off" and "go" |
| `pucker` | lips pushed forward and small | the "oo" of "too", and w |
| `sh` | lips pushed forward, the teeth close | sh, ch, j and the "zh" of "measure" |
| `teeth` | the teeth together, the lips apart | s and z |
| `fv` | the upper teeth on the lower lip | f and v |
| `tongue` | the tongue showing | l and th |

The first six shapes of the first version ran several sounds together (the "sh" of "she" and the "oo" of "too" were both rounded, "f" and "s" were both teeth, "l" and "th" were a small opening), and the sounds that are easiest to see
are the ones people notice are wrong. Each shape is a handful of numbers in `editor/src/presenter/mouthdraw.ts` (how wide, how far the opening reaches above and below the line of the lips, how much of the teeth and the tongue show,
how thick the lips are), not a picture, so the mouth between two shapes is drawn from the numbers between them. A presenter made from a photo, later, has pictures for only about four looks (`docs/decisions/0006-presenter-photo-models.md`)
and will group the eleven shapes into them; the track the add-on makes, and the lead and the ease below, are the same for it.

### How the mouth moves

A track says which shape the sound makes at each moment. A mouth that jumps to each shape as the sound reaches it looks late and stiff, so `look.ts` makes each picture from the track with two things added, for every kind of presenter:

- **A lead.** The mouth is ahead of the sound (`MOUTH_LEAD_MS`, 40 milliseconds: one picture at 25 a second), as it is in a person, whose lips close for a "p" and round for an "oo" before the sound is heard, and as animators draw it,
  a mouth shape one or two pictures before its sound. A picture ahead of the sound is also far less noticeable than one behind it.
- **An ease.** The mouth moves from one shape to the next over a short time (`MOUTH_EASE_MS`, at most 100 milliseconds) centred on the moment the track changes, so the picture just before a change has begun to move and the picture just after it has nearly
  arrived. A shape that lasts only one picture is never blended away: a move is no longer than half of the shorter of the two shapes beside it, so the lips of an "m" (about one picture) are whole in the picture that shows them.

The picture shown from a moment is made from the middle of that picture, plus the lead (`poseForPicture`). Both numbers are a judgement about what looks natural, not a measurement, and are plain constants so a look at a real clip can change them. The mouth
a picture shows is a pose: the shape it is leaving, the shape it is going to, and how far (0 to 1). That is the same thing a photo presenter will need, to blend between its own pictures. Nothing about the lead or the ease changes the keyboard, the focus order
or what a screen reader says: the clip is a video with the alt text and the captions the author already has.

No FFmpeg is used (`CLAUDE.md`): the encoders and the recorder are the window's own, and the file is written by `webmwriter.ts`, and the add-on's rule checker (`presenter/tools/check_rules.py`) fails the build if one of its dependencies is not under a licence that can
ship in an Apache 2.0 program, or looks like FFmpeg.

## Not built yet

Phase 2 and later of the spec: a presenter made from a photo (the model manager and its licence gate, the benchmark, the engine), which waits on a decision about how it is made (`docs/decisions/0006-presenter-photo-models.md`: the specification's plan does not hold as written), the Studio kind, the add-on's own voices (Kitten, Piper), a
remote engine, a Mac build of the engine host, Presenter in OpenStage Scroll and Studio, and the signed installer and update channel. Mouth shapes beyond the eleven (two public mouth-position guides count about twelve to fifteen visibly different looks of English; the likely refinements are in `docs/decisions/0006-presenter-photo-models.md`). Voice cloning is out of scope (`CLAUDE.md`).
