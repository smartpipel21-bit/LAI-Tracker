# LAI Tracker data file schema

This is the locked schema for the LAI Tracker's data files. Everything here exists to prevent two kinds of problems: **naming drift** (two runs describing the same thing two different ways) and **write collisions** (two runs stepping on the same file or the same ID). Follow it exactly rather than improvising a field name or ID format that "seems reasonable" — the whole value of a schema is that every writer agrees on it without having to check with each other.

## File layout

```
data/
  umbrellas/
    <umbrella-id>.json      one file per tracked entity
  candidates.json           Track B's pending list
  meta.json                 last-run timestamps, per-source health
```

One file per umbrella, not one giant registry file, for two reasons: a daily update to one company only touches that company's file (clean, reviewable git diffs), and it structurally prevents Track A's per-umbrella writes from ever conflicting with Track B's candidate-list writes — they physically can't touch the same file.

**Scheduling note:** this only removes conflicts *between* Track A and Track B. It does not protect against two runs writing the *same* umbrella file concurrently (e.g. Daily scan and a QC Tier 2 sample both touching Peptron's file at once). Scheduled runs must not overlap — sequence them with real gaps, don't rely on the file split alone.

## Controlled vocabularies

Use these exact string values — never invent a variant, even one that reads more naturally. If nothing fits, use the literal value `other` and add a one-line note explaining what didn't fit, rather than inventing a new tag on the spot.

| Field | Allowed values |
|---|---|
| `origin` | `KR`, `Global` |
| `technology_family` | `plga_microsphere`, `in_situ_forming_depot`, `lipid_liquid_crystal_depot`, `molecular_engineering`, `prodrug_linker`, `subdermal_implant`, `other` |
| `entity_type` (array, pick all that apply) | `company`, `platform`, `asset` |
| `finding.type` | `deal_partnership`, `financing_investor`, `regulatory`, `trial_data_readout`, `manufacturing_capacity`, `market_reaction` |
| `finding.confidence` | `confirmed`, `unverified` |
| `source.tier` | `1`, `2`, `3` (integer) |
| `candidate.status` | `pending`, `promoted`, `merged`, `rejected`, `snoozed` |

Dates are always `YYYY-MM-DD`. Timestamps (in `meta.json` only) are full ISO 8601 UTC: `YYYY-MM-DDTHH:MM:SSZ`.

## ID generation rules

IDs must be deterministic and collision-checked before writing — never just increment a counter you're guessing at.

- **Umbrella ID** — kebab-case slug from the canonical name, e.g. `peptron-pt403`. Generated once, at promotion time (by the admin, in conversation — this skill never creates one). Before creating the file, check `data/umbrellas/` for an existing file with that name; if it collides, append a disambiguating suffix (`-2`) rather than overwriting.
- **Finding ID** — `f-<YYYY-MM-DD>-<NNN>`, e.g. `f-2026-09-02-001`. `NNN` is a 3-digit sequence, unique *within that umbrella's own `finding_history` for that date* — read the existing entries for that date in that file and increment from the highest one found. Because each umbrella has its own file, this never needs to be globally unique, only unique within the file.
- **Candidate ID** — `cand-<YYYY-MM-DD>-<NNN>`, same rule, scoped to `candidates.json` for that date.

## `umbrella` object (one file per entity, `data/umbrellas/<id>.json`)

```json
{
  "id": "peptron-pt403",
  "canonical_name": "Peptron – PT403 (SmartDepot)",
  "origin": "KR",
  "entity_type": ["company", "platform", "asset"],
  "technology_family": "plga_microsphere",
  "aliases": ["Peptron", "펩트론", "PT403", "SmartDepot", "087010"],
  "current_status": {
    "stage": "Partnered w/ Lilly",
    "dosing_target": "Monthly",
    "partner": "Eli Lilly",
    "data_point": "~30% body-weight reduction at week 4 (ADA 2026)",
    "last_updated": "2026-08-30"
  },
  "finding_history": [
    {
      "id": "f-2026-08-30-001",
      "date": "2026-08-30",
      "type": "trial_data_readout",
      "summary": "One or two sentences, plain language.",
      "source": { "name": "ADA 2026 roundup", "url": "https://...", "tier": 2 },
      "confidence": "confirmed"
    }
  ]
}
```

Notes:
- `current_status` fields are only overwritten when a new finding actually addresses them — don't null out `partner` just because today's finding didn't mention it.
- `finding_history` is append-only. Never edit or remove a past entry, even to "clean it up" — if something logged earlier turns out wrong, append a new finding correcting it (this preserves the audit trail; git history plus this append-only log together are the record of what was known when).
- Staleness (`days_since_last_finding`) is computed by the app from `current_status.last_updated` at render time. Do not store it — a stored value goes stale itself.

## `candidate` object (an entry in the `candidates` array in `data/candidates.json`)

```json
{
  "id": "cand-2026-09-01-003",
  "detected_name": "Example Biosciences",
  "detected_aliases": ["Example Biosciences", "이그잼플바이오"],
  "entity_type_guess": ["company"],
  "evidence": [
    { "source": { "name": "...", "url": "...", "tier": 2 }, "snippet": "...", "date": "2026-09-01" }
  ],
  "fuzzy_match": { "closest_umbrella_id": "g2gbio-gb7001", "score": 0.42 },
  "status": "pending",
  "created_date": "2026-09-01",
  "resolution": null
}
```

- `fuzzy_match.score` is 0–1; include it even when the closest match is weak — a low score is still useful context for whoever reviews the candidate.
- `resolution` stays `null` until the admin acts on it, then becomes e.g. `{ "action": "promoted", "umbrella_id": "example-biosciences", "date": "2026-09-05" }` or `{ "action": "rejected", "reason": "duplicate of existing umbrella", "date": "2026-09-05" }`. Rejected candidates are never deleted — the reason feeds the query-tuning feedback loop.

## `meta.json`

```json
{
  "last_run": {
    "daily_scan": "2026-09-02T06:00:00Z",
    "weekly_sweep": "2026-09-01T06:00:00Z",
    "qc_tier2": "2026-09-01T06:10:00Z",
    "qc_tier3": null
  },
  "source_health": {
    "dart": { "last_success": "2026-09-02T06:00:00Z", "status": "ok" },
    "clinicaltrials_gov": { "last_success": "2026-09-02T06:00:00Z", "status": "ok" },
    "kipris": { "last_success": "2026-08-26T06:00:00Z", "status": "stale" }
  }
}
```

`source_health.status` is `ok` or `stale` — set to `stale` (never silently left as `ok`) if a source fetch fails or returns nothing unexpected. This is the job-health visibility the tracker needs to avoid silent data gaps.
