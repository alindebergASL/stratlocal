"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attempt, type ActionResult } from "@/components/attempt";
import { Button } from "@/components/ui";

export function DismissButton({ dismiss, label = "Got it" }: { dismiss: () => Promise<ActionResult>; label?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        data-testid="notice-dismiss"
        onClick={() =>
          start(async () => {
            const r = await attempt(dismiss);
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        {label}
      </Button>
      {error && <span role="alert" className="text-micro text-danger">{error}</span>}
    </span>
  );
}
