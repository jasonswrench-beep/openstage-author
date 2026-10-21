# Character packs

A **character pack** is a folder of pictures of people, with a description of each person. It is how a course gets people on its screen: the cast of a scenario, the people a learner can choose to be, a face beside a line of dialogue. Packs are data only, pictures and words. Nothing in one is ever run.

OpenStage Author comes with one pack, **OpenStage people, set 1**: Aisyah, Blayne, Daryl, David, Gerry, Harold, Jacob, Kathy, Ken, Lisa, Makoa, Malina, Mei, Salma and Yusuf, each in many poses. More packs can be added, one at a time, from a zip file.

## Using a person from a pack

1. Open **Characters** in the toolbar.
2. Add a person (or open one you have), and under *Picture* press **Choose from the library...**
3. Choose someone. Their picture comes into your project, with the description that goes with it as the picture's **alt text**.

What the pack's description does, and does not, do:

* The alt text is filled in from the pack, and the dialog tells a screen reader so. It is yours to read and change. A person who is only shown by name has no need of it, and the picture can be marked decorative, as with any picture.
* A person who has not been named yet (the editor starts one as "Person 3") takes the pack person's name and a voice of the kind the pack suggests (female or male) that no one else in the cast has. Someone you have already named keeps their name and voice; only the picture changes.
* The picture is copied into the project (`assets/images`), so the course does not depend on the pack afterwards. Removing a pack from the computer changes nothing in a project that used it.
* The credits page of a published course names who made the picture and under what licence, once, however many pictures of that person the course uses. The credit is saved in `assets.json` in the same step as the cast, and one press of Ctrl+Z takes both back. The credits page is on by default; if it is off, the checker warns, as it does for any picture that asks for credit.

## Poses

A pack has a head picture for each person and, usually, many poses: the whole person, waving, thinking, presenting, with arms crossed. A person chosen from the library has a **Poses** box in the cast dialog (**Add poses from the library...**); there the author ticks the poses they want and only those are copied into the project. In a scenario, a line spoken by that person can then be given one of their poses in its **Pose beside the line** box (`docs/editor.md`, `docs/format-spec.md`).

A pose is decoration: it is drawn beside the person's name, so a screen reader skips it, and what a line means must be in its words. Every pose is described in the pack anyway (its `alt`), for a picture of the person that is put on a slide in a later version.

## Adding a pack, and taking one away

In the same library dialog:

