"use strict";

const PAGE_SIZE = 100;
const TOP_REGIONS = 40;

const state = {
  metadata: null,
  chapters: [],
  searchIndex: [],
  chapterCache: new Map(),
  detailCache: new Map(),
  taleCategories: [],
  tales: [],
  taleById: new Map(),
  view: {
    mode: "chapter",
    chapter: "A",
    taleCategory: null,
    query: "",
    region: "",
  },
  rendered: 0,
  results: [],
  selected: null, // { type: "motif"|"tale", id: string }
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
  taleCatList: document.getElementById("tale-cat-list"),
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
  state.metadata = meta.motifs.metadata;
  state.chapters = meta.motifs.chapters;
  state.taleCategories = meta.atu.categories;
  state.atuMetadata = meta.atu.metadata;

  renderChapterList();
  renderTaleCategoryList();
  renderMeta();

  // Search index and ATU tales — both feed unified search
  const [searchIndex, atu] = await Promise.all([
    loadJSON("data/search.json"),
    loadJSON("data/atu.json"),
  ]);
  state.searchIndex = searchIndex;
  state.tales = atu.tales;
  for (const t of atu.tales) state.taleById.set(t.atu_id, t);
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
    btn.className = "nav-btn";
    btn.dataset.kind = "chapter";
    btn.dataset.value = ch.letter;
    btn.innerHTML = `
      <span class="letter">${ch.letter}</span>
      <span class="title">${escapeHTML(trimChapterTitle(ch.title))}</span>
      <span class="count">${ch.count.toLocaleString()}</span>`;
    btn.addEventListener("click", () => selectChapter(ch.letter));
    li.appendChild(btn);
    els.chapterList.appendChild(li);
  }
}

function renderTaleCategoryList() {
  els.taleCatList.innerHTML = "";
  for (const cat of state.taleCategories) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "nav-btn";
    btn.dataset.kind = "tale-cat";
    btn.dataset.value = cat.name;
    btn.innerHTML = `
      <span class="title">${escapeHTML(cat.name)}</span>
      <span class="count">${cat.count.toLocaleString()}</span>`;
    btn.addEventListener("click", () => selectTaleCategory(cat.name));
    li.appendChild(btn);
    els.taleCatList.appendChild(li);
  }
}

function trimChapterTitle(t) {
  return t.replace(/^[A-Z]\.\s*/, "").replace(/\.$/, "");
}

