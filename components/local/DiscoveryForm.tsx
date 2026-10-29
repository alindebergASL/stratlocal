"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { field } from "@/lib/local/styles";
import type { SourceSelection } from "@/lib/local/sourcePicker";
import { discoveryTimestamp } from "@/lib/local/discoveryTime";
import { LocalForm } from "./Forms";

type SourceChoice = { id: string; filename: string; added: string };

function SourcePicker({ accountId, sources }: { accountId: string; sources: SourceChoice[] }) {
  const [artifactId, setArtifactId] = useState("");
  const [page, setPage] = useState(1);
  const [locator, setLocator] = useState("");
  const [quote, setQuote] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; data?: SourceSelection; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${accountId}:${artifactId}:${page}:${locator}`;
  const current = loaded?.key === key ? loaded : null;
  const data = current?.data;
  // Keep the list visible while the selected passage is loading, but never
  // show a preview from a previously selected file or location.
  const locations = loaded?.data?.artifactId === artifactId && loaded.data.page === page ? loaded.data.locations : [];
  useEffect(() => {
    if (!artifactId) return;
    const controller = new AbortController();
    let active = true;
    const query = new URLSearchParams({ accountId, page: String(page), locator });
    fetch(`/api/local/evidence/${encodeURIComponent(artifactId)}?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load this source");
        if (active) setLoaded({ key, data: body as SourceSelection });
      })
      .catch(error => { if (active && !controller.signal.aborted) setLoaded({ key, error: error instanceof Error ? error.message : "Could not load this source" }); });
    return () => { active = false; controller.abort(); };
  }, [accountId, artifactId, page, locator, key, retry]);

  return <fieldset className="space-y-3 rounded border border-line p-3">
    <legend className="font-semibold">Supporting evidence</legend>
    <label className="block">Source file
      <select className={field} name="artifactId" value={artifactId} required onChange={event => {
        setArtifactId(event.target.value); setPage(1); setLocator(""); setQuote(""); setLoaded(null);
      }}>
        <option value="">Choose an account source</option>
        {sources.map(source => <option key={source.id} value={source.id}>{source.filename} · added {source.added}</option>)}
      </select>
    </label>
    {!sources.length && <p>No linked evidence yet. <Link className="underline" href={`/accounts/${accountId}/evidence`}>Import and link a reference file</Link>, then return to this meeting. You can still save a proposed question or hypothesis.</p>}
    {!!artifactId && <>
      <label className="block">Page, slide, or section
        <select className={field} name="locator" value={locator} required disabled={!locations.length} onChange={event => {
          setLocator(event.target.value); setQuote("");
        }}>
          <option value="">Choose a source location</option>
          {locations.map(location => <option key={location.locator} value={location.locator}>{location.label} · {location.locator}</option>)}
        </select>
      </label>
      {!current && <p role="status">Loading source…</p>}
      {current?.error && <div role="alert"><p>{current.error}</p><button type="button" className="underline" onClick={() => { setLoaded(null); setRetry(value => value + 1); }}>Retry source preview</button></div>}
      {data && data.pages > 1 && <nav aria-label="Source location pages" className="flex flex-wrap gap-3 text-label">
        <span>Locations page {data.page} of {data.pages} · {data.totalLocations} readable locations</span>
        {data.page > 1 && <button type="button" className="underline" onClick={() => { setPage(data.page - 1); setLocator(""); setQuote(""); }}>Previous locations</button>}
        {data.page < data.pages && <button type="button" className="underline" onClick={() => { setPage(data.page + 1); setLocator(""); setQuote(""); }}>More locations</button>}
      </nav>}
      {data?.totalLocations === 0 && <p>No readable passages were extracted. Inspect the original, or import a readable transcript before recording a confirmation.</p>}
      {!!data?.warningCount && <div className="text-label"><p>Extraction notes:</p><ul className="list-disc pl-5">{data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>{data.warningCount > data.warnings.length && <p>Open the full source for all {data.warningCount} notes.</p>}</div>}
      {data?.preview && <div className="space-y-2">
        <h4 className="font-semibold">Source passage</h4>
        <pre className="whitespace-pre-wrap break-words max-h-80 overflow-y-auto rounded border border-line p-3 text-label" data-testid="source-passage">{data.preview.text}</pre>
        {data.preview.truncated && <p className="text-label">Showing the first {data.preview.text.length.toLocaleString()} of {data.preview.fullLength.toLocaleString()} characters. Open the full source for the rest.</p>}
      </div>}
      <Link className="underline" href={`/evidence/${encodeURIComponent(artifactId)}${locator ? `#${encodeURIComponent(locator)}` : ""}`} target="_blank" rel="noopener noreferrer">Open full source in a new tab</Link>
    </>}
    <label className="block">Exact source quotation
      <textarea className={field} name="quote" required maxLength={1000} value={quote} onChange={event => setQuote(event.target.value)} />
    </label>
    <p className="text-label">Copy a short exact quotation from the selected passage, up to 1,000 characters. The app checks the quotation against the saved source when you save.</p>
  </fieldset>;
}

export function DiscoveryForm({ accountId, meetingId, sources }: { accountId: string; meetingId: string; sources: SourceChoice[] }) {
  const [state, setState] = useState("question");
  const [localTime, setLocalTime] = useState("");
  const [zone, setZone] = useState("");
  useEffect(() => { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone); }, []);
  const confirmedAt = discoveryTimestamp(localTime) ?? "";
  return <LocalForm operation="confirmation" label="Save discovery record">
    <input type="hidden" name="accountId" value={accountId} />
    <input type="hidden" name="meetingId" value={meetingId} />
    <label className="block">Record type
      <select className={field} name="state" value={state} onChange={event => setState(event.target.value)}>
        <option value="question">Proposed question</option>
        <option value="hypothesis">Hypothesis</option>
        <option value="confirmed">Customer-confirmed answer</option>
      </select>
    </label>
    <label className="block">Question
      <input className={field} name="question" required maxLength={4000} />
    </label>
    <label className="block">Answer / hypothesis
      <textarea className={field} name="answer" required={state === "confirmed"} maxLength={4000} />
    </label>
    {state === "confirmed" ? <>
      <p>Record what the customer actually confirmed. Imported research, seller interpretations, and proposed questions are not customer confirmation.</p>
      <label className="block">Speaker
        <input className={field} name="speaker" required maxLength={200} />
      </label>
      <label className="block">Confirmation time
        <input className={field} type="datetime-local" name="confirmationLocal" value={localTime} onChange={event => {
          const value = event.target.value;
          setLocalTime(value);
          event.target.setCustomValidity(value && !discoveryTimestamp(value) ? "Choose a valid local date and time. This time may fall in a daylight-saving clock change." : "");
        }} required />
      </label>
      <p className="text-label">Time uses your browser timezone{zone ? ` (${zone})` : ""} and is saved with a timezone.</p>
      <input type="hidden" name="confirmedAt" value={confirmedAt} />
      <SourcePicker accountId={accountId} sources={sources} />
    </> : <p className="text-label">This stays a {state === "question" ? "proposed question" : "hypothesis"} until you explicitly record a sourced, customer-confirmed answer.</p>}
  </LocalForm>;
}
