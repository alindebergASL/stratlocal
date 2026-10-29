import yauzl from "yauzl";
export const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
export function safeArchivePath(name: string): string {
  if (
    !name ||
    name.length > 240 ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((p) => p === ".." || p === ".") ||
    /[\x00-\x1f]/.test(name)
  )
    throw new Error("Unsafe archive path");
  return name;
}
export async function readZip(
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<Map<string, Buffer>> {
  if (bytes.length > MAX_PACKAGE_BYTES)
    throw new Error("Package exceeds 25 MB");
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error("Unreadable ZIP"));
          return;
        }
        const out = new Map<string, Buffer>();
        let expanded = 0,
          entries = 0,
          closed = false;
        const fail = (e: unknown) => {
          if (!closed) {
            closed = true;
            zip.close();
            signal?.removeEventListener("abort", abort);
            reject(e);
          }
        };
        const abort = () => fail(new Error("Import cancelled"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        zip.on("error", fail);
        zip.on("end", () => {
          if (!closed) {
            closed = true;
            signal?.removeEventListener("abort", abort);
            resolve(out);
          }
        });
        zip.on("entry", (entry) => {
          try {
            if (++entries > 500)
              throw new Error("Archive has more than 500 entries");
            safeArchivePath(entry.fileName);
            if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
              throw new Error("Archive symlinks are not allowed");
            if (entry.generalPurposeBitFlag & 1)
              throw new Error("Encrypted archives are not supported");
            if (entry.fileName.endsWith("/")) {
              zip.readEntry();
              return;
            }
            if (out.has(entry.fileName))
              throw new Error("Duplicate archive path");
            if (
              entry.uncompressedSize > 20 * 1024 * 1024 ||
              expanded + entry.uncompressedSize > MAX_EXPANDED_BYTES
            )
              throw new Error("Expanded archive exceeds limits");
            zip.openReadStream(entry, (err, stream) => {
              if (err || !stream) {
                fail(err ?? new Error("Unreadable ZIP entry"));
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              stream.on("error", fail);
              stream.on("data", (chunk: Buffer) => {
                size += chunk.length;
                expanded += chunk.length;
                if (size > 20 * 1024 * 1024 || expanded > MAX_EXPANDED_BYTES) {
                  stream.destroy();
                  fail(new Error("Expanded archive exceeds limits"));
                  return;
                }
                chunks.push(chunk);
              });
              stream.on("end", () => {
                if (!closed) {
                  out.set(entry.fileName, Buffer.concat(chunks));
                  zip.readEntry();
                }
              });
            });
          } catch (e) {
            fail(e);
          }
        });
        zip.readEntry();
      },
    );
  });
}
