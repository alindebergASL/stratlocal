"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

type Preview = { ok: true; lines: string[]; problems: string[] } | { ok: false; error: string };

// Choose a team pack, read what it holds and would change, then load it.
export function PackLoader({ preview, apply }: { preview: (text: string) => Promise<Preview>; apply: (text: string) => Promise<{ ok: true; message: string } | { ok: false; error: string }> }) {
  const router = useRouter();
  const [text, setText] = useState<string | null>(null);
  const [shown, setShown] = useState<Preview | null>(null);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3" data-testid="pack-loader">
      <input
        type="file"
        accept="application/json,.json"
        className="w-full max-w-full text-label"
        data-testid="pack-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setDone(null);
          if (!f) return;
          const t = await f.text();
          setText(t);
          start(async () => setShown(await preview(t)));
        }}
      />
      {shown && !shown.ok && <p role="alert" className="text-label text-danger">{shown.error}</p>}
      {shown?.ok && (
        <div className="rounded-lg border border-line p-3" data-testid="pack-preview">
          <p className="text-label font-semibold text-ink-strong">This pack would change:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-label text-ink">
            {shown.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
          {shown.problems.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-micro text-danger">
              {shown.problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <Button
            className="mt-3"
            size="sm"
            disabled={pending || !text}
            data-testid="pack-apply"
            onClick={() =>
              start(async () => {
                const r = await apply(text!);
                setDone(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
                if (r.ok) {
                  setShown(null);
                  router.refresh();
                }
              })
            }
          >
            Load it
          </Button>
        </div>
      )}
      {done && <p role={done.ok ? "status" : "alert"} className={`text-label ${done.ok ? "text-positive" : "text-danger"}`}>{done.text}</p>}
    </div>
  );
}
