"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { bodyWithoutFrontmatter, plainBlocks } from "./doc-utils";
import { READING_WPM, SPEAKING_WPM, gradeLabel, minutesLabel, readingGrade, sentenceRanges } from "./prose-analysis";
import { MAX_WORD_GOAL } from "./word-goals";

function count(value: number) {
  return value.toLocaleString("en-US");
}

function plural(value: number, noun: string) {
  return `${count(value)} ${noun}${value === 1 ? "" : "s"}`;
}

const RING = 2 * Math.PI * 5.25;

/**
 * The word count in the bar. It shows the selection while there is one and
 * progress while there is a goal, and opens the rest of what can be counted.
 */
export function DocumentStats({
  body,
  words,
  selectedWords,
  shared,
  goal,
  onGoal
}: {
  body: string;
  words: number;
  selectedWords: number;
  shared: boolean;
  goal: number;
  onGoal: (goal: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const progress = goal ? Math.min(1, words / goal) : 0;

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div
      ref={wrap}
      className="wMenuWrap wStatsWrap"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="wDetails"
        aria-label="Document details"
        title="Document details"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {selectedWords > 0 ? (
          <span>{plural(selectedWords, "word")} selected</span>
        ) : goal ? (
          <span className="wGoalCount" data-reached={progress >= 1 || undefined}>
            <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.25" />
              <circle cx="7" cy="7" r="5.25" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
            </svg>
            {count(words)} / {count(goal)}
            <span className="wDetailsExtra">{goal === 1 ? "word" : "words"}</span>
          </span>
        ) : (
          <span>{plural(words, "word")}</span>
        )}
        {!selectedWords && words >= 200 && <span className="wDetailsExtra">{Math.max(1, Math.round(words / READING_WPM))} min read</span>}
        {shared && <span>Shared</span>}
      </button>
      {open && <StatsPanel id={id} body={body} words={words} goal={goal} onGoal={onGoal} />}
    </div>
  );
}

function StatsPanel({ id, body, words, goal, onGoal }: {
  id: string;
  body: string;
  words: number;
  goal: number;
  onGoal: (goal: number) => void;
}) {
  const goalId = useId();
  const [draft, setDraft] = useState(goal ? String(goal) : "");
  const stats = useMemo(() => {
    const blocks = plainBlocks(bodyWithoutFrontmatter(body));
    const grade = readingGrade(blocks);
    return {
      characters: blocks.join(" ").length,
      sentences: blocks.reduce((total, block) => total + sentenceRanges(block).length, 0),
      level: grade === null ? "Not enough text" : `Grade ${grade} · ${gradeLabel(grade)}`
    };
  }, [body]);
  const rows = [
    ["Words", count(words)],
    ["Characters", count(stats.characters)],
    ["Sentences", count(stats.sentences)],
    ["Reading time", minutesLabel(words, READING_WPM)],
    ["Speaking time", minutesLabel(words, SPEAKING_WPM)],
    ["Reading level", stats.level]
  ];

  function commit() {
    const next = Math.min(MAX_WORD_GOAL, Number.parseInt(draft.replace(/\D/g, ""), 10) || 0);
    setDraft(next ? String(next) : "");
    if (next !== goal) onGoal(next);
  }

  return (
    <div id={id} className="wMenu wStats" role="dialog" aria-label="Document details">
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <form
        className="wGoal"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <label htmlFor={goalId}>Word goal</label>
        <input
          id={goalId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="None"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
        />
        {goal > 0 && (
          <p role="status">
            <progress max={goal} value={Math.min(words, goal)} aria-label="Progress to word goal" />
            {words >= goal ? "Goal reached" : `${plural(goal - words, "word")} to go`}
          </p>
        )}
      </form>
    </div>
  );
}
