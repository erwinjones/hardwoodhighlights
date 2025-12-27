// Live scoreboards + standings (best-effort) for Hardwood Highlights.
// Hands-off mode: auto-fills featured matchup, recent results, upcoming games, and standings where possible.
// Primary data: ESPN (via Netlify function proxy to avoid CORS).

const HH_CONFIG = {
  nba:  { espnPath: "basketball/nba",                    label: "NBA" },
  wnba: { espnPath: "basketball/wnba",                   label: "WNBA" },
  ncaa: { espnPath: "basketball/mens-college-basketball", label: "NCAA Men" },
  ncaaw:{ espnPath: "basketball/womens-college-basketball", label: "NCAA Women" },
  // March page (mm.html) is effectively NCAA Men coverage in this template
  mm:   { espnPath: "basketball/mens-college-basketball", label: "March" },
};

function pad2(n){ return String(n).padStart(2,"0"); }
function ymd(d){
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
}
function dateRange(pastDays=3, nextDays=3){
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - pastDays);
  const end = new Date(now);   end.setDate(end.getDate() + nextDays);
  return `${ymd(start)}-${ymd(end)}`;
}

async function fetchJson(url){
  const r = await fetch(url, { headers: { "accept":"application/json" }});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

function formatStatusESPN(ev){
  const st = ev?.status?.type;
  if(!st) return "";
  if(st.completed) return "FINAL";
  if(st.state === "in") return st.shortDetail || "LIVE";
  // scheduled
  return st.shortDetail || "Scheduled";
}

function parseEvent(ev){
  const comp = ev?.competitions?.[0];
  const comps = comp?.competitors || [];
  const home = comps.find(c => c.homeAway === "home");
  const away = comps.find(c => c.homeAway === "away");
  const matchup = `${away?.team?.displayName || "Away"} @ ${home?.team?.displayName || "Home"}`;
  const scoreHome = home?.score ?? "";
  const scoreAway = away?.score ?? "";
  const score = (scoreHome !== "" || scoreAway !== "") ? `${scoreAway} - ${scoreHome}` : "";
  const status = formatStatusESPN(ev);
  const dt = ev?.date ? new Date(ev.date) : null;
  const when = dt ? dt.toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }) : "";
  const link = ev?.links?.[0]?.href || comp?.links?.[0]?.href || "";
  const completed = !!ev?.status?.type?.completed;
  const live = ev?.status?.type?.state === "in";
  return { id: ev?.id || "", matchup, score, status, when, link, completed, live, dt: dt ? dt.getTime():0 };
}

function byTimeAsc(a,b){ return (a.dt||0)-(b.dt||0); }
function byTimeDesc(a,b){ return (b.dt||0)-(a.dt||0); }

function rowHtml(item){
  const scorePart = item.score ? `<div class="schedule-score">${item.score}</div>` : "";
  const linkPart = item.link ? `<a class="schedule-link" href="${item.link}" target="_blank" rel="noopener">ESPN</a>` : "";
  return `
    <div class="schedule-row">
      <div class="schedule-matchup">${item.matchup}</div>
      ${scorePart}
      <div class="schedule-meta">${item.status}${item.when ? " · " + item.when : ""}${linkPart ? " · " + linkPart : ""}</div>
    </div>
  `;
}

