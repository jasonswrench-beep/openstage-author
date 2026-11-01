# Making a video of a course

Publishing can also make an MP4 of the course, with its captions in a file beside it. It is for a course that will be watched rather than
clicked: a lecture that goes on a video site, a recording for a learner who has no LMS, a preview for a colleague who will not open the
editor. It is made from the same course the packages hold, so what you see in the video is what the player draws.

## Making one

In the editor, press **Publish**, tick **Also make a video (MP4) of the course, with captions**, and publish as usual. It is not ticked
unless you tick it, because it takes a while: a course of 24 slides that makes 4 minutes 44 seconds of video took 27 seconds on the
computer it was tried on, and a course full of effects takes longer, because each effect is many pictures. The Cancel button stops it. As
with any publish, publish again before using what a cancel left. A cancelled video also leaves a folder of its pictures in the computer's
temporary folder, which Windows clears out in time.

From the command line:

```
node player/publish.ts PROJECT_DIR OUT_DIR --targets=mp4
node player/publish.ts PROJECT_DIR OUT_DIR --targets=scorm12,scorm2004,xapi,review,mp4
```

`mp4` is a target like the others, and the only one that is made only when it is named. Three more flags change how it is made:

| Flag | What it does |
| --- | --- |
| `--video-size=WxH` | The size of the video in pixels, both numbers even (for example `1280x720`). Without it the video is the size of the course's stage, and a stage wider than 1920 is made 1920 wide. |
| `--video-silent=SECONDS` | How long a slide with nothing said and nothing timed is shown, from 1 to 600. 5 seconds if left out. |
| `--video-no-motion` | Every effect and every change of slide is a cut. For people who cannot have motion on a screen. |

The video is `OUT_DIR.mp4` and its captions are `OUT_DIR.vtt`, beside the folder and the packages, named like the course. Keep the two
together: most video players and video sites pick up a `.vtt` that has the same name.

## What you need

- **Windows.** The video is made with Windows' own H.264 and AAC encoders, through the OpenStage recorder's video maker
  (`openstage-capture.exe`, which comes with the program; `OPENSTAGE_CAPTURE` names another). On another system the publish says so and
  makes everything else.
- **Microsoft Edge or Google Chrome.** The pictures are taken by opening the course in one of them with no window. Edge comes with
  Windows. `OPENSTAGE_BROWSER` names another browser built on Chromium.
- Nothing is installed or uploaded. No FFmpeg is used or shipped (`docs/decisions/0001-screen-capture.md` has the rule). The browser
  and the video maker are separate programs that this one starts and stops, and the browser is silent: it never plays a sound.

If either is missing the publish still makes the packages, and says in the dialog why there is no video.

## What is in it

Each slide, in the order the course plays them, as it looks when it opens. Then:

- **The narration**, in the order the player speaks it (the slide's objects in reading order, one after another), starting 0.3 seconds
  after the slide opens. Only audio that has been made is heard: make it in the Narration window first. A slide whose narration has no
  audio is silent, and the publish says so.
- **Things that arrive and go on their own**: an object timed to appear after a delay, with its narration, or for a while, comes and goes
  at the same moments the player would bring it, because the same timing rules (`player/src/timeline.ts`) are run with a clock that is
  moved by hand. A text that builds one paragraph at a time does the same.
- **Steps that wait for a press of Show next item** come by themselves, the first after 2 seconds and then one every 3 seconds, unless the
  slide says when (the slide's own "steps come by themselves" setting). A video has no one to press.
- **Effects**: an object that fades, slides, zooms or wipes in or out is shown as a series of pictures, one every tenth of a second, so it
  moves. A slide that arrives with an effect of its own is blended in over its first picture, with a cross-fade of half a second
  whichever effect it is.
- **Captions**: one for each sentence of each narration, at the time the narration says it. They come from the scripts, as the player's
  captions do. Nothing is listened to.

How long a slide lasts: as long as its narration and one second after it, or two seconds after its last object arrives, or the time the
slide was set to move on after, whichever is longest. A slide with none of these lasts 5 seconds. Everything is on a grid of a tenth of a
second, which is the shortest a picture can be.

## What it cannot do, and says so

A video cannot be answered, pressed or typed into. After a publish the dialog lists, by slide number:

- **Questions and activities** (quiz questions, interactions, inputs, scenarios) are shown as they are when the slide opens.
- **Video and sound on a slide** are not played: a video shows its first picture, a sound is not heard. What was timed to follow one shows
  from the start.
- **A results box, a certificate or a timer** is shown as it is when the slide opens, with no score or time running.
- **A page or video from another website** is not shown.
- **Layers** that open from a button or an answer are not in the video. Only the main layer is.
- **Words that nothing reads aloud.** A slide with text and no narration is, in a video, a picture of words. A viewer who cannot see it
  gets nothing from it, so the dialog names the slide and asks for narration. The Word review document (`docs/editor.md`) is the reading
  copy of the course.

Not built: audio description, a video that shows the learner's own settings, choosing which slides go in, a title card and credits, and
burning captions into the picture (the captions are a file beside it, so a viewer can turn them off or change them).

## How it works

1. `publish.ts` makes the course as usual, then opens it in the browser with no window (`player/src/cdp.ts`, the browser's remote-control
   protocol, no other program needed) on a page that has only the course's own renderer on it (`player/src/videoframes.ts`).
2. For each slide the page says what is timed and what is narrated. `player/src/videoplan.ts` runs the player's own `Timeline` against that
   with a clock moved by hand, and works out the pictures needed and how long each lasts.
3. Each narration file is read and brought to 48,000 samples a second, one channel, which is what the exporter mixes (`player/src/wav.ts`).
   The voices make 22,050 or 24,000.
4. The page is put in each state, with effects held part way, and a picture is taken.
5. `player/src/videoedit.ts` lays the pictures and the narration on a timeline in the recorder's edit format
   (`docs/capture/capture-edit-format.md`), and writes the captions.
6. `openstage-capture render` makes the MP4 and then reads it back through Windows to check its length, size and sound. If that check fails
   there is no video and the dialog says so.

`player/src/video.ts` does the steps in order. The planning, the sound conversion, the edit and the captions are tested without a browser or
a video maker; the whole is tested by making real videos from the examples (`player/src/video-cli.test.ts`), on a computer that has both.

## Not tried yet

See `TESTING-TODO.md`: the video has been watched only as still pictures and by reading its length, sound track and captions back, not by
a person with sound on, in a real player, with the captions beside it.
