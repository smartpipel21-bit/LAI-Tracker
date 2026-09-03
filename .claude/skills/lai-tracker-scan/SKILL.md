---
name: lai-tracker-scan
description: Runs the LAI Tracker's research pipeline for the Long-Acting Injectable (LAI) drug development tracker project — daily umbrella monitoring, daily wire-skim discovery, weekly structural discovery sweeps, and tiered anti-hallucination QC. Use this skill whenever asked to run the LAI tracker scan, run today's LAI tracking, do the daily LAI check, do the weekly LAI sweep, run Track A or Track B, or refresh the LAI Tracker's data — including when a scheduled/cron routine fires with a prompt like "run daily LAI scan" or "run weekly LAI sweep." Also use it if asked to audit or re-verify the LAI Tracker registry for accuracy. Do NOT use this skill to promote, merge, reject, or snooze a candidate into an umbrella — that is a separate, manual, admin-only action this skill explicitly never performs.
---

# LAI Tracker scan

This skill runs the research engine behind the LAI Tracker — a living tracker of Long-Acting Injectable (LAI) drug development, semaglutide depot/LAI technologies first, then broader peptide/protein LAI delivery tech. It covers both Korean domestic and global players, with that split treated as a first-class filter throughout, not an afterthought.

This skill is meant to be invoked unattended, by a scheduled routine with no prior conversation context. Because of that, follow it exactly rather than improvising the process from general research instincts — the whole point of pinning this down as a skill is that every run applies the same criteria, so small inconsistencies don't compound into drift over months.

**The one rule that overrides everything else below:** this skill only ever *proposes*. It writes findings to known entities and writes new candidates to a pending list. It never creates a new umbrella, never merges a candidate into an existing one, never rejects or snoozes a candidate, and never edits the app's interface/UI code — only the data file. Promotion and the other triage actions are exclusively performed by the admin, by hand, in a separate conversation. Do this even for a candidate that looks like an obvious slam-dunk — the review step exists specifically to catch the cases that look obvious and aren't.

## Pick your mode first

