# 0005: Character packs

Status: accepted by Jason S. Wrench, 2026-10-20 (the questions below were put to them and answered in chat). Phase 1 (the library, adding packs, credit) and phase 2 (poses) were built the same day.

## Context

The cast of a course had a picture maker: a cartoon person drawn from a few choices (skin tone, hair, expression, shirt). Jason made five sets of photo-style people with Ideogram, with 15 to 21 poses each, and said they look better than the cartoon person and like what other eLearning tools offer. They asked what the best way to include them is, and said they will probably have about ten sets, and that people should be able to download future packs and install them where the program can use them.

## What was decided

1. **A character pack is the unit.** A folder of pictures with a `pack.json` that describes each person (name, a few words on who they are, the kind of voice that suits them, a description of what they look like, a head picture and the poses). `docs/character-packs.md` is the format. Packs are data only: PNG and WebP pictures and words. A pack can hold no program, no SVG and no link, and every picture is checked to be what its name says.
2. **Two places.** The packs that came with the program are in `character-packs` beside it (the installer carries them). Packs the author adds are kept in the editor's data folder, `character-packs` there, so they are not lost when the program is updated, and the uninstaller offers to delete them with the rest of the program's data (the check box says so).
3. **Adding a pack is a zip file.** The library dialog's **Add a character pack...** takes a zip file the author has downloaded, checks all of it, and installs it only if it is good. The checks (`tools/charpack.py`) refuse climbing paths, links, any file type but pictures and plain text, pictures that are not real pictures, and anything past generous size limits, and say why in words. Installing again updates; a pack may not take the id of one that came with the program. A web address to download from is not built: when the site has packs, the zip file is the same.
4. **The cartoon picture maker is replaced, not kept beside** (Jason's decision). It, its dialog, its save command and its tests are gone. Projects that already used a drawn picture are not affected: a picture is a file in the project, and the file stays.
5. **Alt text comes with the person.** Each person and each pose has a description written for a screen reader, in the pack. Choosing someone fills the picture's alt text with it, and the author is told so aloud and in the dialog, and can change it. This is not the silent filling the rules forbid: the words are shown beside the picture in the library before anyone is chosen, they are announced when chosen, and the field is right there to read and edit. Decorative still has to be ticked by a person.
6. **Choosing copies the picture into the project**, so a course does not depend on the pack and removing a pack changes nothing in a project. The copy is made at once (so the dialog can show it) and is deleted again if the dialog is cancelled or the person is given another picture, so browsing the library leaves nothing behind.
7. **Credit.** Each picture copied from a pack gets an entry in `assets.json` (provider `other`, the pack's creator, link and licence, `requiresCredit` true), saved with the cast in the same undo step. `provider: generated` is not used: it requires the words that made the picture, which the pack does not hold, and it says so on the credits page in other words (the pack's licence line names the AI service). A person with many pictures is one line on the credits page.
8. **Two faults in the old credit handling were found and fixed on the way.** The checker and the publisher decided whether a file was "used" by looking for its name in the slides only, so a picture used only by the cast was never credited and never raised the "credits page is off" warning. The cast now counts. Lines that read the same are merged.
9. **Head picture and poses.** Each person has a square head-and-shoulders picture (for the cast, the library and the small face beside a line) and poses: the whole person, all cut to one frame so that changing pose does not make them jump.
10. **Poses are copied one at a time, and a line can show one.** Choosing a person copies only their head picture. **Add poses from the library...** in the cast dialog copies the poses ticked, so a course that uses three stays small (all of a person's poses would be about 3 MB). A person remembers which pack and person they came from (`library`) so more poses can be offered, and if that pack is gone the poses they already have are kept and the dialog says so. A line of a scenario can show its speaker in one of their poses, cut to the waist, instead of their small face (format 0.29.0; nothing in an existing project changes). A pose a line uses cannot be taken out of the cast. A pose is decoration, with no alt text of its own: the person's name is always written beside it.

## The first pack

`character-packs/openstage-people-1` holds Daryl, David, Gerry, Jacob, Kathy, Ken, Lisa and Salma, from Jason's eight sets (about 150 pictures after leaving out the ones named below; Daryl, Gerry and Salma came later, the same day), made smaller and cut to a common frame by `tools/make_character_pack.py` from the source file `character-packs-src/openstage-people-1.json`. It is 19 MB (PNG: a pure-Python tool cannot write WebP, which would be about a quarter of that; this can change without changing the format, which allows both).

Left out on purpose: a stock-photo preview with a watermark ("Royce") in Jacob's zip and a white-background reference picture in Kathy's, which were reference material and not output (Jason confirmed they were put in the zips by mistake and that no picture was uploaded to Ideogram: a couple were put through another tool to get a plain description to base two of the characters on); a copy saved twice in David's zip and in Jacob's; one picture in Lisa's zip that is the same as another, and one in Gerry's.

## Licensing and provenance

* Ideogram's terms of service (section 2.1) say Ideogram claims no ownership of what is made and the person may use it, including commercially; section 4.2 and 6.2 put the duty to hold the rights to anything uploaded, and not to infringe a person's likeness, on the user. Jason says nothing was uploaded. The pictures are not offered under Apache-2.0 (pictures made only by an AI are in doubt as to copyright, and "free to use in courses made with OpenStage Author" says what a person may do). The credits page says they are AI-generated, in the licence line, so a learner is not left to guess.
* **Open:** the exact words of that licence line are Jason's to settle before release (are the pictures free to use in any course, or only in courses made with OpenStage Author; may the pictures be given away on their own). Today it reads "Pictures made with Ideogram (AI-generated). Free to use in courses made with OpenStage Author". Changing it means changing `pack.json` and the source file, and rebuilding.

## Not built

* A person in a pose on a slide (an image object from the library, with the pack's description of the pose as its alt text). The pack already carries that description (`alt`) for every pose.
* A line spoken by "you" cannot be given a pose in the editor (who the learner chose is only known when the course is played). The format allows it.
* Downloading a pack from the web. The zip file is the way in until there is a place to download from.
* The full-length picture on a slide from the library (poses give it).
* WebP pictures in a pack: allowed by the format and the checks, not made by the tool.
* A screen reader pass over the library dialog (`docs/screen-reader-pass.md` names it; it needs a person with NVDA or Narrator).
