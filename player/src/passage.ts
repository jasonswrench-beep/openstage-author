// The passage of a "which word" question: a few sentences in which the learner chooses one word. The author marks each right word with square brackets
// ("The dog [barked] loudly."); the learner sees the passage without them. This reads the passage into the words that can be chosen and the pieces to
// draw, and says what is wrong with a passage that cannot be a question. No page here, so all of it is tested directly, from the same table of cases the
// validator's Python reading is tested from (tools/passage-cases.json).

export interface PassageWord {
  /** w1, w2, ... in the order the words come. This is the answer that is kept. */
  id: string;
  /** The word as it is chosen and reported: without the punctuation round it. */
  text: string;
  right: boolean;
}

export type PassagePiece = { type: "text"; value: string } | { type: "word"; id: string; value: string };

export interface Passage {
  pieces: PassagePiece[];
  words: PassageWord[];
  /** What is wrong with it, as codes: no-words, none-marked, empty-mark, split-mark, double-mark, too-many-words. */
  problems: string[];
}

/** The most words a passage can have. A learner chooses from a list of them, so a page of text is too much. */
export const MAX_PASSAGE_WORDS = 300;

const EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function readPassage(source: string): Passage {
  const pieces: PassagePiece[] = [];
  const words: PassageWord[] = [];
  const problems = new Set<string>();
  for (const token of source.normalize("NFC").match(/\S+|\s+/g) ?? []) {
    if (/^\s/.test(token)) {
      pieces.push({ type: "text", value: token });
      continue;
    }
    const marks = [...token.matchAll(/\[([^[\]]*)\]/g)];
    let right = false;
    let shown = token;
    if (marks.length > 1) problems.add("double-mark");
    if (marks.length >= 1) {
      if (marks[0]![1] === "") problems.add("empty-mark");
      right = marks[0]![1] !== "";
      shown = token.replace(/\[([^[\]]*)\]/g, "$1");
    }
    // A bracket left over means a mark that runs across words, which a learner could not choose as one.
    if (/[[\]]/.test(shown)) {
      problems.add("split-mark");
      shown = shown.replace(/[[\]]/g, "");
    }
    const core = shown.replace(EDGES, "");
    if (core === "") {
      pieces.push({ type: "text", value: shown });
      continue;
    }
    const at = shown.indexOf(core);
    if (at > 0) pieces.push({ type: "text", value: shown.slice(0, at) });
    const id = `w${words.length + 1}`;
    words.push({ id, text: core, right });
    pieces.push({ type: "word", id, value: core });
    if (at + core.length < shown.length) pieces.push({ type: "text", value: shown.slice(at + core.length) });
  }
  if (words.length === 0) problems.add("no-words");
  else if (!words.some((w) => w.right)) problems.add("none-marked");
  if (words.length > MAX_PASSAGE_WORDS) problems.add("too-many-words");
  return { pieces, words, problems: [...problems] };
}

/** The passage as the learner reads it: the words and punctuation, with no marks. */
export const shownPassage = (source: string): string => readPassage(source).pieces.map((p) => p.value).join("");
