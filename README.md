# LAI Tracker

A living tracker of Long-Acting Injectable (LAI) drug development — semaglutide depot/LAI technologies first, then broader peptide/protein LAI delivery tech. Tracks both Korean domestic and global players.

## Status

This repository contains the tracked data and a Vercel-native dashboard. Data is written and committed here automatically by Claude (via the `lai-tracker-scan` skill) as part of the LAI Tracker project's research pipeline. Every Vercel deployment rebuilds `data/umbrellas/*.json`, `data/candidates.json`, and `data/meta.json` into a browser-ready snapshot; routine data updates do not require dashboard-code changes.

The interface keeps three conditions distinct:

1. Tracked intelligence accepted into the umbrella record
2. Candidate entities pending analyst review
3. Daily/weekly monitoring and quality-control status from `meta.json`

## Structure

```
data/
  umbrellas/    one JSON file per tracked entity (company/platform/asset)
  candidates.json   pending entities discovered but not yet reviewed
  meta.json     last-run timestamps and source health
src/            browser application and data-normalization logic
scripts/        dependency-free static build
tests/          Node tests for normalization and repository counts
index.html      Vercel dashboard entry point
vercel.json     explicit static build and output configuration
```

## Local build

Requires Node.js 20 or newer. No third-party packages are required.

```bash
npm test
npm run build
```

Serve the generated `dist/` directory with any static web server. Vercel runs the same build command and publishes `dist/` automatically.
