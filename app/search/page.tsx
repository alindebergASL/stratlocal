import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { KIND_LABELS, narrowKind, search } from "@/lib/queries/search";
import { Page } from "@/components/Nav";
import { AccountLink, Button, control, Empty, Eyebrow, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const user = await requirePageUser();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const only = narrowKind(params.kind);
  const groups = q.length >= 2 ? search(q, only) : [];
  const total = groups.reduce((n, g) => n + g.hits.length + g.more, 0);

  return (
    <Page user={user}>
      <PageHeader
        title={q ? `“${q}”` : "Search"}
        sub={
          q.length >= 2
            ? `${total} match${total === 1 ? "" : "es"}${only ? ` in ${KIND_LABELS[only].toLowerCase()}` : " across every account"}`
            : undefined
        }
      />
      {only && (
        <p className="mb-3 text-label">
          <Link href={`/search?q=${encodeURIComponent(q)}`} className="text-accent hover:underline">
            ← everything matching “{q}”
          </Link>
        </p>
      )}
      <Section title="Everything">
        {/* Wraps: this was a fixed 384px input beside a button in a row that
            could not wrap, which alone forced horizontal scroll on a phone. */}
        <form method="get" className="mb-4 flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={q}
            autoFocus
            placeholder="A deal id, a person, or something that was said in a meeting"
            className={`${control} min-w-0 flex-1 sm:max-w-96`}
          />
          <Button type="submit">Search</Button>
        </form>

        {q.length === 0 && (
          <Empty>
            Search every account at once: a deal by name or id, a person by name or email, a play, a follow-up — and what was
            actually said, since meeting notes, summaries and accepted research findings are searched too.
          </Empty>
        )}
        {q.length > 0 && q.length < 2 && <Empty>Type at least two characters.</Empty>}
        {q.length >= 2 && groups.length === 0 && <Empty>Nothing matches. Archived records are not searched.</Empty>}

        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.kind}>
              <Eyebrow className="mb-1">{group.label}</Eyebrow>
              <ul className="divide-y divide-line">
                {group.hits.map((hit, i) => (
                  <li key={`${hit.kind}-${hit.href}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
                    <span className="min-w-0">
                      <Link href={hit.href} className="font-medium text-ink hover:text-accent hover:underline">
                        {hit.label}
                      </Link>
                      {hit.detail && <span className="ml-2 text-micro text-ink-muted">{hit.detail}</span>}
                    </span>
                    {hit.kind !== "account" && <AccountLink id={hit.accountId} name={hit.accountName} className="text-label" />}
                  </li>
                ))}
              </ul>
              {group.more > 0 && (
                <p className="mt-1 text-micro">
                  <Link href={`/search?q=${encodeURIComponent(q)}&kind=${group.kind}`} className="text-accent hover:underline">
                    and {group.more} more in {group.label.toLowerCase()}
                  </Link>
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>
    </Page>
  );
}
