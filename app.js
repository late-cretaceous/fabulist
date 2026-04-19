"use strict";

const PAGE_SIZE = 100;
const TOP_REGIONS = 40;

const state = {
  metadata: null,
  chapters: [],
  searchIndex: [],
  chapterCache: new Map(),
  detailCache: new Map(),
  view: { mode: "chapter", chapter: "A", query: "", region: "" },
  rendered: 0,
  results: [],
  selectedId: null,
};

const els = {
  search: document.getElementById("search-input"),
  searchWrap: document.getElementById("search-wrap"),
  searchCount: document.getElementById("search-count"),
  chapterList: document.getElementById("chapter-list"),
  regionFilter: document.getElementById("region-filter"),
  metaBlock: document.getElementById("meta-block"),
  breadcrumb: document.getElementById("breadcrumb"),
  listHeader: document.getElementById("list-header"),
  motifList: document.getElementById("motif-list"),
  empty: document.getElementById("list-empty"),
  loading: document.getElementById("loading"),
  detail: document.getElementById("detail-panel"),
  browseView: document.getElementById("browse-view"),
  drawView: document.getElementById("draw-view"),
  drawBody: document.getElementById("draw-body"),
  drawId: document.getElementById("draw-id"),
  drawCount: document.getElementById("draw-count"),
  newDrawBtn: document.getElementById("new-draw-btn"),
  copyDrawBtn: document.getElementById("copy-draw-btn"),
  backToDraw: document.getElementById("back-to-draw"),
  tabs: document.querySelectorAll(".tab"),
};

/* ---------- data loading ---------- */

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Failed to load ${path}`);
  return r.json();
}

async function getChapter(letter) {
  if (state.chapterCache.has(letter)) return state.chapterCache.get(letter);
  const motifs = await loadJSON(`data/chapter-${letter}.json`);
  state.chapterCache.set(letter, motifs);
  for (const m of motifs) state.detailCache.set(m.motif_id, m);
  return motifs;
}

async function getMotifById(id) {
  if (state.detailCache.has(id)) return state.detailCache.get(id);
  const letter = (id.match(/^[A-Z]/) || [""])[0];
  if (!letter) return null;
  await getChapter(letter);
  return state.detailCache.get(id) || null;
}

/* ---------- init ---------- */

async function init() {
  showLoading(true);
  const meta = await loadJSON("data/metadata.json");
  state.metadata = meta.metadata;
  state.chapters = meta.chapters;

  renderChapterList();
  renderMeta();

  state.searchIndex = await loadJSON("data/search.json");
  populateRegionFilter();

  els.search.addEventListener("input", debounce(onSearch, 150));
  els.regionFilter.addEventListener("change", onRegionChange);
  els.newDrawBtn.addEventListener("click", () => generateAndRenderDraw());
  els.copyDrawBtn.addEventListener("click", copyDrawToClipboard);
  els.backToDraw.addEventListener("click", returnToDraw);
  for (const tab of els.tabs) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  }
  window.addEventListener("hashchange", onHashChange);

  await selectChapter("A");
  showLoading(false);

  // Deep-link via hash: #draw=<id>  or  #tab=draw
  onHashChange();
}

/* ---------- tabs ---------- */

function switchTab(name) {
  for (const t of els.tabs) t.classList.toggle("active", t.dataset.tab === name);
  const isDraw = name === "draw";
  els.browseView.hidden = isDraw;
  els.drawView.hidden = !isDraw;
  els.searchWrap.style.visibility = isDraw ? "hidden" : "visible";
  if (isDraw) {
    // If we're going back to the draw, clear the back-pill
    els.backToDraw.hidden = true;
    state.drawReturnHash = null;
    if (!state.currentDraw) generateAndRenderDraw();
  }
  updateHash();
}

function onHashChange() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash);
  if (params.get("tab") === "draw") switchTab("draw");
  const drawParam = params.get("draw");
  if (drawParam) {
    const draw = decodeDraw(drawParam);
    if (draw) {
      state.currentDraw = draw;
      renderDraw(draw);
      switchTab("draw");
    }
  }
}

function updateHash() {
  const params = new URLSearchParams();
  const isDraw = !els.drawView.hidden;
  if (isDraw) params.set("tab", "draw");
  if (isDraw && state.currentDraw) params.set("draw", encodeDraw(state.currentDraw));
  const str = params.toString();
  const newHash = str ? "#" + str : "";
  if (location.hash !== newHash) {
    history.replaceState(null, "", location.pathname + location.search + newHash);
  }
}

function showLoading(on) {
  els.loading.hidden = !on;
}

/* ---------- sidebar ---------- */

function renderChapterList() {
  els.chapterList.innerHTML = "";
  for (const ch of state.chapters) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "chapter-btn";
    btn.dataset.letter = ch.letter;
    btn.innerHTML = `
      <span class="letter">${ch.letter}</span>
      <span class="title">${escapeHTML(trimChapterTitle(ch.title))}</span>
      <span class="count">${ch.count.toLocaleString()}</span>`;
    btn.addEventListener("click", () => selectChapter(ch.letter));
    li.appendChild(btn);
    els.chapterList.appendChild(li);
  }
}

function trimChapterTitle(t) {
  return t.replace(/^[A-Z]\.\s*/, "").replace(/\.$/, "");
}

function renderMeta() {
  const m = state.metadata;
  if (!m) return;
  els.metaBlock.innerHTML = `
    <strong>${m.total_motifs.toLocaleString()}</strong> motifs
    across <strong>${m.chapters}</strong> chapters.<br/>
    <em>${escapeHTML(m.source_edition || "")}</em><br/>
    Database v${escapeHTML(m.database_version || "")}.
  `;
}

function populateRegionFilter() {
  const counts = new Map();
  for (const m of state.searchIndex) {
    for (const r of m.r) counts.set(r, (counts.get(r) || 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_REGIONS);
  for (const [name, count] of top) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name} (${count.toLocaleString()})`;
    els.regionFilter.appendChild(opt);
  }
}

