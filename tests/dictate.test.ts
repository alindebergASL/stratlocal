// SYNTHETIC ONLY.
//
// Dictation: the browser listens, the words land in the field. A stubbed
// recognizer stands in for the microphone, which a test runner has not got.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { Dictate, joinDictation } from "@/components/Dictate";

describe("joining what was said to what is there", () => {
  it("capitalises a first word, adds a space, and keeps a line the person started", () => {
    expect(joinDictation("", "send the sizing")).toBe("Send the sizing");
    expect(joinDictation("Call the CFO.", "then the CTO")).toBe("Call the CFO. then the CTO");
    expect(joinDictation("Notes:\n", "they want it by Friday")).toBe("Notes:\nthey want it by Friday");
    expect(joinDictation("Kept", "   ")).toBe("Kept");
  });
});

describe("the microphone button", () => {
  let root: Root;
  let container: HTMLElement;
  let last: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onresult: ((e: unknown) => void) | null; onend: (() => void) | null } | null = null;

  beforeEach(() => {
    const { window } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("navigator", { language: "en-GB" });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    last = null;
  });

  it("is not there when the browser cannot listen", async () => {
    await act(async () => root.render(React.createElement(Dictate, { onText: () => {} })));
    expect(container.querySelector('[data-testid="dictate"]')).toBeNull();
  });

  it("listens, adds what was said when it is final, and stops", async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror = null;
      start = vi.fn();
      stop = vi.fn(() => this.onend?.());
      constructor() {
        last = this as never;
      }
    };
    const heard: string[] = [];
    await act(async () => root.render(React.createElement(Dictate, { onText: (s: string) => heard.push(s) })));
    const button = container.querySelector('[data-testid="dictate"]') as HTMLButtonElement;
    await act(async () => button.click());
    expect(last!.start).toHaveBeenCalled();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await act(async () => last!.onresult!({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "send the" } }] }));
    expect(container.querySelector('[data-testid="dictate-interim"]')?.textContent).toBe("send the");
    await act(async () => last!.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "send the sizing" } }] }));
    expect(heard).toEqual(["send the sizing"]);
    await act(async () => button.click());
    expect(last!.stop).toHaveBeenCalled();
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });
});
