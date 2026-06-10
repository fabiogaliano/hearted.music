/**
 * Offline replay runner CLI.
 *
 * Usage:
 *   # Prod-faithful (uses DeepInfra Qwen3-Reranker-0.6B — requires API key):
 *   DEEPINFRA_API_KEY=<key> bun run scripts/matching-lab/replay/index.ts \
 *     --a configs/metadata-doc.json \
 *     --b configs/analysis-doc.json \
 *     [--account <uuid>] [--since <iso-date>] [--require-snapshot] [--no-rerank-a] [--label <run-name>]
 *
 *   # Local dev (uses local ONNX Qwen3 sidecar — no API key needed):
 *   ML_PROVIDER=local bun run scripts/matching-lab/replay/index.ts ...
 *
 *   # Matching-only (no reranker available — HuggingFace has no reranker):
 *   bun run scripts/matching-lab/replay/index.ts ...
 *
 * Provider selection (mirrors getMlProvider() in factory.ts):
 *   1. ML_PROVIDER=local  → local ONNX sidecar (dev-only)
 *   2. DEEPINFRA_API_KEY set → DeepInfra Qwen3-Reranker-0.6B (prod-faithful)
 *   3. Neither             → HuggingFace fallback; reranker unavailable; matching-only
 *
 * The two variants share one model load (single process) to keep the ~1.2GB
 * Qwen3 model in memory across both runs.
 */

import * as fs from "fs";
import * as path from "path";
import { RerankerService } from "@/lib/integrations/reranker/service";
import { selectProvider } from "@/lib/integrations/providers/factory";
import type { DecidedPairRanks } from "./metrics";
import { computeDiff, formatDiffTable, buildResultJson } from "./metrics";
import { loadDecisions } from "./load-decisions";
import { loadAccountInputs, runVariant } from "./run-config";
import type { VariantConfig } from "./run-config";

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  configA: string;
  configB: string;
  accountId?: string;
  since?: string;
  requireSnapshot: boolean;
  noRerankA: boolean;
  label: string;
} {
  const args = process.argv.slice(2);
  let configA = "";
  let configB = "";
  let accountId: string | undefined;
  let since: string | undefined;
  let requireSnapshot = false;
  let noRerankA = false;
  let label = "run";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--a" && args[i + 1]) configA = args[++i];
    else if (args[i] === "--b" && args[i + 1]) configB = args[++i];
    else if (args[i] === "--account" && args[i + 1]) accountId = args[++i];
    else if (args[i] === "--since" && args[i + 1]) since = args[++i];
    else if (args[i] === "--require-snapshot") requireSnapshot = true;
    else if (args[i] === "--no-rerank-a") noRerankA = true;
    else if (args[i] === "--label" && args[i + 1]) label = args[++i];
  }

  if (!configA || !configB) {
    console.error("Usage: replay/index.ts --a <config-a.json> --b <config-b.json> [--account <id>] [--since <iso>] [--require-snapshot] [--no-rerank-a] [--label <run>]");
    process.exit(1);
  }

  return { configA, configB, accountId, since, requireSnapshot, noRerankA, label };
}

function resolveConfigPath(configArg: string): string {
  // If it looks like a relative path from the script location, resolve relative
  // to the configs/ directory.  Otherwise resolve from cwd.
  if (configArg.startsWith("/") || configArg.startsWith("./") || configArg.startsWith("../")) {
    return path.resolve(configArg);
  }
  // Bare name like "configs/metadata-doc.json" or "metadata-doc.json"
  const scriptDir = new URL(".", import.meta.url).pathname;
  const withExtension = configArg.endsWith(".json") ? configArg : `${configArg}.json`;
  return path.resolve(scriptDir, withExtension);
}

