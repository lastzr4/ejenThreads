/**
 * The app's own public origin, e.g. "https://ejenthreads-production.up.railway.app".
 *
 * Don't build redirect URLs from `request.url` in Route Handlers — behind
 * Railway's proxy (and this app's custom server.js, which doesn't declare a
 * `hostname` to Next), the Host Next sees on incoming requests can resolve
 * to "localhost:<port>" instead of the public domain, which silently sends
 * users' browsers to a localhost URL after an OAuth redirect. Confirmed
 * happening in Module 4's Threads OAuth callback.
 *
 * THREADS_REDIRECT_URI is always the app's real public origin plus
 * /api/threads/oauth/callback (Meta validated it, or the OAuth flow
 * wouldn't have worked at all) — so it doubles as a reliable source of
 * truth for "what domain is this app actually running on," with no extra
 * env var needed.
 */
export function getAppOrigin(): string {
  const redirectUri = process.env.THREADS_REDIRECT_URI;
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin;
    } catch {
      // fall through to localhost below
    }
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}