/* ---------- view switching ---------- */

async function selectChapter(letter) {
  state.view = { mode: "chapter", chapter: letter, query: "", region: state.view.region };
  els.search.value = "";
  highlightChapterButton(letter);
  await renderList();
}

function highlightChapterButton(letter) {
  for (const b of els.chapterList.querySelectorAll(".chapter-btn")) {
    b.classList.toggle("active", b.dataset.letter === letter);
  }
}

function onSearch(e) {
  const q = e.target.value.trim();
  if (!q && state.view.mode === "search") {
    selectChapter(state.view.chapter || "A");
    return;
  }
  state.view = { mode: "search", chapter: state.view.chapter, query: q, region: state.view.region };
  highlightChapterButton(null);
  renderList();
}

function onRegionChange(e) {
  state.view.region = e.target.value;
  renderList();
}

/* ---------- list rendering ---------- */

async function renderList() {
  els.motifList.innerHTML = "";
  els.empty.hidden = true;

  let results;
  if (state.view.mode === "search") {
    results = runSearch(state.view.query, state.view.region);
  } else {
    const motifs = await getChapter(state.view.chapter);
    results = motifs;
    if (state.view.region) {
      results = results.filter((m) =>
        (m.cultural_region || []).includes(state.view.region),
      );
    }
    results = results.map((m) => ({
      i: m.motif_id,
      n: m.name,
      c: state.view.chapter,
      s: m.section,
      l: m.lemmas || [],
      r: m.cultural_region || [],
      _level: m.level,
    }));
    results.sort(sortBySortKey);
  }

  state.results = results;
  state.rendered = 0;

  updateBreadcrumb();
  updateListHeader(results.length);
  updateSearchCount(results.length);

  if (!results.length) {
    els.empty.hidden = false;
    return;
  }

  renderNextPage();
}

function sortBySortKey(a, b) {
  // Fall back to id lex order — our search index has no sort_key, but id is close enough
  return a.i.localeCompare(b.i, "en");
}

function updateBreadcrumb() {
  const v = state.view;
  const parts = [];
  if (v.mode === "search") {
    parts.push(`<strong>Search:</strong> "${escapeHTML(v.query)}"`);
  } else {
    const ch = state.chapters.find((c) => c.letter === v.chapter);
    if (ch) parts.push(`<strong>${ch.letter}.</strong> ${escapeHTML(trimChapterTitle(ch.title))}`);
  }
  if (v.region) parts.push(`region: ${escapeHTML(v.region)}`);
  els.breadcrumb.innerHTML = parts.join(" &middot; ");
}

