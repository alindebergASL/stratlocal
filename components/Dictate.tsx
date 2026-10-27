"use client";

// Speak instead of type: a microphone button that uses the browser's own
// speech recognition and adds what you say to a field — a question for Ask,
// or a meeting's notes in the car park after the call.
//
// Nothing new on the server (DECISIONS #56): the browser does the listening,
// and the text lands in the field like typing, to be read and saved as usual.
// Shown only where the browser can do it; otherwise there is no button at all.
import { useEffect, useRef, useState } from "react";
import { buttonClass, type ControlSize } from "./ui";

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognizer(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** What was said, added to what is there: after a space, or on the new line the person started. */
export function joinDictation(existing: string, said: string): string {
  const add = said.trim();
  if (!add) return existing;
  if (!existing.trim()) return add[0]!.toUpperCase() + add.slice(1);
  // A line break the person typed is kept; otherwise one space.
  return /\n$/.test(existing) ? `${existing}${add}` : `${existing.trimEnd()} ${add}`;
}

export function Dictate({
  onText,
  disabled = false,
  label = "Dictate",
  testId = "dictate",
  size = "sm",
}: {
  onText: (said: string) => void;
  disabled?: boolean;
  label?: string;
  testId?: string;
  size?: ControlSize;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const emit = useRef(onText);
  emit.current = onText;

  useEffect(() => {
    setSupported(recognizer() !== null);
    return () => rec.current?.stop();
  }, []);
  if (!supported) return null;

  function start() {
    const Ctor = recognizer();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) emit.current(res[0].transcript);
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => setError(e.error === "not-allowed" ? "The browser was not allowed to use the microphone." : "Dictation stopped.");
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2" data-print-hide>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={listening}
        onClick={() => (listening ? rec.current?.stop() : start())}
        className={`${buttonClass("quiet", size)} ${listening ? "!border-danger-line !bg-danger-soft !text-danger" : ""}`}
        data-testid={testId}
      >
        <svg aria-hidden viewBox="0 0 24 24" className={`size-4 ${listening ? "animate-pulse" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        {listening ? "Stop" : label}
      </button>
      {listening && (
        <span className="min-w-0 truncate text-micro text-ink-muted" aria-live="polite" data-testid={`${testId}-interim`}>
          {interim || "Listening…"}
        </span>
      )}
      {error && <span role="alert" className="text-micro text-danger">{error}</span>}
    </span>
  );
}
