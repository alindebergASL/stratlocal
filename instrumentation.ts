export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.VITEST !== "true"
  ) {
    const { startLocalWorker } = await import("./lib/local/worker");
    startLocalWorker();
  }
}