function updateListHeader(total) {
  els.listHeader.innerHTML = `<span>${total.toLocaleString()} motifs</span>`;
}

function updateSearchCount(total) {
  if (state.view.mode === "search") {
    els.searchCount.textContent = `${total.toLocaleString()} match${total === 1 ? "" : "es"}`;
  } else {
    els.searchCount.textContent = "";
  }
}

function renderNextPage() {
  const end = Math.min(state.rendered + PAGE_SIZE, state.results.length);
  const slice = state.results.slice(state.rendered, end);
  const frag = document.createDocumentFragment();
  const q = state.view.mode === "search" ? state.view.query.toLowerCase() : "";

  for (const m of slice) {
    const row = document.createElement("div");
    row.className = "motif-row";
    row.dataset.id = m.i;
    if (m.i === state.selectedId) row.classList.add("selected");

    const tags = [];
    if (m.r && m.r.length) tags.push(...m.r.slice(0, 2));

    row.innerHTML = `
      <div class="id">${escapeHTML(m.i || "—")}</div>
      <div class="name">${highlight(m.n, q)}</div>
      <div class="tags">${tags
        .map((t) => `<span class="tag">${escapeHTML(t)}</span>`)
        .join("")}</div>
    `;
    row.addEventListener("click", () => showDetail(m.i, row));
    frag.appendChild(row);
  }

  // Remove any prior show-more
  const oldMore = els.motifList.querySelector(".show-more");
  if (oldMore) oldMore.remove();

  els.motifList.appendChild(frag);
  state.rendered = end;

  if (state.rendered < state.results.length) {
    const btn = document.createElement("button");
    btn.className = "show-more";
    btn.textContent = `Show more (${(state.results.length - state.rendered).toLocaleString()} remaining)`;
    btn.addEventListener("click", renderNextPage);
    els.motifList.appendChild(btn);
  }
}

/* ---------- search ---------- */

function runSearch(query, region) {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length && !region) return [];

  const out = [];
  for (const m of state.searchIndex) {
    if (region && !m.r.includes(region)) continue;
    if (tokens.length) {
      const hay = (m.i + " " + m.n + " " + m.l.join(" ") + " " + m.r.join(" ")).toLowerCase();
      let ok = true;
      for (const t of tokens) {
        if (!hay.includes(t)) { ok = false; break; }
      }
      if (!ok) continue;
    }
    out.push(m);
    if (out.length > 5000) break;
  }
  out.sort((a, b) => {
    // Prefer id prefix match
    if (tokens.length) {
      const t0 = tokens[0];
      const ai = a.i.toLowerCase().startsWith(t0) ? 0 : 1;
      const bi = b.i.toLowerCase().startsWith(t0) ? 0 : 1;
      if (ai !== bi) return ai - bi;
    }
    return a.i.localeCompare(b.i, "en");
  });
  return out;
}

/* ---------- detail view ---------- */

async function showDetail(id, rowEl) {
  state.selectedId = id;
  for (const r of els.motifList.querySelectorAll(".motif-row")) {
    r.classList.toggle("selected", r.dataset.id === id);
  }
  if (rowEl) rowEl.scrollIntoView({ block: "nearest" });

  els.detail.innerHTML = `<div class="detail-placeholder">Loading&hellip;</div>`;
  const m = await getMotifById(id);
  if (!m) {
    els.detail.innerHTML = `<div class="detail-placeholder">Motif ${escapeHTML(id)} not found.</div>`;
    return;
  }
  renderDetail(m);
}

