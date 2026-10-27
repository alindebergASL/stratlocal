// What a page looks like while it loads: the same shell, with soft blocks
// where the content will be, so nothing jumps when it arrives.
export function Bar({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-surface-sunk ${className}`} />;
}

export function PageSkeleton({ kind = "page" }: { kind?: "page" | "account" | "list" }) {
  return (
    <div className="lg:flex" data-testid="page-skeleton" aria-busy="true" aria-label="Loading">
      <div className="hidden lg:block lg:h-dvh lg:w-60 lg:shrink-0 lg:border-r lg:border-line lg:bg-paper" />
      <main className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 lg:px-10 lg:py-10">
        {kind === "account" && (
          <>
            <Bar className="h-3 w-20" />
            <Bar className="mt-2 h-8 w-72" />
            <div className="mt-4 flex gap-3">
              {Array.from({ length: 5 }, (_, i) => <Bar key={i} className="h-6 w-20" />)}
            </div>
          </>
        )}
        {kind !== "account" && <Bar className="h-8 w-56" />}
        <div className="mt-6 space-y-4">
          {Array.from({ length: kind === "list" ? 6 : 3 }, (_, i) => (
            <div key={i} className="rounded-xl border border-line bg-surface p-5">
              <Bar className="h-4 w-40" />
              <Bar className="mt-3 h-3 w-full" />
              <Bar className="mt-2 h-3 w-4/5" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
