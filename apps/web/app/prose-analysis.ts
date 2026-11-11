// What the writer can say about prose without sending it anywhere: where
// sentences start and end, how long it runs, and how hard it reads.
// Everything here is a pure function of the text.

export type TextRange = { from: number; to: number };

export const READING_WPM = 230;
export const SPEAKING_WPM = 150;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter("en", { granularity: "sentence" })
  : null;
// The segmenter ends a sentence after these. They rarely end one.
const ABBREVIATION = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|No|Fig|approx|e\.g|i\.e)\.\s*$/;

// Each sentence in the text, without the space around it.
export function sentenceRanges(text: string): TextRange[] {
  const pieces: Array<{ index: number; segment: string }> = [];
  if (segmenter) {
    for (const { index, segment } of segmenter.segment(text)) {
      const previous = pieces[pieces.length - 1];
      if (previous && ABBREVIATION.test(previous.segment)) previous.segment += segment;
      else pieces.push({ index, segment });
    }
  } else {
    for (const match of text.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g)) {
      pieces.push({ index: match.index, segment: match[0] });
    }
  }
  const ranges: TextRange[] = [];
  for (const { index, segment } of pieces) {
    const lead = segment.length - segment.trimStart().length;
    const length = segment.trimEnd().length;
    if (length > lead) ranges.push({ from: index + lead, to: index + length });
  }
  return ranges;
}

// The sentence the caret is in. Between two sentences it belongs to the one
// before until the next has begun.
export function sentenceAt(text: string, offset: number): TextRange | null {
  const ranges = sentenceRanges(text);
  let current: TextRange | null = null;
  for (const range of ranges) {
    if (range.from > offset) break;
    current = range;
  }
  return current ?? ranges[0] ?? null;
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

function syllables(word: string) {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length <= 3) return 1;
  const groups = letters.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

const GRADE_MIN_WORDS = 30;

// Flesch-Kincaid grade: the US school year that could read the text.
// Null until there is enough text for the number to mean anything.
export function readingGrade(blocks: string[]): number | null {
  let words = 0;
  let sentences = 0;
  let syllableCount = 0;
  for (const block of blocks) {
    sentences += sentenceRanges(block).length;
    for (const word of block.match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
      words += 1;
      syllableCount += syllables(word);
    }
  }
  if (words < GRADE_MIN_WORDS || !sentences) return null;
  const grade = 0.39 * (words / sentences) + 11.8 * (syllableCount / words) - 15.59;
  return Math.min(18, Math.max(1, Math.round(grade)));
}

export function gradeLabel(grade: number) {
  if (grade <= 6) return "Very easy";
  if (grade <= 9) return "Easy";
  if (grade <= 12) return "Fairly hard";
  return "Hard";
}

// "4 min", or "under 1 min" for a few lines.
export function minutesLabel(words: number, wordsPerMinute: number) {
  const minutes = words / wordsPerMinute;
  return minutes < 0.75 ? "Under 1 min" : `${Math.round(minutes)} min`;
}

// m:ss, for the teleprompter clock.
export function clock(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