function renderDetail(m) {
  const pathParts = [m.division1, m.division2, m.division3, m.section].filter(Boolean);
  const chLabel = m.chapter || "";
  const sections = [];

  sections.push(`
    <div>
      <span class="motif-id">${escapeHTML(m.motif_id || "")}</span>
      <h2>${escapeHTML(m.name || "—")}</h2>
      <div class="path">
        ${escapeHTML(chLabel)}${pathParts.length ? " &rarr; " + pathParts.map(escapeHTML).join(" &rarr; ") : ""}
      </div>
    </div>
  `);

  if (m.additional_description) {
    sections.push(detailSection("Description", `<p>${escapeHTML(m.additional_description)}</p>`));
  }

  if (m.bibliographies) {
    sections.push(detailSection("Bibliography", `<p>${escapeHTML(m.bibliographies)}</p>`));
  }

  if (m.cross_references && m.cross_references.length) {
    const links = m.cross_references
      .map(
        (x) =>
          `<button class="xref-btn" data-xref="${escapeAttr(x)}">${escapeHTML(x)}</button>`,
      )
      .join("");
    sections.push(detailSection("Cross references", links));
  }

  if (m.cultural_region && m.cultural_region.length) {
    const chips = m.cultural_region
      .map((r) => `<span class="chip region">${escapeHTML(r)}</span>`)
      .join("");
    sections.push(detailSection("Cultural regions", `<div class="chips">${chips}</div>`));
  }

  if (m.locations && m.locations.length) {
    const chips = m.locations
      .map((r) => `<span class="chip">${escapeHTML(r)}</span>`)
      .join("");
    sections.push(detailSection("Locations", `<div class="chips">${chips}</div>`));
  }

  if (m.lemmas && m.lemmas.length) {
    const chips = m.lemmas
      .map((r) => `<span class="chip">${escapeHTML(r)}</span>`)
      .join("");
    sections.push(detailSection("Lemmas", `<div class="chips">${chips}</div>`));
  }

  const metaBits = [];
  if (m.parent_id) metaBits.push(`parent: <button class="xref-btn" data-xref="${escapeAttr(m.parent_id)}">${escapeHTML(m.parent_id)}</button>`);
  if (m.first_edition_code) metaBits.push(`first edition: <code>${escapeHTML(m.first_edition_code)}</code>`);
  if (m.source_index) metaBits.push(`source: ${escapeHTML(m.source_index)}`);
  if (metaBits.length) {
    sections.push(detailSection("Meta", `<p>${metaBits.join(" &middot; ")}</p>`));
  }

  els.detail.innerHTML = sections.join("");
  for (const btn of els.detail.querySelectorAll(".xref-btn")) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.xref;
      if (id) showDetail(id);
    });
  }
}

function detailSection(title, body) {
  return `<div class="detail-section"><h3>${escapeHTML(title)}</h3>${body}</div>`;
}

/* ---------- draw generation ----------
 *
 * A "draw" is a plain object the renderer consumes regardless of its
 * source. When ATU data arrives, `generateDraw({ source: "atu" })`
 * fills in `tale_type` and tags the tale's motifs with role "core" —
 * the pipeline (rendering, permalinks, replacement) is unchanged.
 *
 *   {
 *     id:        string,                       // permalink id
 *     source:    "random" | "atu",
 *     tale_type: null | { atu_id, title, summary },
 *     motifs:    [ { role: "core"|"extra", motif_id: string } ]
 *   }
 *
 * `role` is carried but not displayed. It becomes meaningful only
 * when a draw mixes tale-type motifs with additional ones.
 */

async function generateDraw(options = {}) {
  const source = options.source || "random";
  const count = Math.max(1, Math.min(12, options.count || 5));

  if (source === "atu") {
    // Placeholder until ATU data lands:
    //   1. pick a random ATU tale type
    //   2. add its motifs as role="core"
    //   3. top up with role="extra" motifs to reach `count`
    throw new Error("ATU source not wired up yet");
  }

  const pool = state.searchIndex;
  const picks = sampleWithoutReplacement(pool, count);
  return {
    id: randomId(),
    source: "random",
    tale_type: null,
    motifs: picks.map((m) => ({ role: "extra", motif_id: m.i })),
  };
}

