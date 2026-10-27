import { describe, expect, it } from "vitest";
import { harvestUrls, urlKey } from "@/lib/ai/runWebResearch";
import { tidyFindingText } from "@/lib/research/extract";

// These are the shapes the API actually returns, written out by hand so the
// test does not need a network or a model. Field names match the SDK types in
// @anthropic-ai/sdk/resources/messages.
type Block = Record<string, unknown>;

function searchResult(...urls: string[]): Block {
  return {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_1",
    content: urls.map((url) => ({ type: "web_search_result", url, title: "t", encrypted_content: "x", page_age: null })),
  };
}

function searchError(code: string): Block {
  return { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_search_tool_result_error", error_code: code } };
}

function fetchResult(url: string): Block {
  return {
    type: "web_fetch_tool_result",
    tool_use_id: "srvtoolu_2",
    content: { type: "web_fetch_result", url, retrieved_at: "2026-09-12T00:00:00Z", content: { type: "document", source: { type: "text", data: "…" } } },
  };
}

function fetchError(code: string): Block {
  return { type: "web_fetch_tool_result", tool_use_id: "srvtoolu_2", content: { type: "web_fetch_tool_result_error", error_code: code } };
}

function textWithCitation(url: string): Block {
  return {
    type: "text",
    text: "Something was published.",
    citations: [{ type: "web_search_result_location", url, title: "t", cited_text: "…", encrypted_index: "x" }],
  };
}

function use(name: string): Block {
  return { type: "server_tool_use", id: "srvtoolu_1", name, input: {} };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const harvest = (blocks: Block[], into: Map<string, string>) => harvestUrls(blocks as any, into);

describe("urlKey", () => {
  it("rejects anything that is not a web page", () => {
    // These would be stored and rendered as an href, so they never get in.
    expect(urlKey("javascript:alert(1)")).toBeNull();
    expect(urlKey("data:text/html,<script>1</script>")).toBeNull();
    expect(urlKey("file:///etc/passwd")).toBeNull();
    expect(urlKey("not a url")).toBeNull();
  });

  it("treats these as the same page", () => {
    const same: Array<[string, string]> = [
      ["https://example.com/a", "https://example.com/a/"],
      ["https://example.com/a", "https://example.com/a#:~:text=quoted%20span"],
      ["https://example.com/a", "https://example.com/a?utm_source=news&utm_campaign=x"],
      ["https://example.com/a?b=2&c=3", "https://example.com/a?c=3&b=2"],
      ["https://example.com/a", "https://WWW.EXAMPLE.COM/a"],
      // A search result and a citation of the same page often differ only by
      // the scheme, so the scheme is not part of the key.
      ["http://example.com/a", "https://example.com/a"],
    ];
    for (const [x, y] of same) expect(urlKey(x), `${x} vs ${y}`).toBe(urlKey(y));
  });

  it("keeps pages apart when the path differs in case or content", () => {
    expect(urlKey("https://example.com/a")).not.toBe(urlKey("https://example.com/A"));
    expect(urlKey("https://example.com/a")).not.toBe(urlKey("https://example.com/b"));
    expect(urlKey("https://example.com/a?id=1")).not.toBe(urlKey("https://example.com/a?id=2"));
  });
});

describe("harvestUrls", () => {
  it("keeps a URL seen only in the first turn of a paused run", () => {
    // The trap this test exists for: a continuation's message holds only its
    // own tool results, so harvesting from the final message alone loses
    // everything the first turn found.
    const sources = new Map<string, string>();
    harvest([use("web_search"), searchResult("https://example.com/turn-one")], sources);
    harvest([use("web_search"), searchResult("https://example.com/turn-two")], sources);
    expect([...sources.values()].sort()).toEqual(["https://example.com/turn-one", "https://example.com/turn-two"]);
  });

  it("reads search results, fetch results and citations", () => {
    const sources = new Map<string, string>();
    const counted = harvest(
      [use("web_search"), searchResult("https://example.com/a"), use("web_fetch"), fetchResult("https://example.com/b"), textWithCitation("https://example.com/c")],
      sources,
    );
    expect([...sources.values()].sort()).toEqual(["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
    expect(counted).toMatchObject({ searches: 1, fetches: 1, exhausted: false });
  });

  it("stores the URL the tool returned, not a later spelling of it", () => {
    const sources = new Map<string, string>();
    harvest([searchResult("https://example.com/a?utm_source=news")], sources);
    // A citation of the same page arrives clean; the first spelling stands,
    // and either way the stored string came from a tool.
    harvest([textWithCitation("https://example.com/a")], sources);
    expect([...sources.values()]).toEqual(["https://example.com/a?utm_source=news"]);
    expect(sources.has(urlKey("https://example.com/a") as string)).toBe(true);
  });

  it("survives tool errors and reports an exhausted budget", () => {
    const sources = new Map<string, string>();
    const counted = harvest([searchError("max_uses_exceeded"), fetchError("url_not_in_prior_context")], sources);
    expect(sources.size).toBe(0);
    expect(counted.exhausted).toBe(true);
  });

  it("ignores a hostile URL a page tried to hand back", () => {
    const sources = new Map<string, string>();
    harvest([searchResult("javascript:alert(1)", "https://example.com/ok")], sources);
    expect([...sources.values()]).toEqual(["https://example.com/ok"]);
  });
});

describe("a finding says its fact once", () => {
  it("strips the URL and the confidence label the fields already carry", () => {
    expect(tidyFindingText("They opened a second site in Reno. (Confidence: high) Source: https://example.com/pr/123")).toBe(
      "They opened a second site in Reno.",
    );
    expect(tidyFindingText("Confidence: medium. A capital plan runs to 2029, see https://example.com/plan.")).toBe(
      "A capital plan runs to 2029.",
    );
    expect(tidyFindingText("They named a new CIO in May https://example.com/a")).toBe("They named a new CIO in May");
  });

  it("leaves a clean sentence alone", () => {
    const clean = "The board approved a three-year modernisation programme in March.";
    expect(tidyFindingText(clean)).toBe(clean);
  });

  it("keeps the original rather than emptying a finding", () => {
    // Nothing but a URL: stripping it would store a blank fact, so the
    // original stands and a person can see what the model did.
    expect(tidyFindingText("https://example.com/a")).toBe("https://example.com/a");
  });
});