function loadVariantConfig(configPath: string): VariantConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as VariantConfig;
  } catch (e) {
    throw new Error(`Failed to load variant config at ${configPath}: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

const DEEPINFRA_RERANKER_MODEL = "Qwen/Qwen3-Reranker-0.6B";
const LOCAL_RERANKER_MODEL = "Qwen3-Reranker-0.6B (local ONNX)";

/**
 * Resolve which reranker provider/model the run will use, matching the logic
 * of getMlProvider() / selectProvider() in factory.ts.
 *
 * Priority (mirrors factory.ts selectProvider):
 *   1. ML_PROVIDER=local  → local ONNX sidecar (dev-only)
 *   2. DEEPINFRA_API_KEY  → DeepInfra Qwen3-Reranker-0.6B (prod-faithful)
 *   3. neither            → HuggingFace; reranker unavailable; matching-only
 */
function resolveRerankerProvider(): {
  providerName: string;
  model: string | null;
  rerankerAvailable: boolean;
  warning: string | null;
} {
  const selected = selectProvider();

  if (selected === "local") {
    return {
      providerName: "local",
      model: LOCAL_RERANKER_MODEL,
      rerankerAvailable: true,
      warning: null,
    };
  }

  if (selected === "deepinfra") {
    return {
      providerName: "deepinfra",
      model: DEEPINFRA_RERANKER_MODEL,
      rerankerAvailable: true,
      warning: null,
    };
  }

  // huggingface or unknown — no reranker
  const warning =
    `\n${"!".repeat(72)}\n` +
    `  WARNING: selected provider = "${selected}" — no reranker available.\n` +
    `  This run will complete MATCHING-ONLY — reranker scores will be absent.\n` +
    `\n` +
    `  To run with reranking:\n` +
    `    DEEPINFRA_API_KEY=<key> bun run scripts/matching-lab/replay/index.ts ...  (prod-faithful)\n` +
    `    ML_PROVIDER=local       bun run scripts/matching-lab/replay/index.ts ...  (local dev)\n` +
    `${"!".repeat(72)}\n`;

  return {
    providerName: selected,
    model: null,
    rerankerAvailable: false,
    warning,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { configA, configB, accountId, since, requireSnapshot, noRerankA, label } = parseArgs();

  console.log("\n=== Offline Replay Runner ===\n");

  // Provider resolution — print which reranker will be used before anything else
  const providerInfo = resolveRerankerProvider();
  if (providerInfo.warning) {
    console.warn(providerInfo.warning);
  } else {
    console.log(`  Reranker provider : ${providerInfo.providerName}`);
    console.log(`  Reranker model    : ${providerInfo.model}`);
    if (providerInfo.providerName === "deepinfra") {
      console.log(`  Mode              : prod-faithful (DeepInfra API)`);
    } else if (providerInfo.providerName === "local") {
      console.log(`  Mode              : local dev (ONNX sidecar, ML_PROVIDER=local)`);
    }
    console.log();
  }

  // Load variant configs
  const variantA = loadVariantConfig(resolveConfigPath(configA));
  const variantB = loadVariantConfig(resolveConfigPath(configB));

  // Apply --no-rerank-a
  if (noRerankA) {
    variantA.reranker = { ...(variantA.reranker ?? {}), enabled: false };
    console.log(`  [cli] --no-rerank-a: forced variant A reranker.enabled=false`);
  }

  console.log(`  Variant A: ${variantA.label} (${configA})`);
  console.log(`  Variant B: ${variantB.label} (${configB})`);
  if (accountId) console.log(`  Account filter: ${accountId}`);
  if (since) console.log(`  Since filter: ${since}`);
  if (requireSnapshot) console.log(`  Requiring linked snapshots`);
  console.log();

  // Load decisions
  console.log("[1/4] Loading decisions...");
  const decisionsByAccount = await loadDecisions({ accountId, since, requireSnapshot });

  if (decisionsByAccount.size === 0) {
    console.log("  No decisions found matching the filters. Nothing to replay.");
    process.exit(0);
  }

  for (const [acctId, rows] of decisionsByAccount) {
    const added = rows.filter((r) => r.decision === "added").length;
    const dismissed = rows.filter((r) => r.decision === "dismissed").length;
    console.log(
      `  Account ${acctId}: ${rows.length} decisions (${added} added, ${dismissed} dismissed)`,
    );
  }
  console.log();

  // Build shared reranker service — ONE model load for BOTH variants.
  // Both variants instantiate their own RerankerService with their own config,
  // but the underlying provider/model is the same process-level resource.
  console.log("[2/4] Initialising shared reranker service...");
  let sharedRerankerService: RerankerService | null = null;
  try {
    sharedRerankerService = new RerankerService();
    const available = await sharedRerankerService.isAvailable();
    if (available) {
      console.log("  Reranker: available");
    } else {
      console.warn("  Reranker: isAvailable() = false — reranking will be skipped");
      sharedRerankerService = null;
    }
  } catch (e) {
    console.warn(`  Reranker: failed to initialise (${e}) — reranking will be skipped`);
    sharedRerankerService = null;
  }
  console.log();

  // Accumulate decided pairs across all accounts
  const allDecidedPairRanks: DecidedPairRanks[] = [];

  console.log("[3/4] Running variants per account...");
  for (const [acctId, decisions] of decisionsByAccount) {
    console.log(`\n  --- Account: ${acctId} ---`);

    // Load account inputs once (shared by both variants)
    const inputs = await loadAccountInputs(acctId, decisions);

    if (inputs.matchingProfiles.length === 0) {
      console.warn(`  No playlist profiles for account ${acctId} — skipping`);
      continue;
    }

    // Run variant A
    const resultA = await runVariant(inputs, variantA, sharedRerankerService);

    // Run variant B
    const resultB = await runVariant(inputs, variantB, sharedRerankerService);

    // Assemble DecidedPairRanks[]
    for (const d of decisions) {
      const pairKey = `${d.songId}:${d.playlistId}`;
      const rankA = resultA.rankMap.get(pairKey) ?? null;
      const rankB = resultB.rankMap.get(pairKey) ?? null;

      allDecidedPairRanks.push({
        songId: d.songId,
        playlistId: d.playlistId,
        decision: d.decision,
        servedRank: d.servedRank,
        rankA,
        rankB,
      });
    }
  }

  if (allDecidedPairRanks.length === 0) {
    console.log("\nNo decided pairs to compare. Exiting.");
    process.exit(0);
  }

  console.log(
    `\n  Assembled ${allDecidedPairRanks.length} decided pairs for diff.\n`,
  );

  // Compute diff + format
  console.log("[4/4] Computing diff and writing results...");
  const diff = computeDiff(allDecidedPairRanks, variantA.label, variantB.label);
  const table = formatDiffTable(diff);
  console.log(table);

  // Write result JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeA = variantA.label.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeB = variantB.label.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${timestamp}-${safeA}-vs-${safeB}.json`;

  // Resolve project root: replay/ → matching-lab/ → scripts/ → v1_hearted/
  const resultsDir = path.resolve(
    new URL("../../..", import.meta.url).pathname,
    "claudedocs/replay-results",
  );
  fs.mkdirSync(resultsDir, { recursive: true });
  const outputPath = path.join(resultsDir, filename);

  const resultJson = buildResultJson(diff, {
    runId: `${label}-${timestamp}`,
    timestamp: new Date().toISOString(),
    notes: providerInfo.rerankerAvailable
      ? undefined
      : `provider="${providerInfo.providerName}" — reranking was unavailable; matching-only run`,
    rerankerProvider: providerInfo.providerName,
    rerankerModel: providerInfo.model,
  });

  fs.writeFileSync(outputPath, JSON.stringify(resultJson, null, 2));
  console.log(`  Result JSON written to: ${outputPath}\n`);
}

main().catch((err) => {
  console.error("Replay runner failed:", err);
  process.exit(1);
});
