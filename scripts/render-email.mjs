import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(root, "email", "templates", "daily-digest.html");
const dashboardUrl = "https://lai-tracker.vercel.app/";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
// Escapes first, then turns **text** the caller wrote into <strong> — never
// interprets markup in raw source-derived fields, only in Claude-authored prose.
function richText(value) {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// A hardcoded 3-letter month table, not Intl's "short" month: en-GB's CLDR
// data abbreviates September as "Sept" (4 letters) while every other month
// gets 3, which would make this the one month of the year that visually
// breaks the header's fixed-width date format.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return escapeHtml(iso);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function extractBlock(html, name) {
  const re = new RegExp(`<!--${name}-->([\\s\\S]*?)<!--\\/${name}-->`);
  const match = html.match(re);
  if (!match) throw new Error(`Template is missing the ${name} block`);
  return { block: match[1], rest: html.replace(re, `{{__${name}_SLOT__}}`) };
}

function fill(template, tokens) {
  let out = template;
  for (const [key, value] of Object.entries(tokens)) out = out.replaceAll(`{{${key}}}`, value ?? "");
  return out;
}

// Every list in the digest (new findings, discovered-late, new candidates) uses
// the exact same row shape: name, date, a short summary, a source link. The only
// thing that varies per section is a single accent color carried through onto
// each of that section's items — visual richness without re-introducing a
// hierarchy between individual items within a section.
const SECTION_ACCENT = {
  findings: { accent: "#178665", soft: "#eaf7f2" },
  late: { accent: "#a87504", soft: "#fdf6e6" },
  candidates: { accent: "#6d5dad", soft: "#f2f0fa" }
};

function renderItem(item, itemTemplate, accent) {
  return fill(itemTemplate, {
    ITEM_HEADLINE: escapeHtml(item.headline),
    ITEM_DATE: formatDate(item.date),
    ITEM_SUMMARY: richText(item.summary),
    ITEM_SOURCE_URL: escapeHtml(item.sourceUrl),
    ITEM_SOURCE_NAME: escapeHtml(item.sourceName),
    ITEM_ACCENT: accent.accent,
    ITEM_ACCENT_SOFT: accent.soft
  });
}

function renderSection(items, sectionTemplate, itemTemplate, itemsTokenName, accentKey) {
  if (!items.length) return "";
  const accent = SECTION_ACCENT[accentKey];
  return fill(sectionTemplate, { [itemsTokenName]: items.map((item) => renderItem(item, itemTemplate, accent)).join("\n") });
}

function buildSubject(input) {
  const count = input.findings.length;
  if (count === 1) return `LAI update — ${input.findings[0].headline}`;
  if (count > 1) return `LAI update — ${count} new findings (incl. ${input.findings[0].headline})`;
  // No headline findings this run, but there's still something worth a subject line for.
  const parts = [];
  if (input.lateItems.length) parts.push(`${input.lateItems.length} discovered late`);
  if (input.candidates.length) parts.push(`${input.candidates.length} new candidate${input.candidates.length === 1 ? "" : "s"}`);
  if (!parts.length) return null;
  return `LAI update — ${parts.join(", ")}`;
}

function buildPreheader(input) {
  const count = input.findings.length;
  const dateLabel = formatDate(input.runDate);
  if (count === 1) return `New finding on ${dateLabel}: ${input.findings[0].headline}`;
  if (count > 1) return `${count} new findings on ${dateLabel}, including ${input.findings[0].headline}.`;
  if (input.lateItems.length || input.candidates.length) return `No new headline findings on ${dateLabel} — see what was discovered late or is pending review.`;
  return "";
}

// Pure: takes the parsed input payload and the raw template file contents,
// returns { subject, preheader, html } or null if there's nothing to report
// this run (the caller should skip drafting an email entirely in that case).
export function renderDigest(rawInput, templateHtml) {
  const input = { findings: [], lateItems: [], candidates: [], leadIn: "", ...rawInput };

  const subject = buildSubject(input);
  if (subject === null) return null;

  const { block: itemTemplate, rest: withoutItem } = extractBlock(templateHtml, "ITEM");
  const { block: findingsSectionTemplate, rest: withoutFindingsSection } = extractBlock(withoutItem, "FINDINGS_SECTION");
  const { block: lateSectionTemplate, rest: withoutLateSection } = extractBlock(withoutFindingsSection, "LATE_SECTION");
  const { block: candidatesSectionTemplate, rest: base } = extractBlock(withoutLateSection, "CANDIDATES_SECTION");

  const findingsSectionHtml = renderSection(input.findings, findingsSectionTemplate, itemTemplate, "FINDINGS_ITEMS", "findings");
  const lateSectionHtml = renderSection(input.lateItems, lateSectionTemplate, itemTemplate, "LATE_ITEMS", "late");
  const candidatesSectionHtml = renderSection(input.candidates, candidatesSectionTemplate, itemTemplate, "CANDIDATE_ITEMS", "candidates");
  const preheader = buildPreheader(input);

  const html = fill(base, {
    __FINDINGS_SECTION_SLOT__: findingsSectionHtml,
    __LATE_SECTION_SLOT__: lateSectionHtml,
    __CANDIDATES_SECTION_SLOT__: candidatesSectionHtml,
    // ITEM is only ever used as the row template fed into the three SECTION
    // templates above — its own slot in the base never holds anything directly.
    __ITEM_SLOT__: "",
    SUBJECT: escapeHtml(subject),
    PREHEADER: escapeHtml(preheader),
    RUN_DATE: formatDate(input.runDate),
    LEAD_IN: richText(input.leadIn),
    DASHBOARD_URL: escapeHtml(dashboardUrl)
  });

  return { subject, preheader, html };
}

async function main() {
  const [, , inputPath, outputPath = path.join(root, "email", "draft-output.json")] = process.argv;
  if (!inputPath) {
    console.error("Usage: node scripts/render-email.mjs <input.json> [output.json]");
    process.exitCode = 1;
    return;
  }

  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const templateHtml = await readFile(templatePath, "utf8");
  const result = renderDigest(input, templateHtml);

  if (!result) {
    console.log("Nothing to report this run — skip drafting an email entirely.");
    return;
  }

  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`Rendered digest (${input.findings?.length ?? 0} findings, ${input.lateItems?.length ?? 0} late, ${input.candidates?.length ?? 0} candidates) → ${outputPath}`);
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) main();
