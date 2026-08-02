// Captured once when this server process starts. server.js runs one
// long-lived Node process (that's how Module 4's setInterval scheduler
// works at all), and Railway restarts that process on every deploy — so
// this value changes exactly when a new version goes live, and stays
// constant the rest of the time (including across every cron tick in
// between deploys). Used by components/version-watcher.tsx to detect a
// deploy that happened while a tab was already open, and prompt a clean
// re-login so the client picks up the new bundle instead of running stale
// JS indefinitely.
//
// Prefers Railway's own commit-sha env var when present (more meaningful to
// read in logs); falls back to a boot timestamp for local/non-Railway runs,
// which still changes on every restart either way.
export const APP_VERSION = process.env.RAILWAY_GIT_COMMIT_SHA || `boot-${new Date().toISOString()}`;
