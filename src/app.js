import { FAMILY_COLORS, FAMILY_LABELS, FINDING_LABELS, STAGE_COLORS, STAGES, formatDate, prepareDatabase, safeUrl, truncate } from "./model.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { data: null, programQuery: "", stage: "all", archiveQuery: "", evidenceType: "all", archiveLimit: 40 };

function node(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const clear = (element) => { element.replaceChildren(); return element; };
const badge = (text, tone = "blue") => node("span", `pill pill-${tone}`, text);
const firstSentence = (value) => truncate(String(value || "Update recorded").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0], 125);

function sourceAnchor(value, label = "Source ↗") {
  const anchor = node("a", "source-link", label);
  const url = safeUrl(value);
  if (!url) {
    anchor.textContent = "No link";
    anchor.setAttribute("aria-disabled", "true");
    return anchor;
  }
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function renderHeader(data) {
  const displayDate = formatDate(data.latestDataDate, true);
  $("#latest-date").textContent = displayDate;
  $("#mobile-date").textContent = displayDate;
  $("#rail-freshness").textContent = `${data.records.length} programs · ${displayDate}`;
  $("#footer-status").textContent = `Repository snapshot · ${displayDate}`;
}

function renderOverview(data) {
  const programs = [...data.semaglutidePrograms].sort((a, b) =>
    b.stageOrder - a.stageOrder || String(b.current_status?.last_updated ?? "").localeCompare(String(a.current_status?.last_updated ?? ""))
  );
  $("#race-caption").textContent = `${programs.length} directly identified programs · Quject®Sphere shown in green`;
  const chart = clear($("#race-chart"));
  programs.forEach((program) => {
    const row = node("div", `race-row${program.isOurProduct ? " ours" : ""}`);
    const name = node("div", "race-name");
    name.append(node("strong", "", `${truncate(program.program, 38)}${program.isOurProduct ? " ★" : ""}`), node("span", "", program.company));
    const track = node("div", "race-track");
    const bar = node("div", "race-bar", program.stageLabel);
    bar.style.width = `${Math.max(7, Math.min(100, (Math.max(program.stageOrder, .35) / 6) * 100))}%`;
    bar.style.background = program.isOurProduct ? "#178665" : STAGE_COLORS[program.stageLabel];
    track.append(bar);
    row.append(name, track);
    chart.append(row);
  });

  $("#leader-company").textContent = data.leader.company;
  $("#leader-program").textContent = data.leader.program;
  $("#leader-stage").textContent = data.leader.stageLabel;
  $("#leader-summary").textContent = truncate(data.leader.current_status?.stage, 330);

  const conditions = [
    ["01", "Tracked intelligence", data.records.length, "Accepted", "blue", `${data.findings.length} evidence items accepted into the historical record.`, "#367fd0"],
    ["02", "Pending review", data.pendingCandidates.length, "Analyst queue", "amber", "Newly detected entities awaiting an analyst decision before entering the tracker.", "#e4a11b"],
    ["03", "Monitoring & QC", `${data.completedRuns}/4`, data.completedRuns ? "Active" : "Awaiting run", data.completedRuns ? "green" : "orange", data.completedRuns ? "Scheduled scan and quality-control runs are recorded in meta.json." : "Initial seed loaded; scheduled daily, weekly and QC runs have not yet been recorded.", "#2bb98a"]
  ];
  const container = clear($("#tracking-conditions"));
  conditions.forEach(([index, label, value, badgeText, tone, detail, color]) => {
    const card = node("article", "condition-card");
    card.style.setProperty("--tone", color);
    const top = node("div", "condition-top");
    top.append(node("span", "condition-label", label), node("span", "condition-index", index));
    card.append(top, node("h3", "", String(value)), badge(badgeText, tone), node("p", "", detail));
    container.append(card);
  });
}

function renderIntelligence(data) {
  const feed = clear($("#latest-feed"));
  data.findings.slice(0, 6).forEach((finding) => {
    const article = node("article", "feed-item");
    const meta = node("div", "feed-meta");
    meta.append(node("strong", "", formatDate(finding.date, true)), node("span", "", finding.company));
    const copy = node("div", "feed-copy");
    copy.append(node("h3", "", firstSentence(finding.summary)), node("p", "", truncate(finding.summary, 300)));
    const tone = { trial_data_readout: "blue", regulatory: "violet", deal_partnership: "green", market_reaction: "orange", manufacturing_capacity: "amber" }[finding.type] ?? "blue";
    const tag = node("span", `tag pill-${tone}`, FINDING_LABELS[finding.type] ?? String(finding.type).replaceAll("_", " "));
    copy.append(tag);
    article.append(meta, copy, sourceAnchor(finding.sourceUrl));
    feed.append(article);
  });

  const newest = data.findings[0]?.timestamp ?? Date.now();
  const recent = data.findings.filter((finding) => finding.timestamp >= newest - 30 * 86400000);
  const counts = new Map();
  recent.forEach((finding) => counts.set(finding.type, (counts.get(finding.type) ?? 0) + 1));
  const topType = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const items = [
    ["Development lead", `${data.leader.company} · ${data.leader.stageLabel}`],
    ["30-day signal volume", `${recent.length} findings${topType ? `; ${FINDING_LABELS[topType] ?? topType} is most frequent` : ""}.`],
    ["Analyst attention", `${data.pendingCandidates.length} candidate entities await review.`],
    ["Monitoring state", data.completedRuns ? `${data.completedRuns} of 4 scheduled scan/QC timestamps are recorded.` : "Scheduled scan and QC timestamps have not yet been populated."]
  ];
  const readout = clear($("#readout"));
  items.forEach(([title, body]) => {
    const item = node("div", "readout-item");
    item.append(node("strong", "", title), node("p", "", body));
    readout.append(item);
  });
}

function renderStatistics(data) {
  const confirmed = data.findings.filter((finding) => finding.confidence === "confirmed").length;
  const korean = data.records.filter((record) => record.origin === "KR").length;
  const values = [
    [data.records.length, "Programs tracked", `${korean} Korean · ${data.records.length - korean} global`],
    [data.semaglutidePrograms.length, "Semaglutide-linked", "Direct delivery programs identified"],
    [data.findings.length, "Historical findings", "Complete source-backed archive"],
    [confirmed, "Confirmed evidence", `${data.findings.length - confirmed} marked unverified`]
  ];
  const metrics = clear($("#metrics"));
  values.forEach(([value, label, detail]) => {
    const card = node("article", "metric");
    card.append(node("strong", "", String(value)), node("span", "", label), node("small", "", detail));
    metrics.append(card);
  });

  const familyCounts = new Map();
  data.records.forEach((record) => familyCounts.set(record.technology_family ?? "other", (familyCounts.get(record.technology_family ?? "other") ?? 0) + 1));
  const families = [...familyCounts].sort((a, b) => b[1] - a[1]);
  const maximum = Math.max(...families.map(([, count]) => count), 1);
  const chart = clear($("#family-chart"));
  families.forEach(([family, count]) => {
    const row = node("div", "family-row");
    const track = node("div", "family-track");
    const bar = node("div", "family-bar");
    bar.style.width = `${count / maximum * 100}%`;
    bar.style.background = FAMILY_COLORS[family] ?? FAMILY_COLORS.other;
    track.append(bar);
    row.append(node("span", "", FAMILY_LABELS[family] ?? family.replaceAll("_", " ")), track, node("strong", "", String(count)));
    chart.append(row);

  });

  const percent = data.findings.length ? Math.round(confirmed / data.findings.length * 100) : 0;
  const wrap = node("div", "donut-wrap");
  const donut = node("div", "donut");
  donut.style.setProperty("--confirmed", percent);
  const label = node("div", "donut-label");
  label.append(node("strong", "", `${percent}%`), node("span", "", "confirmed"));
  donut.append(label);
  const legend = node("div", "legend");
  [["#2bb98a", "Confirmed", confirmed], ["#e4a11b", "Unverified", data.findings.length - confirmed]].forEach(([color, name, count]) => {
    const row = node("div", "legend-row");
    const dot = node("span", "legend-dot"); dot.style.background = color;
    row.append(dot, node("span", "", name), node("strong", "", String(count)));
    legend.append(row);
  });
  wrap.append(donut, legend);
  clear($("#evidence-chart")).append(wrap);
}

function stageBadge(stage) {
  const element = node("span", "stage-badge", stage);
  element.style.setProperty("--stage-color", STAGE_COLORS[stage]);
  return element;
}

function tableCell(label, content, secondary) {
  const cell = node("td");
  cell.dataset.label = label;
  cell.append(content instanceof Node ? content : node("strong", "", content || "—"));
  if (secondary) cell.append(node("span", "", secondary));
  return cell;
}

function filteredPrograms() {
  const query = state.programQuery.trim().toLowerCase();
  return [...state.data.records]
    .filter((record) => state.stage === "all" || record.stageLabel === state.stage)
    .filter((record) => !query || [record.canonical_name, record.technology_family, record.current_status?.stage].join(" ").toLowerCase().includes(query))
    .sort((a, b) => b.stageOrder - a.stageOrder || String(b.current_status?.last_updated ?? "").localeCompare(String(a.current_status?.last_updated ?? "")));
}

function renderPrograms() {
  const records = filteredPrograms();
  const body = clear($("#program-table"));
  $("#program-empty").hidden = records.length > 0;
  records.forEach((record) => {
    const row = node("tr");
    row.append(
      tableCell("Program", record.company, record.program),
      tableCell("Origin", record.origin === "KR" ? "Korea" : record.origin),
      tableCell("Technology", FAMILY_LABELS[record.technology_family] ?? record.technology_family?.replaceAll("_", " ")),
      tableCell("Stage", stageBadge(record.stageLabel)),
      tableCell("Status", truncate(record.current_status?.stage, 190)),
      tableCell("Updated", formatDate(record.current_status?.last_updated, true))
    );
    body.append(row);
  });
}

function renderCandidates(data) {
  const container = clear($("#candidate-list"));
  data.pendingCandidates.forEach((candidate) => {
    const card = node("article", "candidate-card");
    card.append(badge("Pending analyst review", "amber"), node("h3", "", candidate.detected_name ?? "Unnamed candidate"));
    const evidence = [...(candidate.evidence ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    card.append(node("p", "", truncate(evidence?.snippet ?? "No evidence summary available.", 260)));
    const footer = node("footer");
    const score = Number(candidate.fuzzy_match?.score);
    footer.append(node("span", "", Number.isFinite(score) ? `Closest-match score ${score.toFixed(2)}` : "No match score"));
    const url = safeUrl(evidence?.source?.url);
    if (url) { const link = node("a", "", "Review source ↗"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; footer.append(link); }
    card.append(footer);
    container.append(card);
  });
  if (!data.pendingCandidates.length) container.append(node("div", "empty-state panel", "No candidates are awaiting review."));
}

function filteredEvidence() {
  const query = state.archiveQuery.trim().toLowerCase();
  return state.data.findings.filter((finding) =>
    (state.evidenceType === "all" || finding.type === state.evidenceType) &&
    (!query || [finding.company, finding.program, finding.summary, finding.sourceName].join(" ").toLowerCase().includes(query))
  );
}

function renderArchive() {
  const all = filteredEvidence();
  const visible = all.slice(0, state.archiveLimit);
  const list = clear($("#archive-list"));
  visible.forEach((finding) => {
    const item = node("article", "archive-item");
    const date = node("div", "archive-date");
    date.append(node("strong", "", formatDate(finding.date, true)), node("span", "", finding.confidence === "confirmed" ? "Confirmed" : "Unverified"));
    const entity = node("div", "archive-entity");
    entity.append(node("strong", "", finding.company), node("span", "", truncate(finding.program, 72)));
    const copy = node("div", "archive-copy");
    copy.append(node("p", "", finding.summary), node("small", "", `${FINDING_LABELS[finding.type] ?? finding.type} · ${finding.sourceName} · Tier ${finding.sourceTier ?? "—"}`));
    const source = node("div", "archive-source");
    const url = safeUrl(finding.sourceUrl);
    if (url) { const link = node("a", "", "Open ↗"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; source.append(link); }
    else source.append(node("span", "", "—"));
    item.append(date, entity, copy, source);
    list.append(item);
  });
  if (!visible.length) list.append(node("div", "empty-state", "No evidence matches these filters."));
  const more = $("#show-more");
  more.hidden = visible.length >= all.length;
  more.textContent = `Show more evidence (${visible.length} of ${all.length})`;
}

const csvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
function downloadCsv(fileName, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click(); anchor.remove();
  URL.revokeObjectURL(url);
}

function populateFilters(data) {
  [...new Set(data.records.map((record) => record.stageLabel))].sort((a, b) => STAGES[b] - STAGES[a]).forEach((stage) => {
    const option = node("option", "", stage); option.value = stage; $("#stage-filter").append(option);
  });
  [...new Set(data.findings.map((finding) => finding.type))].sort().forEach((type) => {
    const option = node("option", "", FINDING_LABELS[type] ?? type.replaceAll("_", " ")); option.value = type; $("#evidence-filter").append(option);
  });
}

function bindEvents() {
  $("#program-search").addEventListener("input", (event) => { state.programQuery = event.target.value; renderPrograms(); });
  $("#stage-filter").addEventListener("change", (event) => { state.stage = event.target.value; renderPrograms(); });
  $("#archive-search").addEventListener("input", (event) => { state.archiveQuery = event.target.value; state.archiveLimit = 40; renderArchive(); });
  $("#evidence-filter").addEventListener("change", (event) => { state.evidenceType = event.target.value; state.archiveLimit = 40; renderArchive(); });
  $("#show-more").addEventListener("click", () => { state.archiveLimit += 40; renderArchive(); });
  $("#program-export").addEventListener("click", () => downloadCsv("lai-programs.csv", ["Program", "Origin", "Technology", "Normalized stage", "Reported status", "Dosing target", "Updated"], filteredPrograms().map((record) => [record.canonical_name, record.origin, FAMILY_LABELS[record.technology_family] ?? record.technology_family, record.stageLabel, record.current_status?.stage, record.current_status?.dosing_target, record.current_status?.last_updated])));
  $("#archive-export").addEventListener("click", () => downloadCsv("lai-evidence.csv", ["Date", "Company", "Program", "Type", "Finding", "Confidence", "Source", "Tier", "URL"], filteredEvidence().map((finding) => [finding.date, finding.company, finding.program, FINDING_LABELS[finding.type] ?? finding.type, finding.summary, finding.confidence, finding.sourceName, finding.sourceTier, finding.sourceUrl])));
}

function enableScrollSpy() {
  const links = $$('[data-nav]');
  const activate = (id) => links.forEach((link) => link.classList.toggle("is-current", link.dataset.nav === id));
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) activate(visible.target.id);
  }, { rootMargin: "-15% 0px -65% 0px", threshold: [0, .1, .4] });
  ["overview", "intelligence", "statistics", "programs", "review", "archive"].forEach((id) => observer.observe(document.getElementById(id)));
  links.forEach((link) => link.addEventListener("click", () => activate(link.dataset.nav)));
}

async function start() {
  try {
    const response = await fetch("/data/dashboard.json", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Database request failed (${response.status})`);
    const data = prepareDatabase(await response.json());
    if (!data.records.length) throw new Error("The dashboard database contains no accepted records.");
    state.data = data;
    renderHeader(data); renderOverview(data); renderIntelligence(data); renderStatistics(data);
    populateFilters(data); renderPrograms(); renderCandidates(data); renderArchive(); bindEvents(); enableScrollSpy();
    $("#app-status").hidden = true;
  } catch (error) {
    const status = $("#app-status");
    status.classList.add("error");
    status.replaceChildren(node("strong", "", "Dashboard unavailable."), document.createTextNode(` ${error.message}`));
    console.error(error);
  }
}

start();
