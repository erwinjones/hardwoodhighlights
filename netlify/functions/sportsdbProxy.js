/**
 * Netlify Function: sportsdbProxy
 * Proxies TheSportsDB requests server-side (CORS + caching).
 * Usage: /.netlify/functions/sportsdbProxy?endpoint=eventsnextleague&id=4516
 */
const API_KEY = process.env.SPORTSDB_KEY || "682823";

const ALLOWED_ENDPOINTS = new Set([
  "eventsnextleague",
  "eventspastleague",
  "lookupleaguetable",
  "eventsround",
  "lookupleague",
]);

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const endpoint = String(qs.endpoint || "").trim();
    const id = String(qs.id || "").trim();

    if (!ALLOWED_ENDPOINTS.has(endpoint) || !id) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Bad request", endpoint, id }),
      };
    }

    const upstream = `https://www.thesportsdb.com/api/v1/json/${API_KEY}/${endpoint}.php?id=${encodeURIComponent(id)}`;

    const r = await fetch(upstream, {
      headers: {
        accept: "application/json",
        "user-agent": "NetlifyFunction/sportsdbProxy",
      },
    });

    const bodyText = await r.text();
    return {
      statusCode: r.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
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
