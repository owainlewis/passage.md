import {
  clock, countWords, gradeLabel, minutesLabel, readingGrade, sentenceAt, sentenceRanges
} from "./prose-analysis";

function sentences(text: string) {
  return sentenceRanges(text).map(({ from, to }) => text.slice(from, to));
}

describe("sentenceRanges", () => {
  it("splits on sentence ends and leaves the space between out", () => {
    expect(sentences("One thing. Then another! A third?  ")).toEqual(["One thing.", "Then another!", "A third?"]);
  });

  it("does not end a sentence on a title or a common abbreviation", () => {
    expect(sentences("Mr. Smith went home. Use a list, e.g. this one.")).toEqual([
      "Mr. Smith went home.",
      "Use a list, e.g. this one."
    ]);
  });

  it("finds nothing in blank text", () => {
    expect(sentenceRanges("   ")).toEqual([]);
  });
});

describe("sentenceAt", () => {
  const text = "First one. Second one.";

  it("returns the sentence the caret is in", () => {
    expect(sentenceAt(text, 3)).toEqual({ from: 0, to: 10 });
    expect(sentenceAt(text, 15)).toEqual({ from: 11, to: 22 });
  });

  it("stays with the finished sentence until the next one begins", () => {
    expect(sentenceAt("First one. ", 11)).toEqual({ from: 0, to: 10 });
    expect(sentenceAt(text, 11)).toEqual({ from: 11, to: 22 });
  });

  it("has no sentence in empty text", () => {
    expect(sentenceAt("", 0)).toBeNull();
  });
});

describe("readingGrade", () => {
  it("waits for enough text", () => {
    expect(readingGrade(["Too short to say."])).toBeNull();
  });

  it("grades plain sentences lower than dense ones", () => {
    const plain = Array.from({ length: 12 }, () => "The cat sat on the mat.");
    const dense = Array.from({ length: 4 }, () =>
      "Organisational transformation initiatives necessitate comprehensive stakeholder communication strategies throughout implementation."
    );
    const easy = readingGrade(plain)!;
    const hard = readingGrade(dense)!;
    expect(easy).toBeLessThanOrEqual(3);
    expect(hard).toBeGreaterThanOrEqual(13);
    expect(gradeLabel(easy)).toBe("Very easy");
    expect(gradeLabel(hard)).toBe("Hard");
  });
});

describe("counts and times", () => {
  it("counts words, not punctuation", () => {
    expect(countWords("Well-known words, don't they count? Yes: 3 times.")).toBe(8);
    expect(countWords(" - ")).toBe(0);
  });

  it("labels minutes", () => {
    expect(minutesLabel(40, 150)).toBe("Under 1 min");
    expect(minutesLabel(1200, 150)).toBe("8 min");
  });

  it("formats the clock", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(125.4)).toBe("2:05");
  });
});
