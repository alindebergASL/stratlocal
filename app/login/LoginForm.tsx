"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, control, Field } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Sign-in failed");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
      <Field label="Email">
        <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={control} />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={control} />
      </Field>
      {error && (
        <p role="alert" className="text-label font-medium text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} aria-busy={busy} className="mt-2 justify-center py-2">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
