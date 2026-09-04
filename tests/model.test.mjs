import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeStage, prepareDatabase, safeUrl } from "../src/model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourcePayload() {
  const directory = path.join(root, "data", "umbrellas");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const records = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8"))));
  const candidates = JSON.parse(await readFile(path.join(root, "data", "candidates.json"), "utf8")).candidates;
  const meta = JSON.parse(await readFile(path.join(root, "data", "meta.json"), "utf8"));
  return { records, candidates, meta, latest_data_date: "2026-09-02", built_at: new Date(0).toISOString() };
}

test("normalizes active combined studies without promoting planned phases", () => {
  assert.equal(normalizeStage("Phase I/IIa — recruiting"), "Phase 2");
  assert.equal(normalizeStage("Phase 2b in preparation following positive Phase 1b"), "Phase 1");
  assert.equal(normalizeStage("Phase 1 IND filed; dosing targeted in 2026"), "IND filed");
});

test("prepares the complete repository snapshot and identifies the development leader", async () => {
  const data = prepareDatabase(await sourcePayload());
  // records.length only changes when an umbrella is promoted (a manual, admin-only action),
  // so it's safe to pin exactly. findings/candidates grow every time the daily scan finds
  // something, so pinning an exact count here would fail after the very next scan run —
  // assert the pipeline produced a non-empty, monotonically-plausible result instead.
  assert.equal(data.records.length, 37);
  assert.ok(data.findings.length >= 126, `expected at least 126 findings, got ${data.findings.length}`);
  assert.ok(data.pendingCandidates.length >= 9, `expected at least 9 pending candidates, got ${data.pendingCandidates.length}`);
  assert.equal(data.leader.id, "mapi-pharma-semaglutide");
  assert.equal(data.leader.stageLabel, "Phase 2");
});

test("accepts only web source links", () => {
  assert.match(safeUrl("https://example.com/source"), /^https:/);
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("not a url"), null);
});
