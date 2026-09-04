import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderDigest } from "../scripts/render-email.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateHtml = await readFile(path.join(root, "email", "templates", "daily-digest.html"), "utf8");

const sampleFinding = {
  type: "regulatory",
  confidence: "unverified",
  headline: "AUL009 files Phase 1 IND in Korea",
  subtitle: "Owl Bio (Aul Bio) / Kyungdong Pharmaceutical",
  why: "**AUL009 is no longer only a preclinical watch item.** It has entered Korea's regulatory queue.",
  whatHappened: "Kyungdong and Aul Bio filed a Phase 1 clinical-trial application with Korea's MFDS.",
  stageChange: { from: "Preclinical", to: "IND filed" },
  impactNote: "AUL009 now joins the IND-filed cohort.",
  watchNext: "MFDS clearance and first-patient dosing.",
  sourceTier: 2,
  findingId: "f-2026-09-02-001",
  sourceUrl: "https://www.kpanews.co.kr/news/articleView.html?idxno=542327",
  sourceName: "약사공론 (KPA News)"
};

test("renders a single-finding digest with a headline subject and no leftover template tokens", () => {
  const result = renderDigest({ runDate: "2026-09-04", leadIn: "1 new finding today.", findings: [sampleFinding] }, templateHtml);
  assert.equal(result.subject, "LAI update — AUL009 files Phase 1 IND in Korea");
  assert.equal(result.preheader, "New finding on 04 SEP 2026: AUL009 files Phase 1 IND in Korea");
  assert.match(result.html, /AUL009 files Phase 1 IND in Korea/);
  assert.match(result.html, /Stage updated: Preclinical → IND filed\./);
  assert.doesNotMatch(result.html, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(result.html, /<!--[A-Z_/]+-->/);
});

test("uses a multi-finding subject and never renders raw ** markup from source text", () => {
  const second = { ...sampleFinding, headline: "Peptron raises Series C", type: "financing_investor", confidence: "confirmed", stageChange: null, impactNote: null };
  const result = renderDigest({ runDate: "2026-09-04", leadIn: "2 new findings today.", findings: [sampleFinding, second] }, templateHtml);
  assert.equal(result.subject, "LAI update — 2 new findings (incl. AUL009 files Phase 1 IND in Korea)");
  assert.match(result.html, /<strong>AUL009 is no longer only a preclinical watch item\.<\/strong>/);
  assert.doesNotMatch(result.html, /\*\*/);
  // The second finding has no stage change or impact note, so its card must omit the TRACKER IMPACT row entirely.
  const secondCardIndex = result.html.indexOf("Peptron raises Series C");
  assert.ok(secondCardIndex > -1);
});

test("HTML-escapes raw finding text instead of interpreting it as markup", () => {
  const finding = { ...sampleFinding, whatHappened: "A <script>alert(1)</script> & \"quoted\" claim." };
  const result = renderDigest({ runDate: "2026-09-04", leadIn: "x", findings: [finding] }, templateHtml);
  assert.doesNotMatch(result.html, /<script>alert/);
  assert.match(result.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("falls back to a late/candidate-only subject when there are no headline findings", () => {
  const result = renderDigest({
    runDate: "2026-09-04",
    leadIn: "",
    findings: [],
    lateItems: [{ headline: "Peptron raises convertible bond", originalDate: "2026-08-20", summary: "...", sourceUrl: "https://dart.fss.or.kr/x", sourceName: "DART" }],
    candidates: [{ name: "Example Biosciences", snippet: "...", sourceUrl: "https://example.com", sourceName: "BioSpace" }]
  }, templateHtml);
  assert.equal(result.subject, "LAI update — 1 discovered late, 1 new candidate");
  assert.match(result.html, /DISCOVERED LATE/);
  assert.match(result.html, /NEW CANDIDATES/);
});

test("returns null when there is nothing to report, so the caller can skip drafting entirely", () => {
  const result = renderDigest({ runDate: "2026-09-04", leadIn: "", findings: [], lateItems: [], candidates: [] }, templateHtml);
  assert.equal(result, null);
});
