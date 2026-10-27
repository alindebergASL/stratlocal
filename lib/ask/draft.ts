// The answer while it is still being written.
//
// The answer arrives as the input of a final_answer tool call, streamed as
// JSON a few characters at a time. This reads the "text" field out of JSON
// that is not finished yet — up to the last whole character — so the page can
// show the answer growing. It is a preview only: the answer that is kept is
// the finished, checked one.
export function readPartialText(json: string): string | null {
  const m = /"text"\s*:\s*"/.exec(json);
  if (!m) return null;
  let out = "";
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const ch = json[i]!;
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = json[i + 1];
    if (next === undefined) return out;
    if (next === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ({ n: "\n", t: "\t", r: "", b: "", f: "", '"': '"', "\\": "\\", "/": "/" } as Record<string, string>)[next] ?? next;
    i += 1;
  }
  return out;
}
