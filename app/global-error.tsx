"use client";

// The last resort: a throw in the root layout itself, where app/error.tsx has
// no chrome to render into. This replaces <html> wholesale, so it cannot use
// the app's fonts or tokens and is styled inline on purpose.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: "4rem 1rem", fontFamily: "system-ui, sans-serif", color: "#1a1b33" }}>
        <div style={{ maxWidth: "42rem", margin: "0 auto" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>The app failed to start this page.</h1>
          <pre
            style={{
              marginTop: "1.25rem",
              padding: "0.75rem",
              background: "#fdf2f2",
              border: "1px solid #f0c8c8",
              borderRadius: "0.5rem",
              fontSize: "0.8125rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error.message || error.name || "No message."}
            {error.digest ? `\n\ndigest ${error.digest}` : ""}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.375rem 0.75rem",
              background: "#4338ca",
              color: "white",
              border: 0,
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
