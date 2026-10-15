/**
 * Hearing a voice before choosing it. A sample is one short fixed sentence in the voice, made the first time it is asked for and then
 * kept on this computer (tools/voice_sample.py makes and keeps it; the desktop shell hands the sound back). None of the author's own
 * words are used. This file is the plain part: the words the editor says about it, and reading what the shell answers.
 */
import { base64ToBytes, voiceOption, type VoiceTraits } from "./narration.ts";

export type SampleState = "idle" | "making" | "playing";

/** The button's words for each state. One button does all three jobs, so it is always where the author's keyboard left it. */
export function sampleButton(state: SampleState): { label: string; title: string } {
  if (state === "making") return { label: "Cancel the sample", title: "Stop making the sample" };
  if (state === "playing") return { label: "Stop the sample", title: "Stop playing the sample" };
  return { label: "Hear this voice", title: "Play a short sample of this voice" };
}

/** The paragraph under the button: what hearing a sample does, and what it costs. Empty for a voice that cannot be chosen. */
export function sampleNote(t: VoiceTraits): string {
  if (!t.known) return "";
  if (t.engine === "kokoro") return "A sample is made on this computer. The first one can take a little while, while Kokoro starts. Samples are kept, so hearing a voice again is quick.";
  if (t.where === "internet") {
    return `The first time, one short sentence of the sample (none of your own words) is sent to ${t.engineName} over the internet, and ${t.engineName} may charge your account for it. The sample is kept on this computer, so hearing the voice again sends nothing and costs nothing.`;
  }
  return `The plugin "${t.engineName}" makes a short sample on this computer. Samples are kept, so hearing a voice again is quick.`;
}

/** What is said while a sample is being made. */
export function sampleMakingText(voice: string): string {
  return `Making a sample of ${voiceOption(voice).label}.`;
}

/** What is said when the sound starts. */
export function samplePlayingText(voice: string): string {
  return `Playing a sample of ${voiceOption(voice).label}.`;
}

export type SampleAnswer =
  | { ok: true; wav: Uint8Array<ArrayBuffer>; cached: boolean; name: string }
  | { ok: false; message: string; cancelled?: boolean };

const isWav = (b: Uint8Array): boolean =>
  b.length > 44 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WAVE";

/** What the desktop shell answers for a sample: the sound (a WAV file, as base64 text) and who made it, or why there is none. */
export function parseSample(raw: string): SampleAnswer {
  try {
    const d = JSON.parse(raw) as unknown;
    if (typeof d !== "object" || d === null) throw new Error("not an object");
    const r = d as Record<string, unknown>;
    if (r["ok"] === true && typeof r["audio"] === "string") {
      const wav = base64ToBytes(r["audio"]);
      if (!isWav(wav)) return { ok: false, message: "What came back was not a sound OpenStage can play." };
      return { ok: true, wav, cached: r["cached"] === true, name: typeof r["name"] === "string" ? r["name"] : "" };
    }
    const message = typeof r["message"] === "string" && r["message"].trim() !== "" ? r["message"].trim() : "The sample could not be made, and nothing said why.";
    return { ok: false, message, ...(r["cancelled"] === true ? { cancelled: true } : {}) };
  } catch {
    return { ok: false, message: "The answer was not understood." };
  }
}
