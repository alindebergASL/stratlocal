"use client";

import { Button } from "./ui";

// The browser's own print, which is also its Save as PDF: the box has no
// server-side browser, and a person's own print dialog is the better PDF.
export function PrintButton({ label = "Save as PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="quiet" size="sm" onClick={() => window.print()} data-testid="print">
      {label}
    </Button>
  );
}