The invocation (the scheduled routine's prompt, or what the person asked) tells you which mode to run. Don't run more than one mode per invocation unless explicitly asked to.

| Mode | Trigger | Runs |
|---|---|---|
| **Daily scan** | "run daily LAI scan", "run today's LAI tracking", or no mode specified | Track A + Track B1 + QC Tier 0/1 |
| **Weekly sweep** | "run weekly LAI sweep", "Monday LAI compile" | Track B2 + QC Tier 2 (and Track A/B1 too, if the daily scan hasn't already run today) |
| **Full audit** | Only when explicitly requested — "run a full LAI audit/re-verification" | QC Tier 3 only. Never self-trigger this — see QC section |

If it's ambiguous which mode was meant, default to **Daily scan** — it's the cheapest and safest default.

## Search budget discipline

A real run hit its session search cap partway through a Daily scan, covering only 2 of 37 umbrellas before running out — a good chunk of that budget went to redundant re-phrasings of the same query for a single umbrella instead of covering everyone. These rules exist because that happened, not as theory:

- **Breadth before depth.** On a Daily scan, do one pass across every umbrella first — one query per umbrella using its single most distinctive alias (usually the drug code or ticker, not the generic company name) — before spending any further budget going deeper on the ones that showed something promising. This guarantees every umbrella gets at least one check even if the budget runs out later, instead of exhausting the budget on the first few while the rest get zero attention.
- **One query per alias, two absolute max.** If the first query for an alias comes back with nothing new, move on — don't try three more phrasings hunting for something. A quiet result is a valid result, not a reason to keep searching.
- **Don't retry a domain that just told you no.** If a fetch returns `EGRESS_BLOCKED` or a similar hard error, don't try that same domain again this run — note it under `source_health` (see below) and move on. Retrying a blocked domain burns a tool call for a result you already know.
- **Track B1's wire skim is a fixed, bounded pass** — a handful of term-based searches, not a per-umbrella sweep. Don't let it balloon into checking specific companies; that's Track A's job.

## Throttling quiet umbrellas

Checking every umbrella every single day is wasteful once an umbrella has demonstrated it's genuinely quiet — most of a Daily scan's budget otherwise goes to companies with no news, over and over, forever. To cut that without losing real coverage:

- Every umbrella's `current_status` carries a `last_checked` date (see the schema), updated every time Track A checks it — whether or not anything new was found. This is separate from `last_updated`, which only changes when a real finding lands.
- Before checking an umbrella, compute days since `last_updated`. If it's been 21+ days with no new finding, and `last_checked` shows it was already checked within the last 2 days, **skip it this run** — check umbrellas like this every 3rd day instead of daily.
- The moment a skipped umbrella produces a new finding, it goes back to being checked daily. This throttle is for consistently quiet umbrellas, not a standing exemption.
- A missing `last_checked` (e.g. an umbrella seeded before this rule existed) means "never checked under this rule" — always check it, don't assume it's quiet.

## Track A — umbrella monitoring (daily)

For every existing "umbrella" (a tracked company/platform/asset — has a `canonical_name` and an `aliases` list: English name, Korean name, ticker, drug code, platform name, etc.) that isn't being skipped this run under the throttle above, search **once per alias**, never one blended query covering all aliases at once. A blended query is exactly how Korean-language hits get missed — the two languages compete for the same query and English results crowd out Hangul ones. Apply the search budget discipline above: breadth first, one query per alias, don't chase a quiet result with more phrasings.

Classify every finding into exactly one of these six types, and take the corresponding action:

| Type | Signal words | Action |
|---|---|---|
| Deal/partnership | "partners with", "licenses", "collaboration" | Append to `finding_history`; flag the partner org as a Track B candidate if it's not already a known umbrella |
| Financing/investor | "raises", "convertible bond", "capital increase", stock-move % | Append; update the cap-table note |
| Regulatory | NDA, IND, CHMP, PDUFA | Append; update `current_status.stage` |
| Trial/data readout | "topline", "Phase", % weight loss, PK data | Append; update `current_status.data_point` |
| Manufacturing/capacity | "plant", "facility", capacity multiplier | Append, lower priority |
| Market reaction | stock %, analyst note | Append, lowest priority — context only, never the sole basis for a status change |

A known company's deal can surface a brand-new partner organization. Log the deal itself under the known umbrella (that's Track A's job, since it was found via a known alias) — but the new partner org itself becomes a Track B candidate, not a footnote inside the known umbrella's history.

## Track B1 — daily wire skim (daily, cheap)

Skim fast wires (PR Newswire, BusinessWire, GlobeNewswire, general trade press) for LAI-adjacent terms that are **not tied to any known company name**: "long-acting injectable," "depot," "sustained-release," "microsphere," and similar. This is deliberately not company-scoped — a brand-new entrant's debut deal or data readout breaks here first, before it has any brand recognition to search for by name.

Anything found feeds the same candidate pipeline as Track B2 below (see Source tiering and Candidate pipeline).

## Track B2 — weekly structural sweep (weekly, heavier)

These sources don't refresh daily, so checking them daily would just re-read unchanged data — that's why this runs weekly instead:

- Full conference **accepted-abstract indices** for ADA, ASCO, AAN, ObesityWeek, JPM Healthcare Conference — the actual abstract index, not news coverage about the conference
- Patent filings: **KIPRIS** (Korea), USPTO/WIPO (global), filtered to sustained-release/depot CPC classes — patents often post before any press release exists
- The **KOSDAQ 기술특례상장** (tech-special listing) pipeline — a company entering this pipeline is a strong watch signal even with no other news yet
- clinicaltrials.gov **new-registration feed**, scanned by intervention/title text, not company name — a new entrant may have no brand recognition to search for
- University tech-transfer / spin-off announcements
- VC/deal databases for seed/Series A rounds tagged drug-delivery/LAI

### Candidate pipeline (applies to anything found by Track B1 or B2)

1. Extract the entity mention (org name, drug code, platform name).
2. **Fuzzy-match it against the existing alias table first.** This is the step that prevents duplicate umbrellas — e.g. recognizing a code name as an existing company's own asset rather than a new entrant. Do this before anything else in the pipeline.
3. If it matches an existing umbrella well enough to plausibly be the same entity, log it as a new finding under that umbrella (Track A style) instead of creating a candidate — don't queue something as "new" that fuzzy-matches strongly to something already tracked.
4. If no strong match: score it. A candidate needs a named entity **plus** a concrete technical claim (mechanism, drug code, trial phase) **plus** at least one Tier 1/2 source before it's worth surfacing. A bare name mention with no substance stays in a lower-priority watch queue, not the main candidate list — don't inflate thin signal into a promotable-looking candidate.
5. Write scored candidates to the pending list in the data file, with their evidence (source, snippet, link, date) and their fuzzy-match result against the closest existing umbrella (even a non-match is useful context for the human reviewing it).
6. Stop there. Do not create, merge, or discard anything — see the boundary rule at the top of this file.

## Source tiering and the confirmation rule

Apply this consistently — it's what keeps "confirmed" meaning something over time instead of degrading into "confirmed enough":

- **Tier 1 (trust directly):** company IR/press pages, FDA.gov, EMA, clinicaltrials.gov, and DART (전자공시시스템, Korea's mandatory disclosure system). DART matters especially for KOSDAQ/KOSPI-listed Korean companies — material news there often lands before press picks it up.
- **Tier 2 (credible, but corroborate):** named trade press with bylines (Korea Biomedical Review, Fierce Biotech, Endpoints, BioSpace) and PR Newswire/BusinessWire/GlobeNewswire (these three mostly re-host the actual company release, so treat them as near-Tier-1).
- **Tier 3 (discovery only, never confirmation):** aggregator blogs, generic pipeline-tracker content-farm sites. Fine for spotting a name you haven't seen before; never sufficient to log something as confirmed.

**Rule:** log a material claim as "confirmed" only with either one Tier 1 source, or two *independent* Tier 2 sources (not two articles both quoting the same PR Newswire release — that's one source wearing two hats). Anything short of that gets logged as "unverified," visibly, not silently rounded up to confirmed.

## Calendar-aware bursts

Weight extra search effort around known disclosure clusters, since that's where yield concentrates: ADA (June), ObesityWeek (November), JPM Healthcare Conference (January), ASCO (June), AAN (April). Daily cadence shouldn't structurally miss anything, but it's worth spending more of the search budget in these windows than in a quiet month.

## QC strategy — the goldilocks tiers

This is deliberately tiered by cost, because a daily research routine cannot afford to re-verify everything every time, and a tracker with no human QC layer cannot afford to verify nothing. Match the tier to the mode you're running (see the mode table above) — don't do more than the mode calls for, and don't skip what it calls for either.

**Tier 0 — every run, effectively free.** Before writing anything: is the output well-formed (valid against the data file's structure)? And for each finding written *in this run*, does it actually say what the source you just read said — a quick self-check against material already in context, not a re-fetch. This costs almost nothing because you already read the source this run.

**Tier 1 — every run, cheap.** Never re-audit the whole registry in a daily or weekly run — QC scope is strictly bounded to what this run itself touched. Staleness is handled as free date math only: compute days-since-last-finding per umbrella and surface it as a flag. Do not spend run budget *investigating* why an umbrella has gone quiet — that's a judgment call for the human looking at the dashboard, not a task to chase down automatically.

**Tier 2 — weekly, folded into the Weekly sweep mode, not a separate run.** Re-verify a small random sample (5–10) of *existing* findings already in the registry against their cited source — this is how citation rot and old mistakes get caught statistically over time without ever paying to check everything at once. Also run a fast fuzzy-dedup sweep across the whole alias table — this is closer to string-matching than research, so it's cheap even at full-registry scope.

**Tier 3 — quarterly or explicit request only. Never self-triggered.** A full-registry re-verification of every umbrella's `current_status` against a fresh source check. This is the expensive tier — genuinely costly at full scope — so the Daily scan and Weekly sweep modes must never invoke it on their own. Only run it when the mode table above says Full audit, i.e. someone asked for it directly.

## Writing to the data file

The schema is locked — read `references/data-schema.md` before writing anything, and follow it exactly. It defines the file layout (`data/umbrellas/<id>.json` per entity, plus `candidates.json` and `meta.json`), the controlled vocabularies for every enum field, and the deterministic ID-generation rules for findings and candidates.

Two things matter more than the field names themselves, because they're what actually prevents drift over months of unattended runs:

- **Never invent a variant of a controlled value.** If `technology_family` doesn't cleanly fit one of the listed values, use `other` and add a one-line note — don't coin a new tag that reads more naturally in the moment. A schema only prevents naming drift if every run treats it as fixed, not as a starting suggestion.
- **Never write outside your own file's lane.** Track A only ever touches the specific umbrella files it found findings for. Track B only ever touches `candidates.json`. Don't "helpfully" fix something you notice in an unrelated umbrella file while you're in there — flag it instead, or handle it under the mode that owns it.

Update `meta.json`'s `last_run` and `source_health` at the end of every run, even a run that found nothing — an absent update is indistinguishable from a job that silently failed, which is exactly the failure mode this field exists to catch. Also record coverage: how many umbrellas were actually checked this run versus skipped (throttled quiet ones, or ones never reached because the search budget ran out) — a run that only covered 2 of 37 umbrellas needs to be visible as incomplete, not indistinguishable from a full run that just happened to find little. If any domain returned `EGRESS_BLOCKED` this run, log it under `source_health` with status `blocked` so a pattern of unreachable sources shows up over time instead of silently degrading source quality run after run.

Commit to the GitHub repo with a clear message describing what changed and why (e.g. "Track A: 2 new findings for peptron-pt403, inventagelab-ivl3021" or "Weekly sweep: 3 new candidates"). Never touch the app's interface/UI code from this skill — if a run seems to require a UI change, stop and flag it instead of making it.

## Email digest

After a Daily scan or Weekly sweep, draft a short digest of what changed this run (new findings by umbrella, new candidates if any) as a **Gmail draft**, not a sent email. This mirrors the promotion boundary above: drafting is this skill's job, sending is a decision only the admin makes, every time — there is no standing authorization to send mail unattended. If a future admin decision changes this policy, it will be written here explicitly; until then, draft-only is the rule, not a placeholder.

## Hard boundaries, recap

- Never promote, merge, reject, or snooze a candidate — proposal only, always.
- Never send the digest email — draft it and stop, every run.
- Never run the Tier 3 full audit automatically from a Daily scan or Weekly sweep.
- Never blend multiple aliases into one search query.
- Never fire more than two query variants for a single alias.
- Never retry a domain that returned `EGRESS_BLOCKED` this run.
- Never do a deep multi-query dive on any umbrella before every umbrella has had its first-pass query — breadth before depth.
- Never edit the app's interface/UI code.
- Never log a claim as "confirmed" without meeting the Tier 1/Tier 2 source rule.
