# Interactive video

**Insert > Interactive video...** (with a video chosen on the slide) adds things that happen at moments in the video: questions, hotspots, chapters and choices. It was
asked for on 2026-11-15 (development list, item 8): the timing for a video existed, and there was no editor for it. Format 0.51.0 added the two small things it needed (see
"Interactive video" in `docs/format-spec.md`: the `seekMedia` action and `timing.pauseMedia`).

Everything it makes is ordinary: text, buttons, hotspots, a question and layers, tied to the video by their timing and by rules. Each can be changed on the slide afterwards
like anything else, and a published course needs no new player. A moment's objects share a group, so they are selected, moved and copied together, and the dialog takes a moment
away whole.

## The dialog

It lists what the video has (each moment with a **Remove** button), then **Add**: choose what to add, fill in its box, press **Add**. Times are minutes and seconds, such as `1:20`,
or seconds, such as `80`, up to an hour. Each press is one undo step, and a status line says what was done or what is wrong, in words. It is reached by keyboard and read by a
screen reader like the other dialogs (labelled boxes, real radio buttons, Escape closes it).

| Kind | What the learner sees | What you give |
| --- | --- | --- |
| **A question** | At the time, a multiple choice question over the picture. The video holds until it is answered; the feedback has a **Continue the video** button. One try. | The time, the question, two to six answers (one a line), which is right, and optionally what is said after a right and a wrong answer. |
| **A hotspot** | For a few seconds a part of the picture can be pressed (it is named, and its name shows under it). Pressing it pauses the video and shows a note; **Close the note** plays it again. | The time, how many seconds it stays, its name, what pressing it shows, and where it is as percentages of the video's width and height. |
| **Chapters** | A row of buttons under the video, each "0:12 Later". Each moves the video to its time and plays it. | A time and a title on each line, at least two. Setting chapters again replaces the old ones; an empty box takes them away. |
| **A choice** | Ways to go on. At a time the video holds while the learner chooses; at the end, a layer of choices shows when the video ends. Each goes to a slide. | When (a time, or the end), what is asked, and two to four ways, each with the slide it goes to. |

## What it will not do for you

- The video file, its captions and its transcript are still yours: the validator asks for them as it does for any video (captions are required, and the question and
  choice words are text on the slide, so they can be narrated like any text).
- A hotspot goes when its time is up, so a learner who needs longer, or who uses a keyboard or a screen reader, may miss it: the Problems list warns about it (`timing-control-disappears`).
  Give it several seconds. A learner can always use the video's own controls to go back.
- A question or a choice is drawn over the picture, sized to the video. On a video drawn small on the slide it covers most of it, and the dialog says so; make the video bigger.
- A learner who plays the video past a question (the video's own controls) is not stopped: nothing is marked, and the question comes up again if they go back.
- There is no branching inside one video file. A choice goes to a slide, and that slide can hold another video.
- Not built: a table of the answers over all the questions in a video, a question kind other than multiple choice, dragging a hotspot on the picture, and a preview that plays the moments in the editor
  (use Preview).

The code is `editor/src/interactivevideo.ts` (the moments and the tests of them, `interactivevideo.test.ts`), `Model.addVideoMoment` and `removeVideoMoment`, and `interactivevideodialog.ts`. In
the player: `Timeline` (`pauseClip`), `Runtime` (`seekMedia`) and `Stage.seekMedia`.
