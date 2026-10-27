import { headers } from "next/headers";
import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { backupCheck, budgetChecks, clockChecks, databaseChecks, originChecks, mailChecks, providerChecks, type SetupCheck, schedulerChecks } from "@/lib/setup";
import { Page } from "@/components/Nav";
import { Chip, Empty, PageHeader, Section } from "@/components/ui";
import { ProviderCheck } from "@/components/ProviderCheck";

export const dynamic = "force-dynamic";

// Is this deployment actually wired up?
//
// None of this has ever met real AWS and no model call has been made against a
// real provider, so the first hour after the first deploy is where it goes
// wrong — and every one of those failures reads as "the button is broken". One
// page with a verdict per dependency, safe to open any time: a rotated key, a
// changed bucket policy and a rebuilt instance all show up here first.
const TONE = { ok: "positive", warn: "warning", bad: "danger" } as const;
const WORD = { ok: "ok", warn: "check", bad: "not working" } as const;

function Checks({ checks }: { checks: SetupCheck[] }) {
  if (checks.length === 0) return <Empty>Nothing to check here.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {checks.map((c) => (
        <li key={c.label} className="py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-medium text-ink">{c.label}</span>
            <span className="flex items-baseline gap-2">
              {c.value && <span className="break-all text-micro tabular-nums text-ink-muted">{c.value}</span>}
              <Chip tone={TONE[c.state]}>{WORD[c.state]}</Chip>
            </span>
          </div>
          {c.detail && <p className="mt-1 max-w-prose whitespace-pre-line text-micro text-ink-muted">{c.detail}</p>}
        </li>
      ))}
    </ul>
  );
}

function worst(checks: SetupCheck[]): "ok" | "warn" | "bad" {
  if (checks.some((c) => c.state === "bad")) return "bad";
  if (checks.some((c) => c.state === "warn")) return "warn";
  return "ok";
}

export default async function SetupPage() {
  const user = await requirePageUser();
  const h = await headers();
  const database = databaseChecks();
  const clock = clockChecks();
  const budget = budgetChecks();
  const providers = providerChecks();
  const scheduler = schedulerChecks();
  const mail = mailChecks();
  const origins = originChecks(h.get("host"), h.get("x-forwarded-host"));
  // The only check that talks to anything outside this process.
  const backup = await backupCheck();
  const all = [...database, ...clock, ...budget, ...providers, ...scheduler, ...mail, ...origins, backup];
  const state = worst(all);

  return (
    <Page user={user}>
      <PageHeader
        title="Setup"
        sub={
          state === "ok"
            ? "Everything this deployment depends on is answering."
            : `${all.filter((c) => c.state !== "ok").length} of ${all.length} checks want attention.`
        }
      />

      <Section title="The database and the files" aside={<Chip tone={TONE[worst(database)]}>{WORD[worst(database)]}</Chip>}>
        <Checks checks={database} />
      </Section>

      <Section title="What day it is" aside={<Chip tone={TONE[worst(clock)]}>{WORD[worst(clock)]}</Chip>}>
        <Checks checks={clock} />
      </Section>

      <Section title="Providers" aside={<Chip tone={TONE[worst(providers)]}>{WORD[worst(providers)]}</Chip>}>
        <Checks checks={providers} />
        {/* Configuration is not the same as a provider answering, and the
            difference is the whole point of pressing this. */}
        <div className="mt-3">
          <ProviderCheck />
        </div>
      </Section>

      <Section title="Money" aside={<Chip tone={TONE[worst(budget)]}>{WORD[worst(budget)]}</Chip>}>
        <Checks checks={budget} />
      </Section>

      <Section title="Running on its own" aside={<Chip tone={TONE[worst(scheduler)]}>{WORD[worst(scheduler)]}</Chip>}>
        <Checks checks={scheduler} />
      </Section>

      <Section title="Mail and calendars" aside={<Chip tone={TONE[worst(mail)]}>{WORD[worst(mail)]}</Chip>}>
        <Checks checks={mail} />
      </Section>

      <Section title="Behind the proxy" aside={<Chip tone={TONE[worst(origins)]}>{WORD[worst(origins)]}</Chip>}>
        <Checks checks={origins} />
      </Section>

      <Section title="Backup" aside={<Chip tone={TONE[backup.state]}>{WORD[backup.state]}</Chip>}>
        <Checks checks={[backup]} />
        <p className="mt-2 max-w-prose text-micro text-ink-muted">
          Read from S3 rather than from anything this app writes down, so it is true even when the backup container has been failing quietly. The
          restore drill is in <span className="font-mono">deploy/README.md</span> — a backup nobody has restored is a hope, not a backup.
        </p>
      </Section>

      <p className="text-micro text-ink-muted">
        <Link href="/" className="text-accent hover:underline">
          Back to today
        </Link>
      </p>
    </Page>
  );
}
