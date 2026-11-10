"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bodyWithoutFrontmatter, plainBlocks } from "./doc-utils";
import { renderMarkdown } from "./markdown-view";
import { Modal } from "./modal";
import { SPEAKING_WPM, clock, countWords } from "./prose-analysis";

const SETTINGS_KEY = "passage.prompter.v1";
const WPM = { min: 60, max: 320, step: 10 };
const SIZE = { min: 28, max: 104, step: 4 };
// How long the pointer rests before the controls step back during a read.
const IDLE_AFTER = 2500;

type Settings = { wpm: number; size: number; mirror: boolean };

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.min(max, Math.max(min, value));
}

function storedSettings(): Settings {
  const settings = { wpm: SPEAKING_WPM, size: 48, mirror: false };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
    if (typeof stored.wpm === "number") settings.wpm = clamp(stored.wpm, WPM);
    if (typeof stored.size === "number") settings.size = clamp(stored.size, SIZE);
    settings.mirror = stored.mirror === true;
  } catch {
    // Storage may be unavailable; the defaults read well.
  }
  return settings;
}

/**
 * Reads the document back as a script: large type on black that scrolls at
 * a speaking pace, so the words to say next are always at the same height.
 * Headings become cue marks. The pace is words per minute, so the clock
 * shows how long the piece runs before a camera is ever switched on.
 */
