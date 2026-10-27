import Link from "next/link";

// notFound() is called from six pages. Without this it rendered Next's default
// 404, which is black-on-white Helvetica and looks like the app is broken
// rather than like the record is gone.
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-faint">Not found</p>
      <h1 className="mt-2 font-display text-title font-bold text-ink-strong">That record isn&rsquo;t here.</h1>
      <p className="mt-3 text-body text-ink">
        It may have been archived, or the link may be from before it was renamed. Archived records are listed at the foot of
        the account they belong to, with a Restore button.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-label font-semibold text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Back to Today
      </Link>
    </main>
  );
}
