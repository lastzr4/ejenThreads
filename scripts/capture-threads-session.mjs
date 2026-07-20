// Run this LOCALLY, on your own computer and your own network — never on
// Railway, never by anyone/anything other than you typing your own
// credentials into a real, visible browser window.
//
// What it does: opens Chromium (not headless) at Threads' login page and
// waits for you to log in exactly as you normally would — enter your own
// username/password, complete any 2FA or "verify it's you" step Meta asks
// for. Once you're on your home feed, come back to this terminal and press
// Enter. The script then saves the resulting session (cookies) to a local
// JSON file. Paste that file's contents into the app's Settings page
// (Dashboard -> Settings -> Threads session) so the deployed scraper can
// load it and see your full, logged-in view of Threads instead of the
// ~3-4 post preview anonymous visitors get.
//
// This script never sees, stores, or transmits your password anywhere —
// you type it directly into Threads' own login page in the browser window
// it opens. But the OUTPUT FILE (threads-session-state.json) is just as
// sensitive as a password: anyone who has it can act as your logged-in
// session without knowing your password. Treat it accordingly:
//   - Never commit it to git (already in .gitignore).
//   - Delete the local copy once you've pasted it into Settings.
//   - Using it from this app's server (a different network than the one
//     you logged in from) is a real risk to your account — Meta may flag
//     this as suspicious and force a re-login, a verification challenge,
//     or a temporary restriction.
//
// Setup (one-time): npx playwright install chromium
// Usage:            node scripts/capture-threads-session.mjs

import { chromium } from "playwright";
import { writeFileSync } from "fs";
import { createInterface } from "readline";

const OUTPUT_PATH = "threads-session-state.json";

function waitForEnter(promptText) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.threads.net/login");

  console.log("\nA Chromium window has opened.");
  console.log("Log into Threads with your own account, exactly as you normally would.");
  console.log("(\"Continue with Instagram\" or \"Log in with username instead\" both work.)");
  console.log("Once you're on your Threads home feed, fully logged in, come back here.\n");

  await waitForEnter("Press Enter once you're logged in... ");

  const state = await context.storageState();
  writeFileSync(OUTPUT_PATH, JSON.stringify(state, null, 2));

  console.log(`\nSaved session to ${OUTPUT_PATH}.`);
  console.log("This file is as sensitive as a password — do not commit it, do not share it.");
  console.log("Next step: open the file, copy its full contents, and paste them into");
  console.log("Dashboard -> Settings -> Threads session in the app. Then delete this local file.");

  await browser.close();
}

main().catch((err) => {
  console.error("Failed to capture session:", err);
  process.exit(1);
});
