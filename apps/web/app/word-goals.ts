"use client";

import { useCallback, useSyncExternalStore } from "react";

// Word goals belong to the browser, keyed by document. They are a note to
// yourself about a draft, not part of the Markdown.
const GOALS_KEY = "passage.goals.v1";
export const MAX_WORD_GOAL = 500000;

let goals: Record<string, number> | null = null;
const listeners = new Set<() => void>();

function load() {
  if (goals) return goals;
  goals = {};
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(GOALS_KEY) ?? "{}");
    if (stored && typeof stored === "object") {
      for (const [id, value] of Object.entries(stored)) {
        if (typeof value === "number" && value > 0) goals[id] = value;
      }
    }
  } catch {
    // Unreadable storage means no goals, not a broken page.
  }
  return goals;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setWordGoal(docId: string, goal: number) {
  const next = { ...load() };
  const words = Math.min(MAX_WORD_GOAL, Math.floor(goal));
  if (words > 0) next[docId] = words;
  else delete next[docId];
  goals = next;
  try {
    localStorage.setItem(GOALS_KEY, JSON.stringify(next));
  } catch {
    // The goal still holds for this visit.
  }
  listeners.forEach((listener) => listener());
}

// The word goal for a document, or 0 when none is set.
export function useWordGoal(docId: string): [number, (goal: number) => void] {
  const goal = useSyncExternalStore(subscribe, () => load()[docId] ?? 0, () => 0);
  const setGoal = useCallback((next: number) => setWordGoal(docId, next), [docId]);
  return [goal, setGoal];
}

export function resetWordGoalsForTest() {
  goals = null;
}
