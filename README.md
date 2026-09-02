# LAI Tracker

A living tracker of Long-Acting Injectable (LAI) drug development — semaglutide depot/LAI technologies first, then broader peptide/protein LAI delivery tech. Tracks both Korean domestic and global players.

## Status

This repo currently holds tracked data only. The dashboard/email interface has not been built yet. Data is written and committed here automatically by Claude (via the `lai-tracker-scan` skill) as part of the LAI Tracker project's research pipeline — see `data/` for the schema.

## Structure

```
data/
  umbrellas/    one JSON file per tracked entity (company/platform/asset)
  candidates.json   pending entities discovered but not yet reviewed
  meta.json     last-run timestamps and source health
```
