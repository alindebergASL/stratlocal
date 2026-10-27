// A synthetic report only.
import { expect, it } from "vitest";
import JSZip from "jszip";
import { reportDeck, slidePoints } from "@/lib/ask/deck";

const REPORT = {
  title: "Synthetic outcome readout",
  summary: "Two outcomes named; a workshop proposed for next month.",
  accountName: "Synthetic Orchard Lab",
  generatedBy: "Synthetic User",
  generatedAt: "2026-10-23T12:00:00Z",
  sections: [
    { heading: "What we heard", body: "They want faster permit triage [1]. Staff time is the constraint [2]. **Security** must sign off first." },
    { heading: "Where we can help", body: "- Start with the intake queue\n- Measure time to first response\n- Review where it should run" },
    {
      heading: "Pipeline",
      body: "Two deals are open.",
      chart: { kind: "pipeline_by_stage" as never, title: "Open pipeline by stage", unit: "usd" as const, rows: [{ label: "Stage 2", value: 120000, detail: null }, { label: "Stage 4", value: 80000, detail: null }], note: null, asOf: "2026-10-23" },
    },
  ],
  sources: [{ n: 1, label: "Discovery call", account: "Synthetic Orchard Lab" }, { n: 2, label: "Synthetic research note", account: null }],
};

it("says a section's points on the slide without citation markers", () => {
  expect(slidePoints(REPORT.sections[0]!.body)).toEqual(["They want faster permit triage.", "Staff time is the constraint.", "Security must sign off first."]);
  expect(slidePoints(REPORT.sections[1]!.body)).toHaveLength(3);
  expect(slidePoints(Array.from({ length: 10 }, (_, i) => `- Point ${i}`).join("\n"))).toHaveLength(6);
});

it("builds a 16:9 deck with a slide per section, speaker notes, a native chart and the sources", async () => {
  const buf = await reportDeck(REPORT);
  const zip = await JSZip.loadAsync(buf);
  const files = Object.keys(zip.files);
  const slides = files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  expect(slides).toHaveLength(5); // cover, three sections, sources
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  expect(presentation).toContain('cx="9144000" cy="5143500"'); // 16:9
  const notes = await Promise.all(files.filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")));
  expect(notes.some((n) => n.includes("They want faster permit triage [1]"))).toBe(true);
  expect(files.some((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f))).toBe(true);
  const slide2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
  expect(slide2).toContain("What we heard");
  expect(slide2).not.toContain("[1]");
  const last = await zip.file(`ppt/slides/slide5.xml`)!.async("string");
  expect(last).toContain("[1] Discovery call (Synthetic Orchard Lab)");
});
