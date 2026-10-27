"use client";

// The presses on Close the day: a loose end given a day or let go, drafting
// the note, and sending it. Each is the ordinary save underneath.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveRecord, saveActionItem } from "@/app/actions";
import { attempt, type ActionResult } from "@/components/attempt";
import { Button } from "@/components/ui";
import { draftCloseNoteAction, sendCloseNoteAction } from "./actions";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (run: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await attempt(run);
      if (!r.ok) return setError(r.error);
      after?.();
      router.refresh();
    });
  return { pending, error, act };
}

export function LooseEndControls({ id, accountId, text, version, tomorrow }: { id: string; accountId: string; text: string; version: number; tomorrow: string }) {
  const { pending, error, act } = useAct();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="quiet"
        disabled={pending}
        data-testid="close-give-a-day"
        onClick={() =>
          act(() => {
            const fd = new FormData();
            fd.set("text", text);
            fd.set("due", tomorrow);
            fd.set("base_version", String(version));
            return saveActionItem(accountId, id, fd);
          })
        }
      >
        Give it a day
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} data-testid="close-drop" onClick={() => act(() => archiveRecord("action_item", id))}>
        Drop it
      </Button>
      {error && <span role="alert" className="text-micro text-danger">{error}</span>}
    </span>
  );
}

export function DraftNote({ again = false }: { again?: boolean }) {
  const { pending, error, act } = useAct();
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={again ? "quiet" : "primary"} disabled={pending} onClick={() => act(() => draftCloseNoteAction())} data-testid="close-draft">
        {pending ? "Starting…" : again ? "Draft it again" : "Draft the note"}
      </Button>
      {error && <span role="alert" className="text-micro text-danger">{error}</span>}
    </span>
  );
}

export function SendNote({ threadId, partner }: { threadId: string; partner: string }) {
  const { pending, error, act } = useAct();
  const [sent, setSent] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending || sent} onClick={() => act(() => sendCloseNoteAction(threadId), () => setSent(true))} data-testid="close-send">
        {sent ? (partner === "the team" ? "On the team's Today" : `On ${partner}'s Today`) : `Send to ${partner}`}
      </Button>
      {error && <span role="alert" className="text-micro text-danger">{error}</span>}
    </span>
  );
}
