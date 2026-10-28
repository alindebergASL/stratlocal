"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { field, button } from "@/lib/local/styles";
export function LocalForm({
  operation,
  children,
  label = "Save",
}: {
  operation: string;
  children: React.ReactNode;
  label?: string;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        const fd = new FormData(e.currentTarget),
          body: Record<string, unknown> = { operation };
        for (const key of new Set(fd.keys())) {
          const values = fd.getAll(key);
          body[key] =
            key === "artifactIds"
              ? values
              : values.length > 1
                ? values
                : values[0];
        }
        try {
          const res = await fetch("/api/local/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          setMessage(data.message ?? "Saved");
          if (data.href) router.push(data.href);
          router.refresh();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Request failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <button disabled={busy} className={button}>
        {busy ? "Working…" : label}
      </button>
      {message && (
        <p role="status" className="text-label">
          {message}
        </p>
      )}
    </form>
  );
}
export function PackageUpload({ accountId }: { accountId?: string }) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const res = await fetch("/api/local/import", {
            method: "POST",
            body: new FormData(e.currentTarget),
          });
          const b = await res.json();
          if (!res.ok) throw new Error(b.error);
          router.push(b.href);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Upload failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {accountId && <input type="hidden" name="accountId" value={accountId} />}
      <label className="block text-label">
        MyAgent package or reference file
        <input
          className={field}
          type="file"
          name="file"
          required
          accept=".zip,.json,.pdf,.pptx,.docx,.html,.htm,.md,.txt"
        />
      </label>
      <p className="text-micro text-ink-muted">
        Up to 25 MB. ZIP packages need manifest.json and originals. Nothing is
        applied automatically.
      </p>
      <button className={button} disabled={busy}>
        {busy ? "Uploading…" : "Import for review"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function RefreshJobs({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
export function CopyText({ text }: { text: string }) {
  const [message, setMessage] = useState("Copy request");
  return (
    <button
      className={button}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setMessage("Copied");
        } catch {
          setMessage("Select and copy the text below");
        }
      }}
    >
      {message}
    </button>
  );
}