* **Add a character pack...** asks for a zip file, checks all of it, and only then installs it. A pack that is not good is not kept, and the message says what is wrong.
* **Show the packs folder** opens the folder where packs you added are kept (in the editor's data folder). Uninstalling OpenStage Author offers to delete that folder with the rest of the program's data.
* **Remove this pack** (on a pack you added; press it twice) takes the pack away. A pack that came with the program cannot be removed. People already in a cast keep their pictures, because the pictures are in the project.

Adding a pack whose id is already there updates it (the message says which version it was). A pack may not take the id of a pack that came with the program.

### What is refused

The check (`tools/charpack.py`) refuses a pack, and keeps nothing of it, if:

* there is no `pack.json`, or it is not valid, or it says a `packVersion` this program does not know;
* it holds anything but PNG and WebP pictures, `pack.json` and plain text files (`.txt`, `.md`) at the top: no SVG, no program, no web page, no link;
* a picture is not really a PNG or WebP picture whatever it is called, is smaller than 16 or larger than 4096 points a side, or is larger than 3 MB;
* a name inside the zip is not a plain place inside the pack (a path that climbs out with `..`, a drive letter, a backslash, a hidden file, more than three levels), or two names differ only by capital letters;
* a picture `pack.json` names is not in the pack, or two entries name one file;
* the pack, unpacked, is more than 120 MB, or the zip holds more than 2000 files.

## The format

A pack is a folder (or a zip file holding that folder, or its contents):

```
openstage-people-1/
  pack.json
  kathy/
    head.webp         the head and shoulders, square
    neutral.webp      a pose: the whole person, every pose of a person cut to the same frame
    welcome.webp
    ...
  ken/
    ...
```

`pack.json`:

```json
{
  "packVersion": 1,
  "id": "openstage-people-1",
  "title": "OpenStage people, set 1",
  "version": "1.0.0",
  "description": "Fifteen people in everyday work and casual clothes, each in many poses.",
  "credit": {
    "creator": "Jason S. Wrench",
    "creatorUrl": "https://openstageauthor.com",
    "licence": "Made with Ideogram (AI-generated), in the public domain",
    "url": "https://openstageauthor.com"
  },
  "people": [
    {
      "id": "kathy",
      "name": "Kathy",
      "role": "",
      "voice": "female",
      "alt": "Kathy, a woman with light skin and long red hair, wearing a navy jacket over a blue top and dark trousers, seated in a wheelchair.",
      "head": "kathy/head.webp",
      "poses": [
        { "id": "neutral", "label": "Seated, relaxed", "alt": "Kathy, ..., seated with hands together in the lap, smiling.", "file": "kathy/neutral.webp" }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `packVersion` | `1`. A pack with another number is refused, with a message that the program may need updating. |
| `id` | 3 to 40 lower case letters, digits and hyphens, starting with a letter. A pack is known by it. |
| `title`, `description` | What the library shows. `title` is needed (up to 80 letters); `description` may be empty (up to 400). |
| `version` | Like `1.0.0`. Adding a pack with the same `id` replaces the old one. |
| `credit` | Who made the pictures and under what terms. `creator`, `licence` and `url` are needed; `creatorUrl` may be empty. This is what the credits page says. Write the licence as a phrase, without a full stop at the end (the credits page adds one). |
| `people` | 1 to 40 people. |
| person `id` | 1 to 30 lower case letters, digits and hyphens, starting with a letter; not `you` (which means the learner in a scenario). Unique in the pack. |
| person `name` | 1 to 40 letters. What the learner reads beside the person's lines. |
| person `role` | A few words on who they are, or empty. |
| person `voice` | `female`, `male` or `any`: the kind of narration voice that suits them. Only a suggestion, used for a person who has not been given a voice. |
| person `alt` | What the person looks like, in words: **the alt text that comes with their picture**. Needed. Up to 300 letters. |
| person `head` | The square head-and-shoulders picture, a place inside the pack. |
| person `poses` | 0 to 40 poses. A pose has an `id` (unique for the person), a `label` (what a menu says, up to 60 letters), an `alt` (the person in that pose, in words, starting with who they are) and a `file`. |

Pictures are PNG or WebP, with a clear background (a cut-out), and every pose of one person has the same size and is cut to the same frame, so that changing pose does not make them jump. The pack that comes with the program is WebP, about a quarter of the size of the same pictures as PNG and the same to the eye. Places inside the pack are up to three plain names joined by `/`.

### Pose names

A pack may name its poses as it likes, but the same words mean the same thing from one person to the next when these are used (`-2`, `-3` and so on make more of the same kind):

| id | label |
|---|---|
| `neutral` | Standing, relaxed |
| `welcome` | Waving hello |
| `explain` | Explaining, hands open |
| `present-left`, `present-right` | Presenting, arm out to the left, or to the right (as seen on the screen) |
| `think` | Thinking, hand to chin |
| `arms-crossed` | Arms crossed |
| `point` | Pointing |
| `hands-together` | Hands together |
| `stop` | Hand up, palm out |
| `side` | Seen from the side |

## Making a pack of your own

You need a folder for each person with one PNG for each pose: the person on a **transparent background**, all the same size, which is what a picture service gives you if you ask for a cut-out. `tools/make_character_pack.py` does the rest. It needs nothing but Python for PNG pictures; for WebP pictures (`--webp`, much smaller) it also uses FFmpeg, which has to be on the computer already (on the PATH, or named in the `OPENSTAGE_FFMPEG` setting). FFmpeg is only used to make the files: what comes out is plain WebP, and nothing of FFmpeg is part of OpenStage Author.

1. Put each person's pictures in a folder named for them, and all those folders in one folder.
2. Write a source file: a `pack.json` as above, with the words for every person and pose, plus a few lines for the tool. In each pose, `file` is the **start of the picture's file name**, enough to tell it from the others, instead of a place in the finished pack. `character-packs-src/openstage-people-1.json` is the real example.
   * top level: `folder` (where the people's folders are, written from the source file's folder; or give `--raw` on the command line), `poseHeight` (how tall a pose is made, in points; default 560) `headSize` (the head picture's size; default 256), `pictures` (`png`, the default, or `webp`; `--webp` and `--png` on the command line say it instead) and `webpQuality` (1 to 100; default 85).
   * each person: `folder` (default their `id`), `default` (the pose the head picture is cut from; default `neutral`) and optionally `headBox`, `[left, top, size]` in points of the original picture, to say exactly where the head picture is cut from.
3. Run it:

   ```
   python tools/make_character_pack.py my-pack-source.json --raw C:\pictures\my-people --out C:\packs\my-pack
   ```

   It finds the smallest frame that holds every pose of a person, cuts each picture to it, makes them smaller, cuts a square head picture from the default pose, writes `pack.json`, and checks the result the way the editor will. Then zip the folder and add it from the library dialog.

Write the descriptions as you would want to hear them: who the person is, then what the picture shows. A pose's `alt` starts with the person's own description and then says what they are doing ("..., waving hello."). Say what is plain to see (hair, clothes, a wheelchair, glasses); do not guess at things a picture cannot show.

## Licences

The pictures in a pack are not part of OpenStage Author's Apache-2.0 licence unless the pack says so. Each pack says who made its pictures and what you may do with them, and that is what the credits page tells your learners. A person who makes a pack decides its licence.

The pack that comes with the program, OpenStage people, set 1, was made by Jason S. Wrench with Ideogram, from written descriptions. Jason S. Wrench states that the pictures were created using Ideogram and remain in the public domain, so anyone may use them for any purpose, and they are not under Apache-2.0. A course that uses one still says on its credits page who made it and that it is AI-generated ("Made with Ideogram (AI-generated), in the public domain"), so a learner is not left to guess; this is the same honesty the credits page keeps for AI narration, and it is why the entry still asks for the credits page to be on.
