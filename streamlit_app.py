"""Read-first LAI competitive-intelligence dashboard.

The application discovers every JSON file in ``data/umbrellas`` at runtime.
Daily research updates therefore change data files only; the dashboard code
does not need to be edited when records or findings are added.
"""

from __future__ import annotations

import html
import json
import re
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.graph_objects as go
import streamlit as st


st.set_page_config(
    page_title="LAI market intelligence",
    page_icon=":material/monitoring:",
    layout="wide",
    initial_sidebar_state="expanded",
)


ROOT = Path(__file__).resolve().parent
UMBRELLA_DIR = ROOT / "data" / "umbrellas"
CANDIDATES_FILE = ROOT / "data" / "candidates.json"
META_FILE = ROOT / "data" / "meta.json"
OUR_PRODUCT_ID = "daewoong-tionlab-quject"

STAGE_ORDER = {
    "Research": 0,
    "Preclinical": 1,
    "IND filed": 2,
    "Phase 1": 3,
    "Phase 2": 4,
    "Phase 3": 5,
    "Filed / review": 6,
    "Approved / marketed": 7,
}

STAGE_COLORS = {
    "Research": "#B4B2A9",
    "Preclinical": "#E6A007",
    "IND filed": "#F16634",
    "Phase 1": "#24B68A",
    "Phase 2": "#7161B5",
    "Phase 3": "#347FD1",
    "Filed / review": "#1E5AA8",
    "Approved / marketed": "#72736F",
}

FAMILY_LABELS = {
    "plga_microsphere": "PLGA microsphere",
    "lipid_liquid_crystal_depot": "Lipid liquid-crystal depot",
    "in_situ_forming_depot": "In-situ forming depot",
    "molecular_engineering": "Molecular engineering",
    "prodrug_linker": "Prodrug / linker",
    "subdermal_implant": "Subdermal implant",
    "other": "Other",
}

FAMILY_COLORS = {
    "plga_microsphere": "#347FD1",
    "lipid_liquid_crystal_depot": "#F16634",
    "in_situ_forming_depot": "#24B68A",
    "molecular_engineering": "#7161B5",
    "prodrug_linker": "#E6A007",
    "subdermal_implant": "#DF6A9E",
    "other": "#72736F",
}

FINDING_LABELS = {
    "trial_data_readout": "Clinical / data",
    "regulatory": "Regulatory",
    "deal_partnership": "Partnership",
    "market_reaction": "Market reaction",
    "manufacturing_capacity": "Manufacturing",
    "financing_investor": "Financing",
}

FINDING_BADGES = {
    "trial_data_readout": "blue",
    "regulatory": "violet",
    "deal_partnership": "green",
    "market_reaction": "orange",
    "manufacturing_capacity": "yellow",
    "financing_investor": "gray",
}


def database_fingerprint() -> tuple[tuple[str, int, int], ...]:
    """Return a cheap signature that changes whenever a data file changes."""
    paths = sorted(UMBRELLA_DIR.glob("*.json")) + [CANDIDATES_FILE, META_FILE]
    signature: list[tuple[str, int, int]] = []
    for path in paths:
        if path.exists():
            stat = path.stat()
            signature.append((str(path.relative_to(ROOT)), stat.st_mtime_ns, stat.st_size))
    return tuple(signature)


def normalize_stage(stage_text: str | None) -> str:
    """Map free-text status to a common maturity axis without counting plans."""
    text = (stage_text or "").lower()
    if re.search(r"\bapproved\b|\bmarketed\b|commercially launched", text):
        return "Approved / marketed"
    if "ind filed" in text or "ind application" in text:
        return "IND filed"

    # Combined phase notation (for example, Phase I/IIa) has active Phase 2 work.
    # Handle it before the generic patterns so it is not reduced to Phase 1.
    if re.search(r"phase\s*(?:i|1)\s*/\s*(?:ii|2)\w*", text):
        return "Phase 2"

    stage_patterns = (
        ("Phase 3", r"phase\s*(?:iii|3)\w*|pivotal(?:-stage)?"),
        ("Phase 2", r"phase\s*(?:ii|2)\w*"),
        ("Phase 1", r"phase\s*(?:i|1)\w*"),
    )
    future_words = re.compile(r"target|plan|prepar|expect|intend|aim|advanc(?:e|ing) toward")
    for label, pattern in stage_patterns:
        for match in re.finditer(pattern, text):
            context = text[max(0, match.start() - 32) : min(len(text), match.end() + 42)]
            if not future_words.search(context):
                return label

    if re.search(r"\bnda\b|\bbla\b|under (?:fda|ema|nmpa|regulatory) review", text):
        return "Filed / review"
    if "preclinical" in text or "nonclinical" in text or "ind-enabling" in text:
        return "Preclinical"
    return "Research"


