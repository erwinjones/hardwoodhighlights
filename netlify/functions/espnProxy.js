/**
 * Netlify Function: espnProxy
 * Proxies ESPN Site API endpoints server-side to avoid browser CORS blocks.
 *
 * Usage:
 *   /.netlify/functions/espnProxy?path=basketball/nba/scoreboard
 *   /.netlify/functions/espnProxy?path=basketball/nba/scoreboard&dates=20251224-20251230
 *   /.netlify/functions/espnProxy?path=basketball/nba/standings
 */
const ALLOWED_PATHS = new Set([
  // Pro Football Highlights
  "football/nfl/scoreboard",

  // Hardwood Highlights scoreboards
  "basketball/nba/scoreboard",
  "basketball/wnba/scoreboard",
  "basketball/mens-college-basketball/scoreboard",
  "basketball/womens-college-basketball/scoreboard",

  // Hardwood Highlights summaries (leaders/player stats)
  "basketball/nba/summary",
  "basketball/wnba/summary",
  "basketball/mens-college-basketball/summary",
  "basketball/womens-college-basketball/summary",

  // Hardwood Highlights standings (best-effort; ESPN may change these endpoints)
  "basketball/nba/standings",
  "basketball/wnba/standings",
  "basketball/mens-college-basketball/standings",
  "basketball/womens-college-basketball/standings",
]);

const ALLOWED_QUERY_KEYS = new Set([
  // scoreboards
  "dates", "date", "limit", "groups", "lang", "region",
  // some ESPN endpoints use these
  "seasontype", "season", "sort", "page", "pagesize",
  // summaries
  "event"
]);

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const path = (params.path || "").trim();

    if (!path || !ALLOWED_PATHS.has(path)) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Invalid or disallowed path.", path }),
      };
    }

    // Build a safe query string (only whitelisted keys, excluding `path`)
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === "path") continue;
      if (!ALLOWED_QUERY_KEYS.has(k)) continue;
      if (v === undefined || v === null || String(v).trim() === "") continue;
      qs.set(k, String(v));
    }

    const base = `https://site.web.api.espn.com/apis/v2/sports/${path}`;
    const url = qs.toString() ? `${base}?${qs.toString()}` : base;

    const r = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NetlifyFunction/1.0)",
        "accept": "application/json,text/plain,*/*",
      },
    });

    const bodyText = await r.text();
    return {
      statusCode: r.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        // Keep light caching to reduce Netlify invocations but stay fresh
        "cache-control": "public, max-age=60",
      },
      body: bodyText,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: String(e) }),
    };
  }
};
