// Custom server (replaces plain `next start`) so CopyCreator can run its own
// internal scheduler for Module 4 auto-posting, without needing a separate
// Railway Cron service. Everything else behaves exactly like `next start` —
// this just wraps it and adds one setInterval after the server is listening.
//
// Why this exists instead of Vercel-style cron: this app is deployed as a
// long-running Docker container on Railway (needed anyway for Playwright's
// Chromium in Module 1), not as serverless functions — so a plain in-process
// interval is the simplest way to get "check every minute, act if something's
// due" behavior with zero extra infrastructure.
//
// Caveat (documented in README Module 4): if this service is ever scaled to
// more than one replica, every replica would run this interval independently
// and could double-post. Fine at the default single-replica Railway setup;
// worth knowing if that ever changes.

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

const TICK_INTERVAL_MS = 60_000;
let tickInFlight = false;

async function runSchedulerTick(port) {
  if (tickInFlight) return; // previous tick still running — skip this one rather than overlap
  tickInFlight = true;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/cron/run-schedules`, {
      method: "POST",
      headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}
    });
    if (!res.ok) {
      console.error(`[scheduler] tick returned ${res.status}`);
    }
  } catch (err) {
    console.error("[scheduler] tick failed:", err);
  } finally {
    tickInFlight = false;
  }
}

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, () => {
    console.log(`> CopyCreator ready on port ${port}`);
    setInterval(() => runSchedulerTick(port), TICK_INTERVAL_MS);
  });
});