function sampleWithoutReplacement(arr, n) {
  const used = new Set();
  const out = [];
  const max = Math.min(n, arr.length);
  while (out.length < max) {
    const i = Math.floor(Math.random() * arr.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(arr[i]);
  }
  return out;
}

function randomId() {
  return Math.random().toString(36).slice(2, 8);
}

async function generateAndRenderDraw() {
  const count = parseInt(els.drawCount.value, 10) || 5;
  const draw = await generateDraw({ source: "random", count });
  state.currentDraw = draw;
  renderDraw(draw);
  updateHash();
}

async function renderDraw(draw) {
  els.drawId.textContent = `draw ${draw.id}`;

  const resolved = await Promise.all(
    draw.motifs.map(async (entry) => ({
      role: entry.role,
      motif: await getMotifById(entry.motif_id),
    })),
  );

  const parts = [];

  if (draw.tale_type) {
    parts.push(`
      <div class="tale-type-card">
        <div class="eyebrow">ATU ${escapeHTML(draw.tale_type.atu_id)}</div>
        <h3>${escapeHTML(draw.tale_type.title || "")}</h3>
        ${draw.tale_type.summary ? `<p>${escapeHTML(draw.tale_type.summary)}</p>` : ""}
      </div>
    `);
  }

  parts.push('<div class="draw-motifs">');
  for (const { motif } of resolved) {
    if (!motif) continue;
    parts.push(renderMotifCard(motif));
  }
  parts.push("</div>");

  els.drawBody.innerHTML = parts.join("");

  // Wire up card interactions
  for (const card of els.drawBody.querySelectorAll(".motif-card")) {
    card.addEventListener("click", (e) => {
      // Ignore clicks on inner buttons/links — they have their own handlers
      if (e.target.closest("[data-action], .card-open-link, a, button")) return;
      toggleCard(card);
    });
  }
  for (const btn of els.drawBody.querySelectorAll('[data-action="reroll"]')) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      replaceCard(btn.dataset.motifId);
    });
  }
  for (const link of els.drawBody.querySelectorAll('[data-action="open"]')) {
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      openInBrowse(link.dataset.motifId);
    });
  }
}

function renderMotifCard(m) {
  const chapterShort = (m.chapter || "").replace(/\.$/, "");
  const sectionShort = (m.section || "").replace(/\.$/, "");
  const context = [chapterShort, sectionShort].filter(Boolean).join(" · ");
  return `
    <article class="motif-card" data-motif-id="${escapeAttr(m.motif_id)}">
      <div class="card-head">
        <span class="id">${escapeHTML(m.motif_id || "—")}</span>
        <button class="reroll-btn" data-action="reroll" data-motif-id="${escapeAttr(m.motif_id)}" title="Replace this card">&#x21bb;</button>
      </div>
      <h4>${escapeHTML(m.name || "—")}</h4>
      <div class="card-context">${escapeHTML(context)}</div>
      ${renderCardExpanded(m)}
    </article>
  `;
}

function renderCardExpanded(m) {
  const parts = ['<div class="card-expanded" hidden>'];

  if (m.additional_description) {
    parts.push(`<div><span class="exp-label">Description</span><p>${escapeHTML(m.additional_description)}</p></div>`);
  }
  if (m.bibliographies) {
    parts.push(`<div><span class="exp-label">Bibliography</span><p>${escapeHTML(m.bibliographies)}</p></div>`);
  }
  if (m.cross_references && m.cross_references.length) {
    const links = m.cross_references
      .map((x) => `<span class="chip">${escapeHTML(x)}</span>`)
      .join("");
    parts.push(`<div><span class="exp-label">See also</span><div class="chips">${links}</div></div>`);
  }
  if (m.cultural_region && m.cultural_region.length) {
    const chips = m.cultural_region
      .map((r) => `<span class="chip region">${escapeHTML(r)}</span>`)
      .join("");
    parts.push(`<div><span class="exp-label">Regions</span><div class="chips">${chips}</div></div>`);
  }
  if (m.lemmas && m.lemmas.length) {
    const chips = m.lemmas
      .map((l) => `<span class="chip">${escapeHTML(l)}</span>`)
      .join("");
    parts.push(`<div><span class="exp-label">Lemmas</span><div class="chips">${chips}</div></div>`);
  }

  parts.push(`<a href="#" class="card-open-link" data-action="open" data-motif-id="${escapeAttr(m.motif_id)}">Open in Browse &rsaquo;</a>`);
  parts.push("</div>");
  return parts.join("");
}

