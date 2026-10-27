import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { requirePageUser } from "@/lib/auth";
import { normOwner, ownerChoices, ownerNames, ownerSpellings, ownerSuggestions } from "@/lib/dealOwners";
import { confirmOwnerAction, separateOwnerAction } from "@/app/ownerActions";
import { Page } from "@/components/Nav";
import { ActionForm } from "@/components/ActionForm";
import { control, Field, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

// Deal owners, one per person.
//
// The CRM report writes a deal's owner as free text, so one person arrives as
// "Jamie", "Jamie L." and "Jamie Lee". Nothing here rewrites a deal: the
// spelling stays as the report wrote it, and this page says which spellings
// are one name — which the pipeline's filter, its rows and the account's deal
// list then read. The suggestions are pairs the app can see are almost
// certainly one person; it never applies one itself.
export default async function OwnersPage() {
  const user = await requirePageUser();
  const spellings = ownerSpellings();
  const { nameOf } = ownerNames();
  const names = ownerChoices();
  const suggestions = ownerSuggestions();
  const grouped = names.map((name) => ({
    name,
    rows: spellings.filter((s) => normOwner(nameOf(s.spelling) ?? "") === normOwner(name)),
  }));

  return (
    <Page user={user}>
      <BackLink fallback="/pipeline" fallbackLabel="Pipeline" />
      <PageHeader title="Deal owners" sub="Which spellings are the same person." />

      {suggestions.length > 0 && (
        <Section title="Probably the same person" aside={<span>{suggestions.length}</span>}>
          <ul className="divide-y divide-line" data-testid="owner-suggestions">
            {suggestions.map((s) => (
              <li key={s.spelling} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <p className="text-label">
                  <span className="font-semibold text-ink-strong">{s.spelling}</span> reads as <span className="font-semibold text-ink-strong">{s.name}</span>
                </p>
                <ActionForm action={confirmOwnerAction.bind(null, s.spelling)} trigger="Same person" submitLabel="Confirm" testId={`owner-suggest-${normOwner(s.spelling).replace(/[^a-z0-9]+/g, "-")}`}>
                  <input type="hidden" name="name" value={s.name} />
                  <p className="basis-full text-label">Deals owned by &ldquo;{s.spelling}&rdquo; will show and filter as {s.name}. The deals keep the text the report wrote.</p>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Owners" aside={<span>{names.length}</span>}>
        {grouped.length === 0 ? (
          <p className="text-label text-ink-muted">No deal names an owner yet.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="owner-list">
            {grouped.map((g) => (
              <li key={g.name} className="py-3">
                <p className="font-semibold text-ink-strong">
                  {g.name} <span className="font-normal text-label text-ink-muted">· {g.rows.reduce((n, r) => n + r.deals, 0)} deal{g.rows.reduce((n, r) => n + r.deals, 0) === 1 ? "" : "s"}</span>
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {g.rows.map((r) => {
                    const own = normOwner(r.spelling) === normOwner(g.name);
                    const others = names.filter((n) => normOwner(n) !== normOwner(g.name));
                    return (
                      <li key={r.spelling} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-label">
                        <span className="text-ink">&ldquo;{r.spelling}&rdquo;</span>
                        <span className="text-micro text-ink-muted">{r.deals} deal{r.deals === 1 ? "" : "s"}</span>
                        {!own && (
                          <ActionForm action={separateOwnerAction.bind(null, r.spelling)} trigger="Not the same" submitLabel="Separate" testId="owner-separate">
                            <p className="basis-full text-label">&ldquo;{r.spelling}&rdquo; will show as itself again.</p>
                          </ActionForm>
                        )}
                        {others.length > 0 && (
                          <ActionForm action={confirmOwnerAction.bind(null, r.spelling)} trigger="Same as…" submitLabel="Confirm" testId="owner-same-as">
                            <Field label={`“${r.spelling}” is`}>
                              <select name="name" required defaultValue="" className={control}>
                                <option value="" disabled>Choose a name</option>
                                {others.map((n) => (
                                  <option key={n} value={n}>{n}</option>
                                ))}
                              </select>
                            </Field>
                          </ActionForm>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