function renderMeta() {
  const m = state.metadata;
  if (!m) return;
  const taleCount = state.atuMetadata?.total_tales || 0;
  els.metaBlock.innerHTML = `
    <strong>${m.total_motifs.toLocaleString()}</strong> motifs
    across <strong>${m.chapters}</strong> chapters.<br/>
    <strong>${taleCount.toLocaleString()}</strong> ATU tale types
    across <strong>${state.taleCategories.length}</strong> categories.<br/>
    <em>${escapeHTML(m.source_edition || "")}</em>
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
  state.view = {
    mode: "chapter",
    chapter: letter,
    taleCategory: null,
    query: "",
    region: state.view.region,
  };
  els.search.value = "";
  highlightSidebar();
  await renderList();
}

async function selectTaleCategory(name) {
  state.view = {
    mode: "tale-category",
    chapter: null,
    taleCategory: name,
    query: "",
    region: state.view.region,
  };
  els.search.value = "";
  highlightSidebar();
  await renderList();
}

function highlightSidebar() {
  const v = state.view;
  const inSearch = v.mode === "search";
  for (const b of document.querySelectorAll(".sidebar .nav-btn")) {
    let active = false;
    if (!inSearch) {
      if (b.dataset.kind === "chapter") active = b.dataset.value === v.chapter;
      else if (b.dataset.kind === "tale-cat") active = b.dataset.value === v.taleCategory;
    }
    b.classList.toggle("active", active);
  }
}

function onSearch(e) {
  const q = e.target.value.trim();
  if (!q && state.view.mode === "search") {
    // Returning from search — restore the previous browse mode
    if (state.view.taleCategory) selectTaleCategory(state.view.taleCategory);
    else selectChapter(state.view.chapter || "A");
    return;
  }
  state.view = {
    mode: "search",
    chapter: state.view.chapter,
    taleCategory: state.view.taleCategory,
    query: q,
    region: state.view.region,
  };
  highlightSidebar();
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

  let results = [];
  const v = state.view;

  if (v.mode === "search") {
    results = runSearch(v.query, v.region);
  } else if (v.mode === "chapter") {
    const motifs = await getChapter(v.chapter);
    let filtered = motifs;
    if (v.region) {
      filtered = filtered.filter((m) =>
        (m.cultural_region || []).includes(v.region),
      );
    }
    results = filtered.map((m) => ({
      type: "motif",
      i: m.motif_id,
      n: m.name,
      c: v.chapter,
      s: m.section,
      l: m.lemmas || [],
      r: m.cultural_region || [],
    }));
    results.sort((a, b) => a.i.localeCompare(b.i, "en"));
  } else if (v.mode === "tale-category") {
    const tales = state.tales.filter((t) => t.category === v.taleCategory);
    results = tales.map((t) => ({
      type: "tale",
      i: t.atu_id,
      n: t.title,
      c: t.category,
      s: t.subsection,
    }));
    results.sort(sortByTaleId);
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

// ATU ids are mostly numeric ("1", "923", "1725") with occasional
// letter suffixes ("910K", "1453K"). Sort by leading number, then suffix.
function sortByTaleId(a, b) {
  const an = parseInt(a.i, 10);
  const bn = parseInt(b.i, 10);
  if (an !== bn) return an - bn;
  return a.i.localeCompare(b.i, "en");
}

function updateBreadcrumb() {
  const v = state.view;
  const parts = [];
  if (v.mode === "search") {
    parts.push(`<strong>Search:</strong> "${escapeHTML(v.query)}"`);
  } else if (v.mode === "chapter") {
    const ch = state.chapters.find((c) => c.letter === v.chapter);
    if (ch) parts.push(`<strong>${ch.letter}.</strong> ${escapeHTML(trimChapterTitle(ch.title))}`);
  } else if (v.mode === "tale-category") {
    parts.push(`<strong>Tale types:</strong> ${escapeHTML(v.taleCategory)}`);
  }
  if (v.region) parts.push(`region: ${escapeHTML(v.region)}`);
  els.breadcrumb.innerHTML = parts.join(" &middot; ");
}

function updateListHeader(total) {
  let label = "results";
  const v = state.view;
  if (v.mode === "chapter") label = total === 1 ? "motif" : "motifs";
  else if (v.mode === "tale-category") label = total === 1 ? "tale" : "tales";
  else label = total === 1 ? "match" : "matches";
  els.listHeader.innerHTML = `<span>${total.toLocaleString()} ${label}</span>`;
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

  for (const item of slice) {
    const row = document.createElement("div");
    row.className = "motif-row";
    row.dataset.type = item.type;
    row.dataset.id = item.i;
    if (
      state.selected &&
      state.selected.type === item.type &&
      state.selected.id === item.i
    ) {
      row.classList.add("selected");
    }

    let tags = [];
    let idDisplay = escapeHTML(item.i || "—");
    if (item.type === "tale") {
      idDisplay = `ATU ${idDisplay}`;
      if (item.s) tags = [item.s];
      else if (item.c) tags = [item.c];
    } else {
      if (item.r && item.r.length) tags = item.r.slice(0, 2);
    }

    row.innerHTML = `
      <div class="id">${idDisplay}</div>
      <div class="name">${highlight(item.n, q)}</div>
      <div class="tags">${tags
        .map((t) => `<span class="tag">${escapeHTML(t)}</span>`)
        .join("")}</div>
    `;
    row.addEventListener("click", () => showDetail(item.i, row, item.type));
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

  const motifResults = [];
  for (const m of state.searchIndex) {
    if (region && !m.r.includes(region)) continue;
    if (tokens.length) {
      const hay = (m.i + " " + m.n + " " + m.l.join(" ") + " " + m.r.join(" ")).toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) continue;
    }
    motifResults.push({ ...m, type: "motif" });
    if (motifResults.length > 5000) break;
  }

  // Tales don't carry region data — region filter excludes them entirely.
  const taleResults = [];
  if (!region && tokens.length) {
    for (const t of state.tales) {
      const hay = (
        t.atu_id + " " +
        t.title + " " +
        t.category + " " +
        t.subsection + " " +
        (t.notes || "") + " " +
        t.exemplars.join(" ")
      ).toLowerCase();
      if (!tokens.every((tk) => hay.includes(tk))) continue;
      taleResults.push({
        type: "tale",
        i: t.atu_id,
        n: t.title,
        c: t.category,
        s: t.subsection,
      });
    }
    taleResults.sort(sortByTaleId);
  }

  motifResults.sort((a, b) => {
    if (tokens.length) {
      const t0 = tokens[0];
      const ai = a.i.toLowerCase().startsWith(t0) ? 0 : 1;
      const bi = b.i.toLowerCase().startsWith(t0) ? 0 : 1;
      if (ai !== bi) return ai - bi;
    }
    return a.i.localeCompare(b.i, "en");
  });

  // Tales first (smaller, more "newsworthy"), then motifs.
  return [...taleResults, ...motifResults];
}

/* ---------- detail view ---------- */

async function showDetail(id, rowEl, type = "motif") {
  state.selected = { type, id };
  for (const r of els.motifList.querySelectorAll(".motif-row")) {
    r.classList.toggle(
      "selected",
      r.dataset.type === type && r.dataset.id === id,
    );
  }
  if (rowEl) rowEl.scrollIntoView({ block: "nearest" });

  els.detail.innerHTML = `<div class="detail-placeholder">Loading&hellip;</div>`;
  if (type === "tale") {
    const t = state.taleById.get(id);
    if (!t) {
      els.detail.innerHTML = `<div class="detail-placeholder">Tale ATU ${escapeHTML(id)} not found.</div>`;
      return;
    }
    renderTaleDetail(t);
    return;
  }
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

function renderTaleDetail(t) {
  const sections = [];

  sections.push(`
    <div>
      <span class="motif-id">ATU ${escapeHTML(t.atu_id)}</span>
      <h2>${escapeHTML(t.title)}</h2>
      <div class="path">
        ${escapeHTML(t.category)}${t.subsection ? " &rarr; " + escapeHTML(t.subsection) : ""}
      </div>
    </div>
  `);

  if (t.notes) {
    sections.push(detailSection("Notes", `<p>${escapeHTML(t.notes)}</p>`));
  }

  if (t.exemplars && t.exemplars.length) {
    const items = t.exemplars
      .map((e) => `<li>${escapeHTML(e)}</li>`)
      .join("");
    sections.push(
      detailSection("Exemplar tales", `<ul class="exemplar-list">${items}</ul>`),
    );
  }

  els.detail.innerHTML = sections.join("");
}

/* ---------- draw generation ----------
 *
 * A "draw" is a plain object the renderer consumes regardless of its
 * source. Right now every draw is built around a random ATU tale
 * type with motifs sampled heuristically from chapters that fit the
 * tale's category (no direct ATU-to-motif references exist in the
 * open-source ATU index, so we use category->chapter mapping).
 *
 *   {
 *     id:        string,                       // permalink id
 *     source:    "atu",
 *     tale_type: { atu_id, title, category, subsection, notes, exemplars },
 *     motifs:    [ { role: "extra", motif_id: string } ]
 *   }
 *
 * `role` is carried but not displayed. It becomes meaningful only
 * when/if a draw mixes core (tale-type-defined) motifs with extras.
 */

// ATU category -> Thompson chapter letters that are thematically aligned.
// When a draw picks an ATU type, motifs are sampled from these chapters.
const ATU_TO_CHAPTERS = {
  "Animal Tales": ["B", "K", "J"],
  "Tales of Magic": ["D", "F", "G", "H", "E"],
  "Religious Tales": ["V", "Q", "L"],
  "Realistic Tales": ["P", "T", "N", "W"],
  "Stupid Ogre": ["G", "J"],
  "Anecdotes and Jokes": ["X", "J"],
  "Formula Tales": ["Z"],
};

function chaptersForCategory(category) {
  return ATU_TO_CHAPTERS[category] || [];
}

function motifPoolForCategory(category) {
  const letters = chaptersForCategory(category);
  if (!letters.length) return state.searchIndex;
  const set = new Set(letters);
  return state.searchIndex.filter((m) => set.has(m.c));
}

async function generateDraw(options = {}) {
  const count = Math.max(1, Math.min(12, options.count || 5));

  if (!state.tales.length) {
    throw new Error("ATU data not loaded yet");
  }

  // Pick a random tale type
  const tale = state.tales[Math.floor(Math.random() * state.tales.length)];

  // Sample motifs from chapters mapped to the tale's category
  const pool = motifPoolForCategory(tale.category);
  const picks = sampleWithoutReplacement(pool, count);

  return {
    id: randomId(),
    source: "atu",
    tale_type: {
      atu_id: tale.atu_id,
      title: tale.title,
      category: tale.category,
      subsection: tale.subsection,
      notes: tale.notes,
      exemplars: tale.exemplars,
    },
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
    const t = draw.tale_type;
    parts.push(`
      <div class="tale-type-card">
        <div class="eyebrow">ATU ${escapeHTML(t.atu_id)} &middot; ${escapeHTML(t.category || "")}</div>
        <h3>${escapeHTML(t.title || "")}</h3>
        ${t.notes ? `<p>${escapeHTML(t.notes)}</p>` : ""}
        <a href="#" class="card-open-link" data-action="open-tale" data-tale-id="${escapeAttr(t.atu_id)}">Open in Browse &rsaquo;</a>
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
      openInBrowse(link.dataset.motifId, "motif");
    });
  }
  for (const link of els.drawBody.querySelectorAll('[data-action="open-tale"]')) {
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      openInBrowse(link.dataset.taleId, "tale");
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

  // Keep replacements within the same category-mapped chapter pool so
  // the draw stays thematically coherent.
  const pool = draw.tale_type
    ? motifPoolForCategory(draw.tale_type.category)
    : state.searchIndex;
  const existing = new Set(draw.motifs.map((e) => e.motif_id));
  let replacement;
  for (let i = 0; i < 50; i++) {
    const cand = pool[Math.floor(Math.random() * pool.length)];
    if (cand && !existing.has(cand.i)) {
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

async function openInBrowse(id, type = "motif") {
  // Remember where we came from so we can offer a back pill
  if (state.currentDraw) {
    state.drawReturnHash = "tab=draw&draw=" + encodeDraw(state.currentDraw);
    els.backToDraw.hidden = false;
  }
  switchTab("browse");

  // Auto-navigate the list pane so the detail has surrounding context
  if (type === "tale") {
    const t = state.taleById.get(id);
    if (t && state.view.taleCategory !== t.category) {
      await selectTaleCategory(t.category);
    }
    showDetail(id, null, "tale");
  } else {
    const m = await getMotifById(id);
    if (m) {
      const letter = (m.chapter || "").split(".")[0].trim();
      if (letter && state.view.chapter !== letter) {
        await selectChapter(letter);
      }
    }
    showDetail(id, null, "motif");
  }
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
    const t = draw.tale_type;
    lines.push(`ATU ${t.atu_id}: ${t.title}${t.category ? ` (${t.category})` : ""}`);
    if (t.notes) lines.push(t.notes);
    lines.push("");
    lines.push("Motifs:");
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
  btn.classList.add("is-confirmed");
  clearTimeout(state.copyTimeout);
  state.copyTimeout = setTimeout(() => {
    btn.classList.remove("is-confirmed");
  }, 1400);
}

/* ---------- draw permalink encoding ----------
 * Format: "<source>:<id>:<atu_id_or_blank>:<motif_ids_comma_separated>"
 * The tale_type is recovered from state.taleById on decode.
 * Legacy 3-part format (no atu_id slot) is still accepted.
 */

function encodeDraw(draw) {
  const taleId = draw.tale_type?.atu_id || "";
  const ids = draw.motifs.map((e) => e.motif_id).join(",");
  return [draw.source, draw.id, taleId, ids].join(":");
}

function decodeDraw(str) {
  const parts = str.split(":");
  if (parts.length < 3) return null;

  let source, id, taleId, idsStr;
  if (parts.length === 3) {
    [source, id, idsStr] = parts;
    taleId = "";
  } else {
    [source, id, taleId, idsStr] = parts;
  }

  let tale_type = null;
  if (taleId) {
    const t = state.taleById.get(taleId);
    if (t) {
      tale_type = {
        atu_id: t.atu_id,
        title: t.title,
        category: t.category,
        subsection: t.subsection,
        notes: t.notes,
        exemplars: t.exemplars,
      };
    }
  }

  const motifs = idsStr
    .split(",")
    .filter(Boolean)
    .map((mid) => ({ role: "extra", motif_id: mid }));

  return { id, source, tale_type, motifs };
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