function toggleCard(card) {
  const expanded = card.querySelector(".card-expanded");
  if (!expanded) return;
  const isOpen = !expanded.hidden;
  expanded.hidden = isOpen;
  card.classList.toggle("expanded", !isOpen);
}

function replaceCard(motifId) {
  const draw = state.currentDraw;
  if (!draw) return;
  const idx = draw.motifs.findIndex((e) => e.motif_id === motifId);
  if (idx < 0) return;
  const existing = new Set(draw.motifs.map((e) => e.motif_id));
  let replacement;
  for (let i = 0; i < 50; i++) {
    const cand = state.searchIndex[Math.floor(Math.random() * state.searchIndex.length)];
    if (!existing.has(cand.i)) {
      replacement = cand;
      break;
    }
  }
  if (!replacement) return;
  draw.motifs[idx] = { role: draw.motifs[idx].role, motif_id: replacement.i };
  draw.id = randomId();
  renderDraw(draw);
  updateHash();
}

function openInBrowse(motifId) {
  // Remember where we came from so we can offer a back pill
  if (state.currentDraw) {
    state.drawReturnHash = "tab=draw&draw=" + encodeDraw(state.currentDraw);
    els.backToDraw.hidden = false;
  }
  switchTab("browse");
  showDetail(motifId);
}

function returnToDraw() {
  if (!state.drawReturnHash) {
    switchTab("draw");
    return;
  }
  // Restore the original draw via the hash
  location.hash = "#" + state.drawReturnHash;
  els.backToDraw.hidden = true;
  state.drawReturnHash = null;
}

async function copyDrawToClipboard() {
  const draw = state.currentDraw;
  if (!draw) return;

  const lines = [];
  if (draw.tale_type) {
    lines.push(`ATU ${draw.tale_type.atu_id}: ${draw.tale_type.title}`);
    if (draw.tale_type.summary) lines.push(draw.tale_type.summary);
    lines.push("");
  }
  for (const entry of draw.motifs) {
    const m = state.detailCache.get(entry.motif_id);
    const name = m?.name || "(unknown)";
    lines.push(`- ${entry.motif_id} — ${name}`);
  }
  const text = lines.join("\n");

  try {
    await navigator.clipboard.writeText(text);
    flashCopyConfirmed();
  } catch (err) {
    console.error("Copy failed:", err);
    // Fallback: select a hidden textarea and exec copy
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      flashCopyConfirmed();
    } catch {
      alert("Could not copy. Here's the text:\n\n" + text);
    }
    ta.remove();
  }
}

function flashCopyConfirmed() {
  const btn = els.copyDrawBtn;
  const originalText = btn.textContent;
  btn.textContent = "Copied!";
  btn.classList.add("is-confirmed");
  clearTimeout(state.copyTimeout);
  state.copyTimeout = setTimeout(() => {
    btn.textContent = originalText;
    btn.classList.remove("is-confirmed");
  }, 1400);
}

/* ---------- draw permalink encoding ----------
 * Compact URL-safe form: "<source>:<id>:<motif_ids_comma_separated>"
 * Motifs with role "core" are prefixed with "*".
 */

function encodeDraw(draw) {
  const ids = draw.motifs.map((e) => (e.role === "core" ? "*" : "") + e.motif_id);
  return [draw.source, draw.id, ids.join(",")].join(":");
}

function decodeDraw(str) {
  const parts = str.split(":");
  if (parts.length < 3) return null;
  const [source, id, idsStr] = parts;
  const motifs = idsStr
    .split(",")
    .filter(Boolean)
    .map((tok) => {
      if (tok.startsWith("*")) return { role: "core", motif_id: tok.slice(1) };
      return { role: "extra", motif_id: tok };
    });
  return { id, source, tale_type: null, motifs };
}

/* ---------- utilities ---------- */

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHTML(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return escapeHTML(s);
}

function highlight(text, query) {
  if (!query) return escapeHTML(text);
  const safe = escapeHTML(text);
  const tokens = query.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!tokens.length) return safe;
  const re = new RegExp(`(${tokens.join("|")})`, "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

init().catch((err) => {
  console.error(err);
  els.motifList.innerHTML = `<div class="empty">Failed to load data: ${escapeHTML(err.message)}</div>`;
  showLoading(false);
});
