import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(root, "email", "templates", "daily-digest.html");
const dashboardUrl = "https://lai-tracker.vercel.app/";

const TYPE_TONE = {
  trial_data_readout: { bg: "#e9f2fc", fg: "#245f9f", label: "CLINICAL / DATA" },
  regulatory: { bg: "#efecf8", fg: "#6d5dad", label: "REGULATORY" },
  deal_partnership: { bg: "#e6f6f0", fg: "#178665", label: "PARTNERSHIP" },
  market_reaction: { bg: "#fff0e9", fg: "#dc6336", label: "MARKET REACTION" },
  manufacturing_capacity: { bg: "#fff5d9", fg: "#a87504", label: "MANUFACTURING" },
  financing_investor: { bg: "#e9f2fc", fg: "#245f9f", label: "FINANCING" }
};
const CONFIDENCE_TONE = {
  confirmed: { bg: "#e6f6f0", fg: "#178665", label: "CONFIRMED" },
  unverified: { bg: "#fff5d9", fg: "#a87504", label: "UNVERIFIED" }
};

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
function formatRunDate(iso) {
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

function renderCard(finding, cardTemplate) {
  const type = TYPE_TONE[finding.type] ?? TYPE_TONE.regulatory;
  const confidence = CONFIDENCE_TONE[finding.confidence] ?? CONFIDENCE_TONE.unverified;
  const hasStageChange = finding.stageChange?.from && finding.stageChange?.to;
  const hasImpact = hasStageChange || finding.impactNote;
  const impactRow = !hasImpact ? "" : `<div style="padding:12px 0;border-top:1px solid #e3e4df;"><div style="color:#85888d;font-size:9px;font-weight:800;letter-spacing:1px;">TRACKER IMPACT</div><div style="padding-top:6px;color:#42464b;font-size:13px;line-height:19px;">${
    hasStageChange ? `<strong style="color:#111317;">Stage updated: ${escapeHtml(finding.stageChange.from)} → ${escapeHtml(finding.stageChange.to)}.</strong> ` : ""
  }${finding.impactNote ? richText(finding.impactNote) : ""}</div></div>`;
  const evidenceLine = `${confidence.label.charAt(0)}${confidence.label.slice(1).toLowerCase()} &nbsp;·&nbsp; Tier ${finding.sourceTier ?? "—"} source &nbsp;·&nbsp; ${escapeHtml(finding.findingId ?? "—")}`;

  return fill(cardTemplate, {
    CARD_TYPE_BG: type.bg, CARD_TYPE_FG: type.fg, CARD_TYPE_LABEL: type.label,
    CARD_CONFIDENCE_BG: confidence.bg, CARD_CONFIDENCE_FG: confidence.fg, CARD_CONFIDENCE_LABEL: `NEW FINDING · ${confidence.label}`,
    CARD_HEADLINE: escapeHtml(finding.headline),
    CARD_SUBTITLE: escapeHtml(finding.subtitle),
    CARD_WHY: richText(finding.why),
    CARD_WHAT_HAPPENED: escapeHtml(finding.whatHappened),
    CARD_IMPACT_ROW: impactRow,
    CARD_WATCH_NEXT: richText(finding.watchNext),
    CARD_EVIDENCE_LINE: evidenceLine,
    CARD_SOURCE_URL: escapeHtml(finding.sourceUrl),
    CARD_SOURCE_NAME: escapeHtml(finding.sourceName)
  });
}

function renderLateItem(item, template) {
  return fill(template, {
    LATE_HEADLINE: escapeHtml(item.headline),
    LATE_ORIGINAL_DATE: escapeHtml(item.originalDate),
    LATE_SUMMARY: escapeHtml(item.summary),
    LATE_SOURCE_URL: escapeHtml(item.sourceUrl),
    LATE_SOURCE_NAME: escapeHtml(item.sourceName)
  });
}

function renderCandidateItem(candidate, template) {
  return fill(template, {
    CAND_NAME: escapeHtml(candidate.name),
    CAND_SNIPPET: escapeHtml(candidate.snippet),
    CAND_SOURCE_URL: escapeHtml(candidate.sourceUrl),
    CAND_SOURCE_NAME: escapeHtml(candidate.sourceName)
  });
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
  const dateLabel = formatRunDate(input.runDate);
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

  const { block: cardTemplate, rest: withoutCard } = extractBlock(templateHtml, "CARD");
  const { block: lateSectionTemplate, rest: withoutLateSection } = extractBlock(withoutCard, "LATE_SECTION");
  const { block: lateItemTemplate, rest: withoutLateItem } = extractBlock(withoutLateSection, "LATE_ITEM");
  const { block: candidatesSectionTemplate, rest: withoutCandidatesSection } = extractBlock(withoutLateItem, "CANDIDATES_SECTION");
  const { block: candidateItemTemplate, rest: base } = extractBlock(withoutCandidatesSection, "CANDIDATE_ITEM");

  const cardsHtml = input.findings.map((finding) => renderCard(finding, cardTemplate)).join("\n");
  const lateSectionHtml = !input.lateItems.length ? "" : fill(lateSectionTemplate, {
    LATE_ITEMS: input.lateItems.map((item) => renderLateItem(item, lateItemTemplate)).join("\n")
  });
  const candidatesSectionHtml = !input.candidates.length ? "" : fill(candidatesSectionTemplate, {
    CANDIDATE_ITEMS: input.candidates.map((candidate) => renderCandidateItem(candidate, candidateItemTemplate)).join("\n")
  });
  const preheader = buildPreheader(input);

  const html = fill(base, {
    __CARD_SLOT__: cardsHtml,
    __LATE_SECTION_SLOT__: lateSectionHtml,
    __CANDIDATES_SECTION_SLOT__: candidatesSectionHtml,
    // LATE_ITEM and CANDIDATE_ITEM are only ever used as row templates fed into
    // the two SECTION templates above — their own slot in the base is never
    // meant to hold anything, so it's always cleared here.
    __LATE_ITEM_SLOT__: "",
    __CANDIDATE_ITEM_SLOT__: "",
    SUBJECT: escapeHtml(subject),
    PREHEADER: escapeHtml(preheader),
    RUN_DATE: formatRunDate(input.runDate),
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
