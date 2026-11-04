# Captions from a recorded voice

The captions window can listen to the voice in a video or an audio clip and write the captions for you, with the time of every word. It is a first draft that you check: the computer makes mistakes, especially with names and when there is noise or music.
Everything happens on your computer. Nothing is sent anywhere, and the program that listens has no way to reach the internet.

## Setting it up (once)

1. **Build the speech recogniser.** Double-click `BUILD SPEECH RECOGNISER.bat`. It needs git and Visual Studio's C++ tools with CMake (the same Visual Studio that builds the editor), downloads about 20 MB of source from github.com, and builds into the `speech` folder. It
   takes a few minutes. It only has to be done once; delete the `speech` folder to build it again.
2. **Download a speech model.** In the editor, select a video or audio clip, press **Write captions...**, and under *Write the captions by listening to the voice* choose a model and press **Download the speech model**. It asks first. Choose:
   - **small.en, 488 MB** (recommended): more careful. About a fifth of the length of the recording to listen to it.
   - **base.en, 148 MB**: faster (about a tenth) but makes more mistakes with names and in noise.
   Both are English only, are made by OpenAI and are shared under the MIT licence. They are kept in `%LOCALAPPDATA%\com.openstageauthor.editor\speech-models`, checked against the checksum Hugging Face publishes, and never put in a course.

## Using it

- **Listen and write the captions** replaces the captions in the list (it asks first if there are some) with captions made from what it heard. They are marked as unchecked. Play the video, read each caption against what you hear, change what is wrong, then press **I have checked the captions**.
- **Set the times of my captions by the quiet gaps in the voice** (built 2026-11-01) needs no speech model and downloads nothing, so it works on any computer, with or without the recogniser. It reads the sound of the clip, finds where the voice speaks and where it pauses (a pause under 0.3 seconds is not a pause, and a click shorter than 0.12 seconds is not speech), and gives your captions times: each caption gets a share of the speech in proportion to its characters, and starts at the pause nearest to where its share begins, if one is within half an average caption's share of the speech (and at least 0.6 seconds). A caption with no pause near enough starts inside the speech where its share begins, and the dialog says how many places where a caption begins are at a pause. A caption starts 0.12 seconds before the voice does after a pause and ends 0.25 seconds after the voice stops before one. Your words are never changed. The times are **estimates**: the captions are marked as unchecked, in the file as well, until you have played the clip and put right any that are off. It is a better guess than spreading the captions evenly over the clip, and a worse one than listening to the words with the model, so the model's button is still the one to use when the model is there. The rules are `editor/src/voicegaps.ts`, with 13 tests (the sound is made in the tests, so no recording is needed).
- **Set the times of my captions by the voice** keeps your words (typed, made from a script, or brought in from a file) and gives them the times of the voice. It tells you how many of your words it heard exactly. This is the best way to get a script's captions to line up.
- **Words to listen for** is filled in from your course (its title, slide names, headings, text and narration scripts). Names it would otherwise mishear, such as *Brightspace* or the name of your school, are heard right far more often when they are here. Add the names of people and places in your video. These words stay on your computer.
- **Stop** ends a listening or a download. Nothing is changed.
- It works on a clip up to 3 hours long. A clip longer than 20 minutes is listened to in parts (the dialog says "Part 2 of 3" as it goes), each cut in the quietest moment near the even spacing so a cut falls in a pause, and the captions come out as one list. Stop works between parts as well as during one. The limit is the computer's memory (the whole sound is read at once, about 8 megabytes for each minute of stereo), and a course's own size limits keep a clip well under it.
- It leaves out the notes it writes about sounds (such as *[BLANK_AUDIO]* or *(keyboard clicking)*) and any word it "hears" where the clip is silent, and tells you how many.

## What to expect

On the trial recordings (a computer voice reading a script with the words used in this field): 99.8% of the words right in a clean recording, 98% with the noise of a laptop microphone, and 93% when the voice was only slightly louder than loud noise. Sentence
starts were within half a second of the voice. Your own clean narration came out as clean sentences. Another person's voice, an accent, a poor microphone or music under the voice may be worse; that has not been tried. See `docs/decisions/0002-speech-recognition.md`.

## If something does not work

- *"The speech recogniser is not installed"*: run `BUILD SPEECH RECOGNISER.bat`, or set `OPENSTAGE_WHISPER` to the full path of a `whisper-cli.exe`, then open OpenStage Author again.
- *The Download button asks for the internet and fails*: try again later; the message says what the server answered. A file that does not match its checksum is thrown away.
- *"The sound of this file could not be read here"*: the window could not decode the clip (it may have no sound). Try a clip in MP4, MP3 or WAV.
- *It is slow*: use the faster model, and close other programs. A recording or a preview or publish that is running makes it wait.

## For developers: replacing the recogniser

The editor runs one program and reads one JSON file, so another recogniser can be used by putting a program with the same interface in `OPENSTAGE_WHISPER`: it must take `-m <model file> -f <16 kHz mono 16-bit WAV> -l en -t <threads> -ojf -of <output name without .json>
-np -pp -ng -dtw <model id> -nfa [--prompt <words>]`, print `progress = <percent>%` lines on its error channel, and write `<output name>.json` in whisper.cpp's full format: `transcription` is a list of segments, each with `offsets` and `tokens`, and each token has `text` (a token that
starts with a space begins a word), `offsets` and `t_dtw` (hundredths of a second, or -1 for none). The word times come from `t_dtw`. The reading of that JSON, and everything done with it, is in `editor/src/recognition.ts`.
