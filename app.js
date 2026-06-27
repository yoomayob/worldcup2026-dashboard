(function () {
  "use strict";

  /* ---------------------------------------------------------------
   * 1. DATA LOADING — go through our own /api/wcdata serverless
   *    function (server-to-server, so no browser CORS issue), and
   *    fall back to the bundled snapshot (data.js) if that fails.
   * ------------------------------------------------------------- */
  const FETCH_TIMEOUT_MS = 9000;

  function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((res) => {
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .finally(() => clearTimeout(timer));
  }

  async function loadData() {
    try {
      const data = await fetchWithTimeout("/api/wcdata");
      if (data && data.error) throw new Error(data.error);
      if (!Array.isArray(data.teams) || !Array.isArray(data.matches)) throw new Error("unexpected shape");
      setLiveStatus("live");
      return normalize(data);
    } catch (err) {
      console.warn("Live worldcup2026 API unavailable, using offline snapshot.", err);
      setLiveStatus("offline");
      return normalize(window.WC_FALLBACK);
    }
  }

  function normalize(raw) {
    return {
      teams: raw.teams || [],
      matches: raw.matches || [],
      tables: raw.tables || raw.groups || [],
      stadiums: raw.stadiums || [],
    };
  }

  function setLiveStatus(state) {
    const el = document.getElementById("liveStatus");
    const text = document.getElementById("liveStatusText");
    el.classList.remove("is-live", "is-offline");
    if (state === "live") {
      el.classList.add("is-live");
      text.textContent = "live feed";
    } else if (state === "offline") {
      el.classList.add("is-offline");
      text.textContent = "offline snapshot";
    } else {
      text.textContent = "checking feed…";
    }
  }

  /* ---------------------------------------------------------------
   * 2. APP STATE
   * ------------------------------------------------------------- */
  const state = {
    teamsById: new Map(),
    stadiumsById: new Map(),
    matches: [],
    matchesById: new Map(),
    standingsByGroup: new Map(), // letter -> sorted [{team_id,pts,gd,gf,...}]
    thirdSlotAssignment: new Map(), // label -> team_id|null
    picks: loadPicks(),
  };

  function loadPicks() {
    try {
      return JSON.parse(localStorage.getItem("wc26-picks") || "{}");
    } catch (e) {
      return {};
    }
  }
  function savePicks() {
    try {
      localStorage.setItem("wc26-picks", JSON.stringify(state.picks));
    } catch (e) {
      /* storage unavailable — picks just won't persist */
    }
  }

  function team(id) {
    return state.teamsById.get(String(id));
  }
  function stadium(id) {
    return state.stadiumsById.get(String(id));
  }

  /* ---------------------------------------------------------------
   * 3. STANDINGS
   * ------------------------------------------------------------- */
  function buildStandings(tables) {
    tables.forEach((g) => {
      const rows = (g.teams || []).map((t) => ({
        team_id: String(t.team_id),
        mp: Number(t.mp) || 0,
        w: Number(t.w) || 0,
        d: Number(t.d) || 0,
        l: Number(t.l) || 0,
        pts: Number(t.pts) || 0,
        gf: Number(t.gf) || 0,
        ga: Number(t.ga) || 0,
        gd: t.gd !== undefined ? Number(t.gd) : (Number(t.gf) || 0) - (Number(t.ga) || 0),
      }));
      rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      state.standingsByGroup.set(g.group, rows);
    });
  }

  function renderStandings() {
    const grid = document.getElementById("standingsGrid");
    grid.innerHTML = "";
    const letters = Array.from(state.standingsByGroup.keys()).sort();
    letters.forEach((letter) => {
      const rows = state.standingsByGroup.get(letter);
      const card = document.createElement("div");
      card.className = "group-card";
      card.innerHTML = `
        <h3>Group ${letter}</h3>
        <table>
          <thead><tr>
            <th class="team-col">Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>
          </tr></thead>
          <tbody>
            ${rows
              .map((r, i) => {
                const t = team(r.team_id);
                const name = t ? t.name_en : "TBD";
                const flag = t && t.flag ? `<img src="${t.flag}" alt="" loading="lazy" />` : "";
                const cls = i < 2 ? "qualify" : i === 2 ? "third" : "";
                return `<tr class="${cls}">
                  <td class="team-col">${flag}<span>${name}</span></td>
                  <td>${r.mp}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
                  <td>${r.gd > 0 ? "+" + r.gd : r.gd}</td>
                  <td class="pts">${r.pts}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>`;
      grid.appendChild(card);
    });
  }

  /* ---------------------------------------------------------------
   * 4. MATCHES TAB
   * ------------------------------------------------------------- */
  function parseDate(str) {
    // format: MM/DD/YYYY HH:mm — treated as UTC, then always displayed in SGT.
    if (!str) return null;
    const [datePart, timePart] = str.split(" ");
    if (!datePart) return null;
    const [mo, da, yr] = datePart.split("/").map(Number);
    const [hh, mm] = (timePart || "00:00").split(":").map(Number);
    return new Date(Date.UTC(yr, mo - 1, da, hh || 0, mm || 0));
  }

  const SGT = "Asia/Singapore";
  function formatDateSGT(d) {
    return d.toLocaleDateString("en-SG", { month: "short", day: "numeric", timeZone: SGT });
  }
  function formatTimeSGT(d) {
    return d.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: SGT }) + " SGT";
  }

  function matchStatus(m) {
    const finished = String(m.finished).toUpperCase() === "TRUE" || m.finished === true;
    if (finished) return "finished";

    const elapsed = m.time_elapsed;
    if (elapsed && String(elapsed).toLowerCase() !== "notstarted" && String(elapsed).toLowerCase() !== "null") {
      return "live";
    }

    const d = parseDate(m.local_date);
    if (d) {
      const now = new Date();
      const end = new Date(d.getTime() + 2 * 60 * 60 * 1000);
      if (now >= d && now <= end) return "live";
      if (now > end) return "finished"; // kickoff has passed with no live/finished flag — treat as played
    }
    return "upcoming";
  }

  function hasConfirmedScore(m) {
    return String(m.finished).toUpperCase() === "TRUE" || m.finished === true;
  }

  function groupLabel(m) {
    if (m.type === "group") return "Group " + m.group;
    const names = { r32: "Round of 32", r16: "Round of 16", qf: "Quarter-final", sf: "Semi-final", third: "3rd place", final: "Final" };
    return names[m.type] || m.type;
  }

  function teamCell(idOrLabel, teamId, fallbackLabel) {
    const t = teamId && teamId !== "0" ? team(teamId) : null;
    if (t) {
      const flag = t.flag ? `<img src="${t.flag}" alt="" loading="lazy" />` : "";
      return `${flag}<span>${t.name_en}</span>`;
    }
    return `<span class="placeholder">${fallbackLabel || "TBD"}</span>`;
  }

  function renderMatches() {
    const list = document.getElementById("matchList");
    const statusVal = document.getElementById("statusFilter").dataset.value;
    const groupVal = document.getElementById("groupFilter").value;
    const search = document.getElementById("teamSearch").value.trim().toLowerCase();

    let matches = state.matches.slice().sort((a, b) => {
      const da = parseDate(a.local_date), db = parseDate(b.local_date);
      return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
    });

    matches = matches.filter((m) => {
      if (statusVal !== "all" && matchStatus(m) !== statusVal) return false;
      if (groupVal === "knockout" && m.type === "group") return false;
      if (groupVal !== "all" && groupVal !== "knockout" && m.group !== groupVal) return false;
      if (search) {
        const home = team(m.home_team_id);
        const away = team(m.away_team_id);
        const hay = [
          home && home.name_en, away && away.name_en, m.home_team_label, m.away_team_label,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    if (matches.length === 0) {
      list.innerHTML = `<p style="color:var(--ink-soft); padding:24px 0;">No matches match those filters.</p>`;
      return;
    }

    list.innerHTML = matches
      .map((m) => {
        const status = matchStatus(m);
        const d = parseDate(m.local_date);
        const dateStr = d ? formatDateSGT(d) : "TBD";
        const timeStr = d ? formatTimeSGT(d) : "";
        const st = stadium(m.stadium_id);
        const confirmed = hasConfirmedScore(m);
        const badgeClass = status === "live" ? "live" : status === "finished" ? "finished" : "";
        const badgeText =
          status === "live" ? "Live" : status === "finished" ? (confirmed ? "Final" : "Played") : groupLabel(m);
        const scoreClass = status === "upcoming" ? "notstarted" : "";
        let scoreText;
        if (status === "upcoming") {
          scoreText = timeStr || "—";
        } else if (status === "finished" && !confirmed) {
          scoreText = "FT";
        } else {
          scoreText = `${m.home_score ?? 0} – ${m.away_score ?? 0}`;
        }

        return `
        <div class="match-card">
          <div class="match-meta">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <span>${dateStr}${timeStr ? " · " + timeStr : ""}</span>
          </div>
          <div class="match-teams">
            <div class="team home">${teamCell("home", m.home_team_id, m.home_team_label)}</div>
            <div class="score ${scoreClass}">${scoreText}</div>
            <div class="team away">${teamCell("away", m.away_team_id, m.away_team_label)}</div>
          </div>
          <div class="match-venue">${st ? st.name_en + "<br>" + st.city_en : ""}</div>
        </div>`;
      })
      .join("");
  }

  function populateGroupFilter() {
    const sel = document.getElementById("groupFilter");
    const letters = Array.from(new Set(state.matches.filter((m) => m.type === "group").map((m) => m.group))).sort();
    letters.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = "Group " + l;
      sel.appendChild(opt);
    });
    const opt = document.createElement("option");
    opt.value = "knockout";
    opt.textContent = "Knockout rounds";
    sel.appendChild(opt);
  }

  /* ---------------------------------------------------------------
   * 5. KNOCKOUT PREDICTOR
   * ------------------------------------------------------------- */
  function buildThirdsAssignment() {
    // Rank all third-placed teams across groups, take best 8, then greedily
    // match them into the r32 "3rd Group X/Y/Z..." slots in bracket order.
    const thirds = [];
    state.standingsByGroup.forEach((rows, letter) => {
      if (rows[2]) thirds.push({ letter, row: rows[2] });
    });
    thirds.sort((a, b) => b.row.pts - a.row.pts || b.row.gd - a.row.gd || b.row.gf - a.row.gf);
    const qualified = thirds.slice(0, 8);

    const slots = state.matches
      .filter((m) => m.type === "r32")
      .flatMap((m) => [m.home_team_label, m.away_team_label])
      .filter((l) => l && l.startsWith("3rd Group"))
      .sort(); // deterministic order

    const used = new Set();
    slots.forEach((label) => {
      const groupsInLabel = label.replace("3rd Group ", "").split("/");
      const pick = qualified.find((q) => groupsInLabel.includes(q.letter) && !used.has(q.letter));
      if (pick) {
        used.add(pick.letter);
        state.thirdSlotAssignment.set(label, pick.row.team_id);
      } else {
        state.thirdSlotAssignment.set(label, null);
      }
    });
  }

  function resolveSlot(teamId, label) {
    // Real data already resolved this fixture.
    if (teamId && String(teamId) !== "0") {
      const t = team(teamId);
      return t ? { kind: "team", teamId: String(teamId), name: t.name_en, flag: t.flag } : { kind: "pending", text: label || "TBD" };
    }
    if (!label) return { kind: "pending", text: "TBD" };

    if (label.startsWith("Winner Group ")) {
      const letter = label.split(" ").pop();
      const rows = state.standingsByGroup.get(letter);
      const r = rows && rows[0];
      return r ? teamSlot(r.team_id) : { kind: "pending", text: label };
    }
    if (label.startsWith("Runner-up Group ")) {
      const letter = label.split(" ").pop();
      const rows = state.standingsByGroup.get(letter);
      const r = rows && rows[1];
      return r ? teamSlot(r.team_id) : { kind: "pending", text: label };
    }
    if (label.startsWith("3rd Group")) {
      const tid = state.thirdSlotAssignment.get(label);
      return tid ? teamSlot(tid) : { kind: "pending", text: label };
    }
    if (label.startsWith("Winner Match ")) {
      const mid = label.split(" ").pop();
      const pick = state.picks[mid];
      return pick && pick.winner ? teamSlot(pick.winner) : { kind: "pending", text: label };
    }
    if (label.startsWith("Loser Match ")) {
      const mid = label.split(" ").pop();
      const pick = state.picks[mid];
      return pick && pick.loser ? teamSlot(pick.loser) : { kind: "pending", text: label };
    }
    return { kind: "pending", text: label };
  }

  function teamSlot(teamId) {
    const t = team(teamId);
    return t ? { kind: "team", teamId: String(teamId), name: t.name_en, flag: t.flag } : { kind: "pending", text: "TBD" };
  }

  const ROUND_ORDER = ["r32", "r16", "qf", "sf", "final", "third"];
  const ROUND_TITLES = { r32: "Round of 32", r16: "Round of 16", qf: "Quarter-finals", sf: "Semi-finals", final: "Final", third: "3rd place" };

  function renderBracket() {
    buildThirdsAssignment();
    const bracket = document.getElementById("bracket");
    bracket.innerHTML = "";

    ROUND_ORDER.forEach((roundType) => {
      const matches = state.matches
        .filter((m) => m.type === roundType)
        .sort((a, b) => Number(a.id) - Number(b.id));
      if (matches.length === 0) return;

      const col = document.createElement("div");
      col.className = "round" + (roundType === "final" ? " final" : "");
      col.innerHTML = `<div class="round-title">${ROUND_TITLES[roundType]}</div>`;

      matches.forEach((m) => {
        const home = resolveSlot(m.home_team_id, m.home_team_label);
        const away = resolveSlot(m.away_team_id, m.away_team_label);
        const pick = state.picks[m.id];

        const tie = document.createElement("div");
        tie.className = "tie";
        tie.appendChild(renderTieRow(m.id, home, pick, "home"));
        tie.appendChild(renderTieRow(m.id, away, pick, "away"));
        col.appendChild(tie);
      });

      bracket.appendChild(col);
    });
  }

  function renderTieRow(matchId, slot, pick, side) {
    const row = document.createElement("button");
    row.className = "tie-row";
    if (slot.kind === "pending") {
      row.disabled = true;
      row.innerHTML = `<span class="name">${slot.text}</span>`;
      return row;
    }
    const isPicked = pick && pick.winner === slot.teamId;
    if (isPicked) row.classList.add("is-picked");
    row.innerHTML = `
      ${slot.flag ? `<img class="flag" src="${slot.flag}" alt="" loading="lazy" />` : ""}
      <span class="name">${slot.name}</span>
      ${isPicked ? '<span class="check">✓</span>' : ""}`;
    row.addEventListener("click", () => {
      const otherSlotIsHome = side === "away";
      // figure out the other team's id from the sibling row in the DOM call again:
      const m = state.matchesById.get(String(matchId));
      const otherSlot = resolveSlot(
        otherSlotIsHome ? m.home_team_id : m.away_team_id,
        otherSlotIsHome ? m.home_team_label : m.away_team_label
      );
      state.picks[matchId] = {
        winner: slot.teamId,
        loser: otherSlot.kind === "team" ? otherSlot.teamId : null,
      };
      savePicks();
      renderBracket();
    });
    return row;
  }

  /* ---------------------------------------------------------------
   * 6. TABS + CONTROLS WIRING
   * ------------------------------------------------------------- */
  function wireTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => {
          b.classList.remove("is-active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
        document.getElementById("panel-" + btn.dataset.tab).classList.add("is-active");
      });
    });
  }

  function wireMatchControls() {
    const seg = document.getElementById("statusFilter");
    seg.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        seg.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        seg.dataset.value = btn.dataset.value;
        renderMatches();
      });
    });
    document.getElementById("groupFilter").addEventListener("change", renderMatches);
    document.getElementById("teamSearch").addEventListener("input", renderMatches);
  }

  function wireResetPicks() {
    document.getElementById("resetPicks").addEventListener("click", () => {
      state.picks = {};
      savePicks();
      renderBracket();
    });
  }

  /* ---------------------------------------------------------------
   * 7. BOOT
   * ------------------------------------------------------------- */
  async function boot() {
    wireTabs();
    wireMatchControls();
    wireResetPicks();

    const data = await loadData();
    data.teams.forEach((t) => state.teamsById.set(String(t.id), t));
    data.stadiums.forEach((s) => state.stadiumsById.set(String(s.id), s));
    state.matches = data.matches;
    data.matches.forEach((m) => state.matchesById.set(String(m.id), m));
    buildStandings(data.tables);

    populateGroupFilter();
    renderMatches();
    renderStandings();
    renderBracket();
  }

  boot();
})();