async function getESPNEvents(leagueKey){
  const cfg = HH_CONFIG[leagueKey];
  if(!cfg) throw new Error("Unknown league");
  const dates = dateRange(3,3);
  const url = `/.netlify/functions/espnProxy?path=${encodeURIComponent(cfg.espnPath + "/scoreboard")}&dates=${dates}`;
  const data = await fetchJson(url);
  const events = (data.events || []).map(parseEvent).filter(x => x.dt);
  // Deduplicate in case ESPN returns duplicates
  const seen = new Set();
  const out = [];
  for(const e of events){
    const k = `${e.matchup}|${e.dt}|${e.score}|${e.status}`;
    if(seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// ---------- Leaders (top performers) ----------

function toNumber(val){
  if (val === null || val === undefined) return NaN;
  if (typeof val === "number") return val;
  const s = String(val).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function pushLeader(map, cat, athleteName, teamAbbr, value){
  if(!athleteName) return;
  const num = toNumber(value);
  if(!Number.isFinite(num)) return;
  const key = `${athleteName}@@${teamAbbr || ""}`;
  if(!map[cat]) map[cat] = new Map();
  // keep max value per athlete in window
  const prev = map[cat].get(key);
  if(prev === undefined || num > prev.value){
    map[cat].set(key, { name: athleteName, team: teamAbbr || "", value: num });
  }
}

// Tries several known ESPN summary shapes to extract points/rebounds/assists leaders.
function extractLeadersFromSummary(summary){
  const agg = { points: [], rebounds: [], assists: [] };

  const map = { points: new Map(), rebounds: new Map(), assists: new Map() };

  // Shape A: summary.leaders = [{ name/displayName, leaders:[{athlete,displayValue,value,team}] }]
  const leadersA = summary?.leaders;
  if(Array.isArray(leadersA)){
    for(const cat of leadersA){
      const cname = (cat?.name || cat?.abbreviation || cat?.displayName || "").toLowerCase();
      const target =
        cname.includes("point") ? "points" :
        (cname.includes("rebound") || cname === "reb") ? "rebounds" :
        (cname.includes("assist") || cname === "ast") ? "assists" : null;
      if(!target) continue;
      const items = cat?.leaders || cat?.leader || [];
      if(Array.isArray(items)){
        for(const it of items){
          pushLeader(map, target, it?.athlete?.displayName || it?.athlete?.shortName, it?.team?.abbreviation, it?.value ?? it?.displayValue);
        }
      }
    }
  }

  // Shape B: summary.header.competitions[0].competitors[].leaders = [{name, leaders:[...]}]
  const compLeaders = summary?.header?.competitions?.[0]?.competitors || summary?.competitions?.[0]?.competitors;
  if(Array.isArray(compLeaders)){
    for(const team of compLeaders){
      const arr = team?.leaders;
      if(!Array.isArray(arr)) continue;
      for(const cat of arr){
        const cname = (cat?.name || cat?.displayName || "").toLowerCase();
        const target =
          cname.includes("point") ? "points" :
          (cname.includes("rebound") || cname === "reb") ? "rebounds" :
          (cname.includes("assist") || cname === "ast") ? "assists" : null;
        if(!target) continue;
        const items = cat?.leaders || [];
        if(Array.isArray(items)){
          for(const it of items){
            pushLeader(map, target, it?.athlete?.displayName || it?.athlete?.shortName, team?.team?.abbreviation || it?.team?.abbreviation, it?.value ?? it?.displayValue);
          }
        }
      }
    }
  }

  // Build sorted top-5 lists
  for(const cat of ["points","rebounds","assists"]){
    const list = Array.from(map[cat].values()).sort((a,b)=>b.value-a.value).slice(0,5);
    agg[cat] = list;
  }
  return agg;
}

async function getLeaders(leagueKey, events){
  const cfg = HH_CONFIG[leagueKey];
  if(!cfg) return null;

  // Only completed games have meaningful leaders
  const completed = (events || []).filter(e => e.completed && e.id).sort((a,b)=>b.dt-a.dt);

  // Keep it lightweight: fetch up to 10 most recent completed games in the window
  const sample = completed.slice(0, 10);
  if(sample.length === 0) return { points: [], rebounds: [], assists: [] };

  const acc = { points: new Map(), rebounds: new Map(), assists: new Map() };

  for(const ev of sample){
    try{
      const url = `/.netlify/functions/espnProxy?path=${encodeURIComponent(cfg.espnPath + "/summary")}&event=${encodeURIComponent(ev.id)}`;
      const summary = await fetchJson(url);
      const leaders = extractLeadersFromSummary(summary);

      for(const cat of ["points","rebounds","assists"]){
        for(const item of leaders[cat]){
          const key = `${item.name}@@${item.team}`;
          const prev = acc[cat].get(key);
          if(prev === undefined || item.value > prev.value){
            acc[cat].set(key, item);
          }
        }
      }
    }catch(_e){
      // ignore per-game failures; continue
    }
  }

  const result = {};
  for(const cat of ["points","rebounds","assists"]){
    result[cat] = Array.from(acc[cat].values()).sort((a,b)=>b.value-a.value).slice(0,5);
  }
  return result;
}

function renderLeaders(leagueKey, leaders){
  const el = document.getElementById(`${leagueKey}-leaders`);
  if(!el) return;
  if(!leaders) { el.innerHTML = `<div class="muted">Leaders unavailable.</div>`; return; }

  const col = (title, items, suffix="") => {
    if(!items || items.length === 0) return `
      <div class="leader-col">
        <div class="leader-title">${title}</div>
        <div class="muted">No completed games in window.</div>
      </div>
    `;
    const rows = items.map((x,i)=>`
      <div class="leader-row">
        <div class="leader-rank">${i+1}</div>
        <div class="leader-name">${x.name}${x.team ? ` <span class="muted">(${x.team})</span>`:""}</div>
        <div class="leader-val">${x.value}${suffix}</div>
      </div>
    `).join("");
    return `
      <div class="leader-col">
        <div class="leader-title">${title}</div>
        ${rows}
      </div>
    `;
  };

  el.innerHTML = `
    <div class="leaders-grid">
      ${col("Points", leaders.points)}
      ${col("Rebounds", leaders.rebounds)}
      ${col("Assists", leaders.assists)}
    </div>
    <div class="muted" style="margin-top:8px;">Top performers from completed games in the last 3 days.</div>
  `;
}


// Best-effort standings parser for ESPN "standings" endpoints.
// ESPN responses vary by sport/league. We try a few common shapes and return [{team,w,l}] rows.
function extractStandingsRows(obj, limit=10){
  const rows = [];

  // helper to pull from an "entries" array
  const pullEntries = (entries) => {
    if(!Array.isArray(entries)) return;
    for(const ent of entries){
      const team = ent?.team?.displayName || ent?.team?.name || ent?.team?.abbreviation;
      const stats = ent?.stats || [];
      const w = stats.find(s => s.name === "wins" || s.abbreviation === "W")?.value;
      const l = stats.find(s => s.name === "losses" || s.abbreviation === "L")?.value;
      if(team){
        rows.push({ team, w: (w ?? "—"), l: (l ?? "—") });
      }
      if(rows.length >= limit) return;
    }
  };

  // Shape A: obj.children[...].standings.entries
  const children = obj?.children;
  if(Array.isArray(children)){
    for(const ch of children){
      pullEntries(ch?.standings?.entries);
      if(rows.length >= limit) return rows;
      // sometimes nested children
      if(Array.isArray(ch?.children)){
        for(const ch2 of ch.children){
          pullEntries(ch2?.standings?.entries);
          if(rows.length >= limit) return rows;
        }
      }
    }
  }

  // Shape B: obj.standings.entries
  pullEntries(obj?.standings?.entries);
  if(rows.length) return rows.slice(0,limit);

  // Shape C: obj.entries
  pullEntries(obj?.entries);
  if(rows.length) return rows.slice(0,limit);

  return rows.slice(0,limit);
}

async function getESPNStandings(leagueKey){
  const cfg = HH_CONFIG[leagueKey];
  const url = `/.netlify/functions/espnProxy?path=${encodeURIComponent(cfg.espnPath + "/standings")}`;
  const data = await fetchJson(url);
  return extractStandingsRows(data, 10);
}

function setText(id, txt){
  const el = document.getElementById(id);
  if(el) el.textContent = txt;
}
function setHtml(id, html){
  const el = document.getElementById(id);
  if(el) el.innerHTML = html;
}

function fillFeatured(leagueKey, events){
  const el = document.getElementById(`${leagueKey}-featured`);
  if(!el) return;

  const upcoming = events.filter(e => !e.completed).sort(byTimeAsc);
  const pick = upcoming[0] || events.sort(byTimeAsc)[0];

  if(!pick){
    el.innerHTML = `<div class="muted">No games found in this window.</div>`;
    return;
  }

  const inner = `
      <div class="row-title">${pick.matchup}</div>
      <div class="row-sub">${pick.status}${pick.when ? " · " + pick.when : ""}${pick.link ? ` · <a href="${pick.link}" target="_blank" rel="noopener">ESPN</a>` : ""}</div>
  `;

  // On the homepage, the featured containers are already .row elements.
  if(el.classList && el.classList.contains("row")){
    el.innerHTML = inner;
  } else {
    el.innerHTML = `<div class="row">${inner}</div>`;
  }
}

function fillRecent(leagueKey, events){
  const el = document.getElementById(`${leagueKey}-recent`);
  if(!el) return;
  const finals = events.filter(e => e.completed).sort(byTimeDesc).slice(0,5);
  el.innerHTML = finals.length ? finals.map(rowHtml).join("") : `<div class="muted">No finals in the last 3 days.</div>`;
}

function fillUpcoming(leagueKey, events){
  const el = document.getElementById(`${leagueKey}-upcoming`);
  if(!el) return;
  const upcoming = events.filter(e => !e.completed).sort(byTimeAsc).slice(0,8);
  el.innerHTML = upcoming.length ? upcoming.map(rowHtml).join("") : `<div class="muted">No upcoming games in the next 3 days.</div>`;
}

function fillScoreboardList(leagueKey, events){
  // Generic container used on the homepage "Live ... Scoreboards"
  const el = document.getElementById(`${leagueKey}-scoreboard`);
  if(!el) return;
  const list = events.sort(byTimeAsc).slice(0,24);
  el.innerHTML = list.length ? list.map(rowHtml).join("") : `<div class="schedule-row"><div class="schedule-matchup">No games found.</div></div>`;
}

async function loadLeague(leagueKey){
  const statusEl = document.getElementById(`${leagueKey}-status`);
  try{
    if(statusEl) statusEl.textContent = "Loading…";
    const events = await getESPNEvents(leagueKey);
    fillScoreboardList(leagueKey, events);
    fillFeatured(leagueKey, events);
    fillRecent(leagueKey, events);
    fillUpcoming(leagueKey, events);

    // standings is best-effort; don't block other content
    const sbBodyId = `${leagueKey}-standings-body`;
    if(document.getElementById(sbBodyId)){
      try{
        const rows = await getESPNStandings(leagueKey);
        if(rows && rows.length){
          setHtml(sbBodyId, rows.map(r => `<tr><td>${r.team}</td><td>${r.w}</td><td>${r.l}</td></tr>`).join(""));
        } else {
          setHtml(sbBodyId, `<tr><td colspan="3" class="muted">Standings unavailable right now.</td></tr>`);
        }
      } catch(_){
        setHtml(sbBodyId, `<tr><td colspan="3" class="muted">Standings unavailable right now.</td></tr>`);
      }
    }

    if(statusEl){
      const now = new Date();
      statusEl.textContent = `Source: ESPN · Updated ${now.toLocaleDateString()}, ${now.toLocaleTimeString()}`;
    }
  } catch(e){
    if(statusEl) statusEl.textContent = `Could not load data (${e.message || "error"}).`;
    // graceful fallbacks
    fillScoreboardList(leagueKey, []);
    fillFeatured(leagueKey, []);
    fillRecent(leagueKey, []);
    fillUpcoming(leagueKey, []);
    const sbBodyId = `${leagueKey}-standings-body`;
    if(document.getElementById(sbBodyId)){
      setHtml(sbBodyId, `<tr><td colspan="3" class="muted">Standings unavailable right now.</td></tr>`);
    }
  }
}

function wireRefresh(leagueKey){
  const btn = document.getElementById(`${leagueKey}-refresh`);
  if(btn) btn.addEventListener("click", () => loadLeague(leagueKey));
}

document.addEventListener("DOMContentLoaded", () => {
  // Detect which league containers exist on the page and load only those.
  const present = Object.keys(HH_CONFIG).filter(k => {
    return !!document.getElementById(`${k}-status`)
        || !!document.getElementById(`${k}-scoreboard`)
        || !!document.getElementById(`${k}-featured`)
        || !!document.getElementById(`${k}-recent`)
        || !!document.getElementById(`${k}-upcoming`)
        || !!document.getElementById(`${k}-standings-body`)
        || !!document.getElementById(`${k}-leaders`);
  });

  present.forEach(k => { wireRefresh(k); loadLeague(k); });

  // Light auto-refresh every 3 minutes (reduces Netlify function load vs 60s)
  setInterval(() => { present.forEach(loadLeague); }, 180000);
});
