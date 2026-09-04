import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderDigest } from "../scripts/render-email.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateHtml = await readFile(path.join(root, "email", "templates", "daily-digest.html"), "utf8");

// Findings, late items, and candidates all share this exact shape — that's the point.
const sampleFinding = {
  headline: "AUL009 files Phase 1 IND in Korea",
  date: "2026-09-02",
  summary: "Kyungdong and Aul Bio filed a Phase 1 IND with Korea's MFDS for the once-monthly semaglutide LAI, moving AUL009 from preclinical to IND-filed.",
  sourceUrl: "https://www.kpanews.co.kr/news/articleView.html?idxno=542327",
  sourceName: "약사공론 (KPA News)"
};

test("renders a single-finding digest with a headline subject and no leftover template tokens", () => {
  const result = renderDigest({ runDate: "2026-09-04", leadIn: "1 new finding today.", findings: [sampleFinding] }, templateHtml);
  assert.equal(result.subject, "LAI update — AUL009 files Phase 1 IND in Korea");
  assert.equal(result.preheader, "New finding on 04 SEP 2026: AUL009 files Phase 1 IND in Korea");
  assert.match(result.html, /AUL009 files Phase 1 IND in Korea/);
  assert.match(result.html, /02 SEP 2026/);
  assert.match(result.html, /WHAT'S NEW/);
  assert.doesNotMatch(result.html, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(result.html, /<!--[A-Z_/]+-->/);
});

test("uses a multi-finding subject and every finding gets the same name/date/summary/link shape", () => {
  const second = { headline: "Peptron raises Series C", date: "2026-09-03", summary: "A KRW 20B Series C round to fund PT403's Phase 1 readout.", sourceUrl: "https://example.com/2", sourceName: "Korea Biomedical Review" };
  const result = renderDigest({ runDate: "2026-09-04", leadIn: "2 new findings today.", findings: [sampleFinding, second] }, templateHtml);
  assert.equal(result.subject, "LAI update — 2 new findings (incl. AUL009 files Phase 1 IND in Korea)");
  assert.match(result.html, /AUL009 files Phase 1 IND in Korea/);
  assert.match(result.html, /Peptron raises Series C/);
  // Only one WHAT'S NEW header should appear even with two findings — they share one section, one row shape each.
  assert.equal((result.html.match(/WHAT'S NEW/g) ?? []).length, 1);
});

test("converts **bold** in Claude-authored summaries but never interprets raw HTML from source text", () => {
  const finding = { ...sampleFinding, summary: "**Not just a preclinical watch item anymore.** A <script>alert(1)</script> claim & a \"quoted\" detail." };
  const result = renderDigest({ runDate: "2026-09-04", leadIn: "x", findings: [finding] }, templateHtml);
  assert.match(result.html, /<strong>Not just a preclinical watch item anymore\.<\/strong>/);
  assert.doesNotMatch(result.html, /\*\*/);
  assert.doesNotMatch(result.html, /<script>alert/);
  assert.match(result.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("falls back to a late/candidate-only subject when there are no headline findings", () => {
  const result = renderDigest({
    runDate: "2026-09-04",
    leadIn: "",
    findings: [],
    lateItems: [{ headline: "Peptron raises convertible bond", date: "2026-08-20", summary: "Published on DART, only surfaced by this run's wire skim.", sourceUrl: "https://dart.fss.or.kr/x", sourceName: "DART" }],
    candidates: [{ headline: "Example Biosciences", date: "2026-09-01", summary: "Licensed a PLGA microsphere platform for an undisclosed GLP-1 asset.", sourceUrl: "https://example.com", sourceName: "BioSpace" }]
  }, templateHtml);
  assert.equal(result.subject, "LAI update — 1 discovered late, 1 new candidate");
  assert.match(result.html, /DISCOVERED LATE/);
  assert.match(result.html, /NEW CANDIDATES/);
  assert.doesNotMatch(result.html, /WHAT'S NEW/);
});

test("returns null when there is nothing to report, so the caller can skip drafting entirely", () => {
  const result = renderDigest({ runDate: "2026-09-04", leadIn: "", findings: [], lateItems: [], candidates: [] }, templateHtml);
  assert.equal(result, null);
});