def is_semaglutide_program(record: dict[str, Any]) -> bool:
    """Identify direct semaglutide delivery programs from their narrative fields."""
    status = record.get("current_status") or {}
    history = record.get("finding_history") or []
    text = " ".join(
        [
            str(record.get("canonical_name") or ""),
            " ".join(str(value) for value in record.get("aliases") or []),
            str(status.get("data_point") or ""),
            " ".join(str(item.get("summary") or "") for item in history),
        ]
    ).lower()
    if "semaglutide" not in text:
        return False

    direct_patterns = (
        r"semaglutide.{0,55}(?:depot|implant|asset|candidate|microparticle|microsphere|lai|injectable)",
        r"(?:depot|implant|asset|candidate|microparticle|microsphere|lai|injectable|once-monthly|plga).{0,55}semaglutide",
    )
    return any(re.search(pattern, text) for pattern in direct_patterns)


def split_name(canonical_name: str) -> tuple[str, str]:
    """Split the repository's canonical company–program label for compact display."""
    parts = re.split(r"\s+[–—-]\s+", canonical_name, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return canonical_name.strip(), canonical_name.strip()


def truncate(text: str | None, limit: int) -> str:
    value = " ".join((text or "—").split())
    if len(value) <= limit:
        return value
    return value[: limit - 1].rsplit(" ", 1)[0] + "…"


def first_sentence(text: str | None, limit: int = 130) -> str:
    value = " ".join((text or "Update recorded").split())
    sentence = re.split(r"(?<=[.!?])\s+", value, maxsplit=1)[0]
    return truncate(sentence, limit)


@st.cache_data(show_spinner=False, max_entries=4)
def load_database(
    _fingerprint: tuple[tuple[str, int, int], ...],
) -> tuple[list[dict[str, Any]], pd.DataFrame, list[dict[str, Any]], dict[str, Any], list[str]]:
    """Load and validate repository data. Invalid files are reported, not fatal."""
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    required = {"id", "canonical_name", "origin", "technology_family", "current_status", "finding_history"}

    for path in sorted(UMBRELLA_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{path.name}: invalid JSON ({exc})")
            continue

        missing = sorted(required.difference(payload))
        if missing:
            errors.append(f"{path.name}: missing {', '.join(missing)}")
            continue
        if not isinstance(payload["current_status"], dict) or not isinstance(payload["finding_history"], list):
            errors.append(f"{path.name}: current_status must be an object and finding_history must be a list")
            continue

        status = payload["current_status"]
        company, program = split_name(str(payload["canonical_name"]))
        payload["company"] = company
        payload["program"] = program
        payload["stage_label"] = normalize_stage(status.get("stage"))
        payload["stage_order"] = STAGE_ORDER[payload["stage_label"]]
        payload["is_semaglutide"] = is_semaglutide_program(payload)
        records.append(payload)

    findings: list[dict[str, Any]] = []
    for record in records:
        for finding in record.get("finding_history") or []:
            source = finding.get("source") or {}
            findings.append(
                {
                    "date": finding.get("date"),
                    "company": record["company"],
                    "program": record["program"],
                    "record_id": record["id"],
                    "finding_id": finding.get("id"),
                    "type": finding.get("type") or "other",
                    "summary": finding.get("summary") or "—",
                    "confidence": finding.get("confidence") or "unverified",
                    "source_name": source.get("name") or "—",
                    "source_url": source.get("url") or "",
                    "source_tier": source.get("tier"),
                    "technology_family": record.get("technology_family") or "other",
                    "origin": record.get("origin") or "—",
                }
            )

    findings_df = pd.DataFrame(findings)
    if not findings_df.empty:
        findings_df["date"] = pd.to_datetime(findings_df["date"], errors="coerce")
        findings_df = findings_df.sort_values(["date", "finding_id"], ascending=[False, False]).reset_index(drop=True)

    try:
        candidates_payload = json.loads(CANDIDATES_FILE.read_text(encoding="utf-8"))
        candidates = candidates_payload.get("candidates", [])
    except (OSError, json.JSONDecodeError) as exc:
        candidates = []
        errors.append(f"candidates.json: could not load ({exc})")

    try:
        meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        meta = {}
        errors.append(f"meta.json: could not load ({exc})")

    return records, findings_df, candidates, meta, errors


def build_race_chart(programs: list[dict[str, Any]]) -> go.Figure:
    """Build a static, development-stage race for direct semaglutide programs."""
    ordered = sorted(programs, key=lambda item: (item["stage_order"], item["current_status"].get("last_updated") or ""))
    y_labels = [truncate(item["program"], 36) + (" ★" if item["id"] == OUR_PRODUCT_ID else "") for item in ordered]
    values = [max(item["stage_order"], 0.35) for item in ordered]
    colors = [
        "#1FAE82" if item["id"] == OUR_PRODUCT_ID else STAGE_COLORS[item["stage_label"]]
        for item in ordered
    ]
    stage_text = [item["stage_label"] for item in ordered]

    figure = go.Figure(
        go.Bar(
            x=values,
            y=y_labels,
            orientation="h",
            marker={"color": colors, "line": {"width": 0}},
            text=stage_text,
            textposition="auto",
            insidetextanchor="end",
            hovertemplate="<b>%{y}</b><br>%{text}<extra></extra>",
            cliponaxis=False,
        )
    )
    figure.update_layout(
        height=max(380, 46 * len(ordered) + 95),
        margin={"l": 12, "r": 18, "t": 14, "b": 25},
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        showlegend=False,
        bargap=0.42,
        font={"size": 12},
        xaxis={
            "range": [0, 6.35],
            "tickmode": "array",
            "tickvals": [1, 2, 3, 4, 5, 6],
            "ticktext": ["Preclinical", "IND filed", "Phase 1", "Phase 2", "Phase 3", "Filed / review"],
            "side": "top",
            "showgrid": True,
            "gridcolor": "rgba(120,120,120,.13)",
            "zeroline": False,
            "fixedrange": True,
        },
        yaxis={"showgrid": False, "fixedrange": True, "automargin": True},
    )
    return figure


def build_family_chart(records: list[dict[str, Any]]) -> go.Figure:
    counts = Counter(record.get("technology_family") or "other" for record in records)
    ordered = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    labels = [FAMILY_LABELS.get(key, key.replace("_", " ").title()) for key, _ in ordered]
    values = [value for _, value in ordered]
    colors = [FAMILY_COLORS.get(key, "#72736F") for key, _ in ordered]
    figure = go.Figure(go.Bar(x=values, y=labels, orientation="h", marker_color=colors, text=values, textposition="outside"))
    figure.update_layout(
        height=330,
        margin={"l": 8, "r": 28, "t": 10, "b": 12},
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        showlegend=False,
        xaxis={"visible": False, "fixedrange": True},
        yaxis={"showgrid": False, "fixedrange": True, "autorange": "reversed", "automargin": True},
    )
    return figure


def build_evidence_chart(findings: pd.DataFrame) -> go.Figure:
    confirmed = int((findings["confidence"] == "confirmed").sum()) if not findings.empty else 0
    unverified = len(findings) - confirmed
    figure = go.Figure(
        go.Pie(
            labels=["Confirmed", "Unverified"],
            values=[confirmed, unverified],
            hole=0.68,
            marker_colors=["#24B68A", "#E6A007"],
            textinfo="label+value",
            hovertemplate="%{label}: %{value}<extra></extra>",
        )
    )
    figure.add_annotation(text=f"<b>{len(findings)}</b><br>findings", showarrow=False, font={"size": 17})
    figure.update_layout(
        height=330,
        margin={"l": 10, "r": 10, "t": 10, "b": 10},
        paper_bgcolor="rgba(0,0,0,0)",
        showlegend=False,
    )
    return figure


def render_anchor(anchor_id: str) -> None:
    st.html(f'<span id="{html.escape(anchor_id)}" class="section-anchor"></span>')


def source_badge(finding_type: str) -> str:
    label = FINDING_LABELS.get(finding_type, finding_type.replace("_", " ").title())
    color = FINDING_BADGES.get(finding_type, "gray")
    return f":{color}-badge[{label}]"


fingerprint = database_fingerprint()
records, findings_df, candidates, meta, load_errors = load_database(fingerprint)

if not records:
    st.error("No valid umbrella records were found in data/umbrellas.", icon=":material/error:")
    st.stop()

semaglutide_programs = [record for record in records if record["is_semaglutide"]]
development_programs = [
    record for record in semaglutide_programs if record["stage_label"] != "Approved / marketed"
]
leader = max(
    development_programs,
    key=lambda item: (item["stage_order"], item["current_status"].get("last_updated") or ""),
)
latest_data_date = max(
    [str(record["current_status"].get("last_updated") or "") for record in records]
    + ([findings_df["date"].max().strftime("%Y-%m-%d")] if not findings_df.empty else [])
)
confirmed_count = int((findings_df["confidence"] == "confirmed").sum()) if not findings_df.empty else 0
pending_candidates = sum(1 for item in candidates if item.get("status") == "pending")


st.html(
    """
    <style>
      .section-anchor { display:block; height:0; scroll-margin-top:1rem; }
      .lai-nav { display:grid; gap:.25rem; margin-top:.6rem; }
      .lai-nav a { display:flex; align-items:center; gap:.65rem; padding:.62rem .72rem; border-radius:.6rem; color:#9ba5ba !important; text-decoration:none !important; font-size:.84rem; transition:.16s ease; }
      .lai-nav a::before { content:""; width:.42rem; height:.42rem; border-radius:50%; background:#4f5a73; }
      .lai-nav a:hover, .lai-nav a.is-current { color:#fff !important; background:#2a344d; }
      .lai-nav a.is-current::before { background:#24b68a; box-shadow:0 0 0 4px rgba(36,182,138,.14); }
      .st-key-lai_header { padding-bottom:.3rem; }
      .st-key-leader_card [data-testid="stVerticalBlockBorderWrapper"] { min-height:100%; }
      [data-testid="stMetric"] { box-shadow:0 1px 2px rgba(11,11,11,.04), 0 4px 16px rgba(11,11,11,.04); }
    </style>
    """
)

with st.sidebar:
    st.markdown("## :material/monitoring: LAI PULSE")
    st.caption("Semaglutide LAI and adjacent depot intelligence")
    st.html(
        """
        <div class="lai-nav">
          <a href="#market-overview" data-lai-nav="market-overview" class="is-current">Market overview</a>
          <a href="#latest-intelligence" data-lai-nav="latest-intelligence">Latest intelligence</a>
          <a href="#market-statistics" data-lai-nav="market-statistics">Market statistics</a>
          <a href="#program-directory" data-lai-nav="program-directory">Program directory</a>
          <a href="#evidence-archive" data-lai-nav="evidence-archive">Evidence archive</a>
        </div>
        """
    )
    st.space("large")
    st.caption(f"Database · {len(records)} programs\n\nLatest evidence · {latest_data_date}\n\nSource · data/umbrellas/*.json")
    if load_errors:
        st.badge(f"{len(load_errors)} data warning(s)", color="orange", icon=":material/warning:")


with st.container(key="lai_header"):
    title_col, date_col = st.columns([4, 1], vertical_alignment="bottom")
    with title_col:
        st.title("LAI market intelligence")
        st.caption("A decision-first view of long-acting semaglutide programs and the wider delivery landscape")
    with date_col:
        st.caption("Database last updated", text_alignment="right")
        st.markdown(f"**{latest_data_date}**", text_alignment="right")

render_anchor("market-overview")
leader_company = leader["company"]
leader_stage = leader["stage_label"]
st.markdown("#### MARKET AT A GLANCE")
st.header(f"{leader_company} currently leads direct semaglutide LAI development")
st.write(
    f"The repository places **{leader['program']}** at **{leader_stage}**, "
    "ahead of the other directly identified semaglutide delivery programs on reported development maturity."
)
st.caption("Leadership here means development stage only. It does not imply superior formulation, delivery, safety, or efficacy.")

race_col, leader_col = st.columns([1.72, 0.68], vertical_alignment="top")
with race_col:
    with st.container(border=True):
        st.subheader("Development race", icon=":material/route:")
        st.caption(f"{len(semaglutide_programs)} directly identified semaglutide programs · public evidence only")
        st.plotly_chart(
            build_race_chart(semaglutide_programs),
            width="stretch",
            key="development_race",
            config={"displayModeBar": False, "scrollZoom": False, "staticPlot": True},
        )
with leader_col:
    with st.container(border=True, height="stretch", key="leader_card"):
        st.badge("Current development leader", color="blue", icon=":material/flag:")
        st.header(leader_company)
        st.caption(leader["program"])
        st.metric("Reported stage", leader_stage, border=False, icon=":material/clinical_notes:")
        st.write(truncate(leader["current_status"].get("stage"), 310))
        st.markdown("**Why it matters**")
        st.write(truncate(leader["current_status"].get("data_point"), 330))
        st.caption("No internal product-performance data is used in this conclusion.")


render_anchor("latest-intelligence")
st.space("medium")
st.markdown("#### WHAT CHANGED")
st.header("Latest market intelligence")
st.caption("Recent findings are shortened here. The full historical wording and source trail remain in the evidence archive.")

feed_col, readout_col = st.columns([1.72, 0.68], vertical_alignment="top")
with feed_col:
    for _, finding in findings_df.head(6).iterrows():
        with st.container(border=True):
            meta_col, link_col = st.columns([5, 1], vertical_alignment="center")
            with meta_col:
                finding_date = finding["date"].strftime("%d %b %Y") if pd.notna(finding["date"]) else "Date unavailable"
                st.markdown(
                    f"**{finding_date} · {finding['company']}**  "
                    f"{source_badge(str(finding['type']))} "
                    f"{' :green-badge[Confirmed]' if finding['confidence'] == 'confirmed' else ' :orange-badge[Unverified]'}"
                )
            with link_col:
                if finding["source_url"]:
                    st.link_button("Source", str(finding["source_url"]), icon=":material/open_in_new:", type="tertiary")
            st.markdown(f"**{first_sentence(str(finding['summary']))}**")
            st.write(truncate(str(finding["summary"]), 340))
            st.caption(f"{finding['source_name']} · Tier {finding['source_tier'] or '—'}")

with readout_col:
    with st.container(border=True):
        st.subheader("Today’s readout", icon=":material/lightbulb:")
        st.markdown(f"**Development lead**\n\n{leader_company} · {leader_stage}")
        if not findings_df.empty:
            newest_date = findings_df["date"].max()
            thirty_day_cutoff = newest_date - timedelta(days=30)
            recent_findings = findings_df[findings_df["date"] >= thirty_day_cutoff]
            top_type = recent_findings["type"].value_counts().index[0] if not recent_findings.empty else "other"
            st.markdown(
                f"**30-day signal volume**\n\n{len(recent_findings)} findings; "
                f"{FINDING_LABELS.get(str(top_type), str(top_type).replace('_', ' ').title())} is the most frequent signal."
            )
        st.markdown(f"**Analyst queue**\n\n{pending_candidates} candidate entities await review.")
        st.caption("This summary is calculated from the repository on every data refresh.")


render_anchor("market-statistics")
st.space("medium")
st.markdown("#### MARKET STATISTICS")
st.header("External landscape snapshot")

with st.container(horizontal=True, wrap=True):
    st.metric("Programs tracked", len(records), border=True, icon=":material/biotech:")
    st.metric("Semaglutide-linked programs", len(semaglutide_programs), border=True, icon=":material/hub:")
    st.metric("Historical findings", len(findings_df), border=True, icon=":material/history:")
    st.metric("Confirmed evidence", confirmed_count, border=True, icon=":material/verified:")

family_col, evidence_col = st.columns(2)
with family_col:
    with st.container(border=True):
        st.subheader("Technologies by approach")
        st.caption("All umbrella records in the repository")
        st.plotly_chart(
            build_family_chart(records),
            width="stretch",
            key="family_mix",
            config={"displayModeBar": False, "staticPlot": True},
        )
with evidence_col:
    with st.container(border=True):
        st.subheader("Evidence confidence")
        st.caption("All historical findings")
        st.plotly_chart(
            build_evidence_chart(findings_df),
            width="stretch",
            key="evidence_mix",
            config={"displayModeBar": False, "staticPlot": True},
        )


render_anchor("program-directory")
st.space("medium")
st.markdown("#### CURRENT RECORD")
st.header("Program directory")
st.caption("Every tracked umbrella record. Daily JSON updates appear here automatically.")

program_rows = []
for record in sorted(records, key=lambda item: (item["stage_order"], item["canonical_name"]), reverse=True):
    status = record["current_status"]
    program_rows.append(
        {
            "Program": record["canonical_name"],
            "Origin": "Korea" if record.get("origin") == "KR" else record.get("origin") or "—",
            "Technology": FAMILY_LABELS.get(record.get("technology_family"), str(record.get("technology_family") or "Other")),
            "Stage": record["stage_label"],
            "Reported status": status.get("stage") or "—",
            "Dosing target": status.get("dosing_target") or "—",
            "Latest data point": status.get("data_point") or "—",
            "Updated": status.get("last_updated"),
        }
    )

program_df = pd.DataFrame(program_rows)
program_df["Updated"] = pd.to_datetime(program_df["Updated"], errors="coerce")
st.dataframe(
    program_df,
    width="stretch",
    height=560,
    hide_index=True,
    row_height=58,
    column_config={
        "Program": st.column_config.TextColumn("Program", width="large", pinned=True),
        "Origin": st.column_config.TextColumn("Origin", width="small"),
        "Technology": st.column_config.TextColumn("Technology", width="medium"),
        "Stage": st.column_config.TextColumn("Normalized stage", width="small"),
        "Reported status": st.column_config.TextColumn("Reported status", width="large"),
        "Dosing target": st.column_config.TextColumn("Dosing target", width="medium"),
        "Latest data point": st.column_config.TextColumn("Latest data point", width="large"),
        "Updated": st.column_config.DateColumn("Updated", format="YYYY-MM-DD", width="small"),
    },
)


render_anchor("evidence-archive")
st.space("medium")
st.markdown("#### HISTORICAL RECORD")
st.header("Evidence archive")
st.caption("The complete finding history across all tracked programs, newest first. Nothing is removed from this view when it stops being recent.")

archive_df = findings_df.rename(
    columns={
        "date": "Date",
        "company": "Company",
        "program": "Program",
        "type": "Type",
        "summary": "Finding",
        "confidence": "Confidence",
        "source_name": "Source",
        "source_url": "Source URL",
        "source_tier": "Tier",
    }
)[["Date", "Company", "Program", "Type", "Finding", "Confidence", "Source", "Tier", "Source URL"]]
archive_df["Type"] = archive_df["Type"].map(lambda value: FINDING_LABELS.get(str(value), str(value).replace("_", " ").title()))
archive_df["Confidence"] = archive_df["Confidence"].str.title()

st.dataframe(
    archive_df,
    width="stretch",
    height=680,
    hide_index=True,
    row_height=64,
    placeholder="—",
    column_config={
        "Date": st.column_config.DateColumn("Date", format="YYYY-MM-DD", width="small", pinned=True),
        "Company": st.column_config.TextColumn("Company", width="medium"),
        "Program": st.column_config.TextColumn("Program", width="large"),
        "Type": st.column_config.TextColumn("Evidence type", width="small"),
        "Finding": st.column_config.TextColumn("Finding", width="large"),
        "Confidence": st.column_config.TextColumn("Confidence", width="small"),
        "Source": st.column_config.TextColumn("Source", width="medium"),
        "Tier": st.column_config.NumberColumn("Tier", format="%d", width="small"),
        "Source URL": st.column_config.LinkColumn("Open source", display_text="Open ↗", width="small"),
    },
)

st.caption(
    f"Loaded {len(records)} umbrella files and {len(findings_df)} historical findings from the repository. "
    f"Generated on {date.today().isoformat()}."
)

if load_errors:
    with st.expander(f"Data-quality warnings ({len(load_errors)})", icon=":material/warning:"):
        for error in load_errors:
            st.write(f"- {error}")


st.html(
    """
    <script>
      (() => {
        const sectionIds = ["market-overview", "latest-intelligence", "market-statistics", "program-directory", "evidence-archive"];
        const links = [...document.querySelectorAll("[data-lai-nav]")];
        const sync = () => {
          const marker = window.scrollY + Math.min(window.innerHeight * 0.34, 300);
          let current = sectionIds[0];
          sectionIds.forEach((id) => {
            const section = document.getElementById(id);
            if (section && section.offsetTop <= marker) current = id;
          });
          if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8) current = sectionIds.at(-1);
          links.forEach((link) => link.classList.toggle("is-current", link.dataset.laiNav === current));
        };
        if (window.__laiPulseScrollHandler) window.removeEventListener("scroll", window.__laiPulseScrollHandler);
        window.__laiPulseScrollHandler = sync;
        window.addEventListener("scroll", sync, { passive: true });
        sync();
      })();
    </script>
    """,
    unsafe_allow_javascript=True,
)
