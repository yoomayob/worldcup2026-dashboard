// Vercel serverless function. Runs server-side, so it isn't subject to the
// browser's CORS rules — it just relays JSON from the worldcup2026 API.
const BASE = "https://worldcup26.ir";
const PATHS = {
  teams: "/get/teams",
  matches: "/get/games",
  tables: "/get/groups",
  stadiums: "/get/stadiums",
};

async function getJSON(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(BASE + path, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(path + " responded " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  try {
    const [teams, matches, tables, stadiums] = await Promise.all([
      getJSON(PATHS.teams),
      getJSON(PATHS.matches),
      getJSON(PATHS.tables),
      getJSON(PATHS.stadiums),
    ]);
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
    res.status(200).json({ teams, matches, tables, stadiums });
  } catch (err) {
    res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
};
