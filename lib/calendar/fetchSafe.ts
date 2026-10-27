// Fetching a calendar link a person pasted. The server makes the request, so
// it must not become a way to reach inside the box: https only (webcal is
// https by another name), no address on a private or local network, no
// redirect that leaves those rules, and a size and time limit.
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export const MAX_FEED_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export class FeedError extends Error {}

export function normaliseFeedUrl(raw: string): URL {
  let text = raw.trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new FeedError("That is not a link. Paste the calendar's iCal (.ics) address.");
  }
  const local = process.env.CALENDAR_ALLOW_PRIVATE_URLS === "1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new FeedError("Only https:// (or webcal://) calendar links can be read.");
  if (url.username || url.password) throw new FeedError("A calendar link with a password in it cannot be used.");
  return url;
}

// Every range that is not the public internet. BlockList also matches an
// IPv4-mapped IPv6 address against the IPv4 ranges, in either spelling
// ("::ffff:127.0.0.1" or "::ffff:7f00:1"), which a hand-written prefix check
// missed.
const PRIVATE = (() => {
  const list = new BlockList();
  for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) list.addSubnet(net, bits, "ipv4");
  // ::/96 is IPv4-compatible (and holds :: and ::1); 64:ff9b::/96 and
  // 64:ff9b:1::/48 are NAT64, and 2002::/16 is 6to4, each of which can carry an
  // inside IPv4 address; fec0::/10 is the old site-local range.
  for (const [net, bits] of [["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) list.addSubnet(net, bits, "ipv6");
  return list;
})();

function privateAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 0 || PRIVATE.check(ip, family === 6 ? "ipv6" : "ipv4");
}

async function checkHost(url: URL) {
  if (process.env.CALENDAR_ALLOW_PRIVATE_URLS === "1") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new FeedError(`${host} could not be found.`); })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(privateAddress)) throw new FeedError("That link points inside a private network, so it cannot be read from here.");
}

export async function fetchFeed(raw: string): Promise<string> {
  let url = normaliseFeedUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    await checkHost(url);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "text/calendar, */*;q=0.5" } });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new FeedError(`The calendar host redirected without saying where (${res.status}).`);
      url = normaliseFeedUrl(new URL(next, url).toString());
      continue;
    }
    if (!res.ok) throw new FeedError(`The calendar host answered ${res.status}${res.status === 404 ? ": the link may have been unpublished or reset" : ""}.`);
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new FeedError("That calendar is larger than 5 MB.");
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text.includes("BEGIN:VCALENDAR")) throw new FeedError("That link did not return a calendar (no BEGIN:VCALENDAR). Use the iCal / .ics address, not the web page.");
    return text;
  }
  throw new FeedError("The calendar host redirected too many times.");
}