export function Teleprompter({ source, onClose }: { source: string; onClose: () => void }) {
  const [settings, setSettings] = useState(storedSettings);
  const [playing, setPlaying] = useState(false);
  const [idle, setIdle] = useState(false);
  const [progress, setProgress] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const fraction = useRef(0);

  const markdown = useMemo(() => bodyWithoutFrontmatter(source), [source]);
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const words = useMemo(() => countWords(plainBlocks(markdown).join(" ")), [markdown]);
  const seconds = Math.max(1, (words / settings.wpm) * 60);

  const change = useCallback((next: Partial<Settings>) => {
    setSettings((current) => {
      const settings = { ...current, ...next };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // The setting still holds for this read.
      }
      return settings;
    });
  }, []);

  const distance = () => {
    const element = scroll.current;
    return element ? Math.max(1, element.scrollHeight - element.clientHeight) : 1;
  };

  // The page scrolls itself. A hand on the wheel wins: the read carries on
  // from wherever the reader left it.
  useEffect(() => {
    const element = scroll.current;
    if (!playing || !element) return;
    let frame = 0;
    let last = performance.now();
    let position = element.scrollTop;
    function tick(now: number) {
      // The pace follows the clock, not the frame rate, so a slow machine
      // still finishes on time. A tab left in the background resumes where
      // it was rather than leaping ahead.
      const step = Math.min(1, (now - last) / 1000);
      last = now;
      const total = distance();
      if (Math.abs(element!.scrollTop - position) > 2) position = element!.scrollTop;
      position = Math.min(total, position + (step * total) / seconds);
      element!.scrollTop = position;
      if (position >= total) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, seconds]);

  // A screen that sleeps mid-take ruins the take.
  useEffect(() => {
    if (!playing) return;
    let lock: { release: () => Promise<void> } | undefined;
    let released = false;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wakeLock?.request("screen").then((held) => {
      if (released) void held.release().catch(() => undefined);
      else lock = held;
    }).catch(() => undefined);
    return () => {
      released = true;
      void lock?.release().catch(() => undefined);
    };
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    let timer = window.setTimeout(() => setIdle(true), IDLE_AFTER);
    function wake() {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_AFTER);
    }
    window.addEventListener("pointermove", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      setIdle(false);
    };
  }, [playing]);

  function onScroll() {
    const element = scroll.current;
    if (!element) return;
    fraction.current = Math.min(1, element.scrollTop / distance());
    if (bar.current) bar.current.style.transform = `scaleX(${fraction.current})`;
    setProgress(Math.round(fraction.current * 1000) / 1000);
  }

  // A new type size reflows the script; stay on the same line of it.
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = fraction.current * distance();
  }, [settings.size]);

  function skip(pages: number) {
    const element = scroll.current;
    if (element) element.scrollTop += pages * element.clientHeight;
  }

  function toggle() {
    const element = scroll.current;
    // Play at the end starts the read again.
    if (!playing && element && element.scrollTop >= distance() - 1) element.scrollTop = 0;
    setPlaying(!playing);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A focused control answers Space and Enter itself.
    const onControl = (event.target as HTMLElement).closest("button");
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if ((key === " " || key === "Enter") && onControl) return;
    const actions: Record<string, () => void> = {
      " ": toggle,
      k: toggle,
      ArrowUp: () => change({ wpm: clamp(settings.wpm + WPM.step, WPM) }),
      ArrowDown: () => change({ wpm: clamp(settings.wpm - WPM.step, WPM) }),
      ArrowLeft: () => skip(-0.25),
      ArrowRight: () => skip(0.25),
      "=": () => change({ size: clamp(settings.size + SIZE.step, SIZE) }),
      "+": () => change({ size: clamp(settings.size + SIZE.step, SIZE) }),
      "-": () => change({ size: clamp(settings.size - SIZE.step, SIZE) }),
      m: () => change({ mirror: !settings.mirror }),
      r: () => { if (scroll.current) scroll.current.scrollTop = 0; },
      Home: () => { if (scroll.current) scroll.current.scrollTop = 0; },
      f: () => {
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
    };
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  // Leaving the prompter leaves full screen with it.
  useEffect(() => () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  }, []);

  // Pressing a control keeps the keyboard on the script, so Space still
  // plays and pauses after a click.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  return (
    <Modal ariaLabel="Teleprompter" initialFocus={scroll} variant="screen" onClose={onClose}>
      <div
        className="wPrompter"
        style={{ "--p-size": `${settings.size}px` } as React.CSSProperties}
        data-playing={playing || undefined}
        data-idle={(playing && idle) || undefined}
        onKeyDown={onKeyDown}
      >
        <div className="wPrompterProgress" aria-hidden="true"><div ref={bar} /></div>
        <div
          ref={scroll}
          className="wPrompterScroll"
          data-mirror={settings.mirror || undefined}
          tabIndex={0}
          role="document"
          aria-label="Script"
          onScroll={onScroll}
          onClick={(event) => {
            // A link in the script is something to say, not somewhere to go.
            event.preventDefault();
            toggle();
          }}
        >
          <article className="wPrompterText" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <div className="wPrompterGuide" aria-hidden="true" />
        <div className="wPrompterBar" role="toolbar" aria-label="Teleprompter controls">
          <button type="button" data-primary onMouseDown={keepFocus} onClick={toggle}>{playing ? "Pause" : "Play"}</button>
          <div role="group" aria-label="Speed">
            <button type="button" aria-label="Slower" onMouseDown={keepFocus} onClick={() => change({ wpm: clamp(settings.wpm - WPM.step, WPM) })}>−</button>
            <output>{settings.wpm} wpm</output>
            <button type="button" aria-label="Faster" onMouseDown={keepFocus} onClick={() => change({ wpm: clamp(settings.wpm + WPM.step, WPM) })}>+</button>
          </div>
          <div role="group" aria-label="Text size">
            <button type="button" aria-label="Smaller text" onMouseDown={keepFocus} onClick={() => change({ size: clamp(settings.size - SIZE.step, SIZE) })}>−</button>
            <output>Size</output>
            <button type="button" aria-label="Larger text" onMouseDown={keepFocus} onClick={() => change({ size: clamp(settings.size + SIZE.step, SIZE) })}>+</button>
          </div>
          <button type="button" aria-pressed={settings.mirror} onMouseDown={keepFocus} onClick={() => change({ mirror: !settings.mirror })}>Mirror</button>
          <span className="wPrompterClock" role="timer" aria-label="Elapsed and total time">{clock(progress * seconds)} / {clock(seconds)}</span>
          <button type="button" onMouseDown={keepFocus} onClick={onClose}>Close</button>
        </div>
        {!playing && (
          <p className="wPrompterHint">Space to play · ↑ ↓ speed · ← → skip · M mirror · F full screen · Esc to close</p>
        )}
      </div>
    </Modal>
  );
}
