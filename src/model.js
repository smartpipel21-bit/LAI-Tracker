export const OUR_PRODUCT_ID = "daewoong-tionlab-quject";

export const STAGES = {
  Research: 0,
  Preclinical: 1,
  "IND filed": 2,
  "Phase 1": 3,
  "Phase 2": 4,
  "Phase 3": 5,
  "Filed / review": 6,
  "Approved / marketed": 7
};

export const STAGE_COLORS = {
  Research: "#a9aaa5",
  Preclinical: "#e4a11b",
  "IND filed": "#ee7443",
  "Phase 1": "#2bb98a",
  "Phase 2": "#7666b7",
  "Phase 3": "#367fd0",
  "Filed / review": "#225da8",
  "Approved / marketed": "#70736f"
};

export const FAMILY_LABELS = {
  plga_microsphere: "PLGA microsphere",
  lipid_liquid_crystal_depot: "Lipid liquid-crystal depot",
  in_situ_forming_depot: "In-situ forming depot",
  molecular_engineering: "Molecular engineering",
  prodrug_linker: "Prodrug / linker",
  subdermal_implant: "Subdermal implant",
  other: "Other"
};

export const FAMILY_COLORS = {
  plga_microsphere: "#367fd0",
  lipid_liquid_crystal_depot: "#ee7443",
  in_situ_forming_depot: "#2bb98a",
  molecular_engineering: "#7666b7",
  prodrug_linker: "#e4a11b",
  subdermal_implant: "#d86698",
  other: "#70736f"
};

export const FINDING_LABELS = {
  trial_data_readout: "Clinical / data",
  regulatory: "Regulatory",
  deal_partnership: "Partnership",
  market_reaction: "Market reaction",
  manufacturing_capacity: "Manufacturing",
  financing_investor: "Financing"
};

export function normalizeStage(stageText = "") {
  const text = String(stageText).toLowerCase();
  if (/\bapproved\b|\bmarketed\b|commercially launched/.test(text)) return "Approved / marketed";
  if (text.includes("ind filed") || text.includes("ind application")) return "IND filed";
  if (/phase\s*(?:i|1)\s*\/\s*(?:ii|2)\w*/.test(text)) return "Phase 2";
  if (/(?:positive|completed|following positive)\s+phase\s*(?:i|1)\w*/.test(text)) return "Phase 1";

  const patterns = [
    ["Phase 3", /phase\s*(?:iii|3)\w*|pivotal(?:-stage)?/g],
    ["Phase 2", /phase\s*(?:ii|2)\w*/g],
    ["Phase 1", /phase\s*(?:i|1)\w*/g]
  ];
  const futureWords = /target|plan|prepar|expect|intend|aim|advanc(?:e|ing) toward/;
  for (const [label, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = Math.max(0, (match.index ?? 0) - 32);
      const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 42);
      if (!futureWords.test(text.slice(start, end))) return label;
    }
  }
  if (/\bnda\b|\bbla\b|under (?:fda|ema|nmpa|regulatory) review/.test(text)) return "Filed / review";
  if (/preclinical|nonclinical|ind-enabling/.test(text)) return "Preclinical";
  return "Research";
}

export function splitName(canonicalName = "") {
  const parts = String(canonicalName).split(/\s+[–—-]\s+/, 2);
  return parts.length === 2
    ? { company: parts[0].trim(), program: parts[1].trim() }
    : { company: String(canonicalName).trim(), program: String(canonicalName).trim() };
}

export function isSemaglutideProgram(record) {
  const status = record.current_status ?? {};
  const text = [
    record.canonical_name ?? "",
    ...(record.aliases ?? []),
    status.data_point ?? "",
    ...(record.finding_history ?? []).map((finding) => finding.summary ?? "")
  ].join(" ").toLowerCase();
  if (!text.includes("semaglutide")) return false;
  return [
    /semaglutide.{0,55}(?:depot|implant|asset|candidate|microparticle|microsphere|lai|injectable)/,
    /(?:depot|implant|asset|candidate|microparticle|microsphere|lai|injectable|once-monthly|plga).{0,55}semaglutide/
  ].some((pattern) => pattern.test(text));
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function truncate(value, limit = 160) {
  const text = String(value || "—").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const shortened = text.slice(0, limit - 1);
  return `${shortened.slice(0, shortened.lastIndexOf(" ") || shortened.length)}…`;
}

export function formatDate(value, long = false) {
  if (!value) return "Date unavailable";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat("en-GB", long
    ? { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }
    : { day: "2-digit", month: "short", timeZone: "UTC" }).format(date);
}

export function prepareDatabase(payload) {
  const records = (payload.records ?? []).map((record) => {
    const names = splitName(record.canonical_name);
    const stageLabel = normalizeStage(record.current_status?.stage);
    return {
      ...record,
      ...names,
      stageLabel,
      stageOrder: STAGES[stageLabel],
      isSemaglutide: isSemaglutideProgram(record),
      isOurProduct: record.id === OUR_PRODUCT_ID
    };
  });

  const findings = records.flatMap((record) => (record.finding_history ?? []).map((finding) => ({
    ...finding,
    company: record.company,
    program: record.program,
    recordId: record.id,
    technologyFamily: record.technology_family ?? "other",
    sourceName: finding.source?.name ?? "Source unavailable",
    sourceUrl: safeUrl(finding.source?.url),
    sourceTier: finding.source?.tier ?? null,
    timestamp: Date.parse(`${String(finding.date ?? "").slice(0, 10)}T00:00:00Z`) || 0
  }))).sort((a, b) => b.timestamp - a.timestamp || String(b.id).localeCompare(String(a.id)));

  const semaglutidePrograms = records.filter((record) => record.isSemaglutide);
  const developmentPrograms = semaglutidePrograms.filter((record) => record.stageLabel !== "Approved / marketed");
  const leader = [...developmentPrograms].sort((a, b) =>
    b.stageOrder - a.stageOrder || String(b.current_status?.last_updated ?? "").localeCompare(String(a.current_status?.last_updated ?? ""))
  )[0] ?? records[0];

  const candidates = payload.candidates ?? [];
  const pendingCandidates = candidates.filter((candidate) => candidate.status === "pending");
  const runStatus = payload.meta?.last_run ?? {};
  const operationalRuns = ["daily_scan", "weekly_sweep", "qc_tier2", "qc_tier3"];
  const completedRuns = operationalRuns.filter((key) => runStatus[key]).length;

  return {
    records,
    findings,
    semaglutidePrograms,
    leader,
    candidates,
    pendingCandidates,
    runStatus,
    completedRuns,
    latestDataDate: payload.latest_data_date,
    builtAt: payload.built_at
  };
}
