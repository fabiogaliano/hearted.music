// Emits one HTML page with exemplar (gold) and candidate (latest experiment run)
// rendered side-by-side per track, so plannotator can annotate both halves in a
// single session. Every annotatable cell carries data-cell-id of the form
// `<spotifyTrackId>::<fieldPath>::<exemplar|candidate>`, which merge-annotations.ts
// parses back into paired notes per field.
//
// Run: bun run scripts/voice-audit/build-compare.ts
// Out: claudedocs/voice-compare/compare.html

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGoldExemplars, type GoldExemplar } from "./exemplars";
import type { SongAnalysisLyrical } from "@/lib/domains/enrichment/content-analysis/song-analysis";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPERIMENTS_DIR = join(HERE, "experiments");
const OUT_DIR = join(HERE, "..", "..", "claudedocs", "voice-compare");
const OUT_FILE = join(OUT_DIR, "compare.html");

interface ExperimentRun {
	runId: string;
	timestamp: string;
	song: string;
	spotifyTrackId: string;
	promptVersion: string;
	model: string;
	analysis: SongAnalysisLyrical;
}

// Picks the most recent run per spotifyTrackId. Timestamp lives in the JSON so we
// don't depend on filename conventions staying stable.
function loadLatestRunPerTrack(): Map<string, ExperimentRun> {
	const latest = new Map<string, ExperimentRun>();
	const files = readdirSync(EXPERIMENTS_DIR).filter((f) => f.endsWith(".json"));
	for (const file of files) {
		const raw = JSON.parse(readFileSync(join(EXPERIMENTS_DIR, file), "utf-8"));
		if (!raw.spotifyTrackId || !raw.analysis) continue;
		const prev = latest.get(raw.spotifyTrackId);
		if (!prev || raw.timestamp > prev.timestamp) latest.set(raw.spotifyTrackId, raw as ExperimentRun);
	}
	return latest;
}

type FieldMap = Map<string, string>;

// Field order matters for the rendered page (top-to-bottom reading flow); arrays
// are emitted up to the longer of the two sides so missing entries show as gaps,
// which is itself useful comparison data.
function flatten(a: SongAnalysisLyrical): FieldMap {
	const out: FieldMap = new Map();
	out.set("headline", a.headline);
	out.set("compound_mood", a.compound_mood);
	out.set("mood_description", a.mood_description);
	out.set("interpretation", a.interpretation);
	a.themes.forEach((t, i) => {
		out.set(`themes[${i}].name`, t.name);
		out.set(`themes[${i}].description`, t.description);
	});
	a.journey.forEach((j, i) => {
		out.set(`journey[${i}].section`, j.section);
		out.set(`journey[${i}].mood`, j.mood);
		out.set(`journey[${i}].description`, j.description);
	});
	a.key_lines.forEach((k, i) => {
		out.set(`key_lines[${i}].line`, k.line);
		out.set(`key_lines[${i}].insight`, k.insight);
	});
	out.set("sonic_texture", a.sonic_texture);
	return out;
}

// Union of keys, exemplar-first for a stable order regardless of which side has more.
function unionFieldOrder(left: FieldMap, right: FieldMap): string[] {
	const seen = new Set<string>();
	const order: string[] = [];
	for (const k of left.keys()) {
		if (!seen.has(k)) { seen.add(k); order.push(k); }
	}
	for (const k of right.keys()) {
		if (!seen.has(k)) { seen.add(k); order.push(k); }
	}
	return order;
}

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function renderTrack(gold: GoldExemplar, run: ExperimentRun): string {
	const left = flatten(gold.analysis);
	const right = flatten(run.analysis);
	const fields = unionFieldOrder(left, right);
	const trackId = gold.spotifyTrackId;

	const rows = fields.map((field) => {
		const l = left.get(field) ?? "";
		const r = right.get(field) ?? "";
		return `
			<tr data-row-id="${esc(trackId)}::${esc(field)}">
				<th class="field">${esc(field)}</th>
				<td class="cell exemplar"
					data-cell-id="${esc(trackId)}::${esc(field)}::exemplar"
					data-track-id="${esc(trackId)}"
					data-field="${esc(field)}"
					data-side="exemplar">${esc(l)}</td>
				<td class="cell candidate"
					data-cell-id="${esc(trackId)}::${esc(field)}::candidate"
					data-track-id="${esc(trackId)}"
					data-field="${esc(field)}"
					data-side="candidate">${esc(r)}</td>
			</tr>`;
	}).join("");

	return `
		<section class="track" data-track-id="${esc(trackId)}" data-song="${esc(gold.song)}">
			<header>
				<h2>${esc(gold.song)}</h2>
				<p class="meta">candidate: ${esc(run.model)} · prompt v${esc(run.promptVersion)} · ${esc(run.timestamp)}</p>
			</header>
			<table class="compare">
				<thead>
					<tr><th>field</th><th>exemplar (gold)</th><th>candidate (model)</th></tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		</section>`;
}

function renderPage(sections: string[]): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Voice compare — exemplars vs latest runs</title>
<style>
	body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 1400px; margin: 2rem auto; padding: 0 1rem; color: #111; }
	h1 { font-size: 1.4rem; }
	section.track { margin: 2.5rem 0; }
	section.track header h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
	section.track header .meta { margin: 0 0 0.75rem; color: #666; font-size: 0.85rem; }
	table.compare { width: 100%; border-collapse: collapse; table-layout: fixed; }
	table.compare th, table.compare td { border: 1px solid #e3e3e3; padding: 0.5rem 0.6rem; vertical-align: top; }
	table.compare thead th { background: #f5f5f5; text-align: left; font-weight: 600; }
	table.compare th.field { width: 14%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; color: #555; background: #fafafa; }
	table.compare td.cell { width: 43%; white-space: pre-wrap; }
	table.compare td.exemplar { background: #fafffa; }
	table.compare td.candidate { background: #fafaff; }
	table.compare td.cell:empty::before { content: "—"; color: #bbb; }
</style>
</head>
<body>
<h1>Voice compare — exemplars (gold) vs latest experiment runs</h1>
<p>Each annotatable cell carries <code>data-cell-id="&lt;trackId&gt;::&lt;field&gt;::&lt;side&gt;"</code>. Run <code>scripts/voice-audit/merge-annotations.ts</code> on plannotator's output to group notes per field.</p>
${sections.join("\n")}
</body>
</html>`;
}

function main(): void {
	const golds = loadGoldExemplars();
	const runs = loadLatestRunPerTrack();
	const sections: string[] = [];
	const missing: string[] = [];
	for (const gold of golds.values()) {
		const run = runs.get(gold.spotifyTrackId);
		if (!run) { missing.push(gold.song); continue; }
		sections.push(renderTrack(gold, run));
	}
	if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(OUT_FILE, renderPage(sections), "utf-8");
	const matched = golds.size - missing.length;
	process.stdout.write(`wrote ${OUT_FILE}\n  tracks: ${matched}/${golds.size}\n`);
	if (missing.length) process.stdout.write(`  no experiment run for: ${missing.join(", ")}\n`);
}

main();
