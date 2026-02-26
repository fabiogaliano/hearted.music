import type { TestSong } from "./test-songs";
import type { LyricalAnalysis } from "./schema";

export interface AnalysisRun {
	variantId: string;
	variantName: string;
	song: TestSong;
	output: Record<string, unknown> | null;
	tokens: { prompt: number; completion: number; total: number } | null;
	error: string | null;
	durationMs: number;
	prompt?: string;
	timestamp?: string;
}

function esc(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function moodHue(mood: string): number {
	let hash = 0;
	for (let i = 0; i < mood.length; i++) {
		hash = mood.charCodeAt(i) + ((hash << 5) - hash);
	}
	return ((hash % 360) + 360) % 360;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function renderCard(run: AnalysisRun): string {
	if (run.error) {
		return `
		<div class="card card--error">
			<div class="card-header">${esc(run.variantName)}</div>
			<div class="error-banner">${esc(run.error)}</div>
			<div class="card-footer">
				<span class="timing">${formatDuration(run.durationMs)}</span>
			</div>
		</div>`;
	}

	if (!run.output) {
		return `
		<div class="card card--empty">
			<div class="card-header">${esc(run.variantName)}</div>
			<div class="empty-notice">No output produced</div>
			<div class="card-footer">
				<span class="timing">${formatDuration(run.durationMs)}</span>
			</div>
		</div>`;
	}

	const out = run.output as unknown as LyricalAnalysis;
	const sections: string[] = [];

	if (out.headline) {
		sections.push(`<p class="field-headline">${esc(out.headline)}</p>`);
	}

	if (out.compound_mood) {
		const hue = moodHue(out.compound_mood);
		sections.push(
			`<span class="mood-pill" style="--pill-hue: ${hue}">${esc(out.compound_mood)}</span>`,
		);
	}

	if (out.mood_description) {
		sections.push(
			`<p class="field-mood-desc">${esc(out.mood_description)}</p>`,
		);
	}

	if (out.interpretation) {
		sections.push(
			`<div class="field-section">
				<h4>Interpretation</h4>
				<p>${esc(out.interpretation)}</p>
			</div>`,
		);
	}

	if (out.themes?.length) {
		const items = out.themes
			.map(
				(t) =>
					`<li><strong>${esc(t.name)}</strong> &mdash; ${esc(t.description)}</li>`,
			)
			.join("\n");
		sections.push(
			`<div class="field-section">
				<h4>Themes</h4>
				<ul>${items}</ul>
			</div>`,
		);
	}

	if (out.journey?.length) {
		const items = out.journey
			.map(
				(j) =>
					`<li>
					<div class="journey-header">
						<span class="journey-section">${esc(j.section)}</span>
						<span class="journey-mood">${esc(j.mood)}</span>
					</div>
					<p class="journey-desc">${esc(j.description)}</p>
				</li>`,
			)
			.join("\n");
		sections.push(
			`<div class="field-section">
				<h4>Journey</h4>
				<ol class="journey-list">${items}</ol>
			</div>`,
		);
	}

	if (out.key_lines?.length) {
		const items = out.key_lines
			.map(
				(kl) =>
					`<div class="key-line">
					<blockquote>${esc(kl.line)}</blockquote>
					<p class="key-line-insight">${esc(kl.insight)}</p>
				</div>`,
			)
			.join("\n");
		sections.push(
			`<div class="field-section">
				<h4>Key Lines</h4>
				${items}
			</div>`,
		);
	}

	const tokenHtml = run.tokens
		? `<span class="token-detail">${run.tokens.prompt}p</span>
		   <span class="token-sep">/</span>
		   <span class="token-detail">${run.tokens.completion}c</span>
		   <span class="token-sep">/</span>
		   <span class="token-detail">${run.tokens.total}t</span>`
		: `<span class="token-detail">no token data</span>`;

	return `
	<div class="card">
		<div class="card-header">${esc(run.variantName)}</div>
		<div class="card-body">
			${sections.join("\n")}
		</div>
		<div class="card-footer">
			<span class="tokens">${tokenHtml}</span>
			<span class="timing">${formatDuration(run.durationMs)}</span>
		</div>
	</div>`;
}

function renderSummaryTable(
	results: AnalysisRun[],
	variantIds: string[],
	variantNames: Map<string, string>,
	songCount: number,
): string {
	const rows = variantIds
		.map((id) => {
			const runs = results.filter((r) => r.variantId === id);
			const errors = runs.filter((r) => r.error !== null).length;
			const totalTokens = runs.reduce(
				(sum, r) => sum + (r.tokens?.total ?? 0),
				0,
			);
			const totalPrompt = runs.reduce(
				(sum, r) => sum + (r.tokens?.prompt ?? 0),
				0,
			);
			const totalCompletion = runs.reduce(
				(sum, r) => sum + (r.tokens?.completion ?? 0),
				0,
			);
			const avgTokens =
				songCount > 0 ? Math.round(totalTokens / songCount) : 0;
			const avgDuration =
				runs.length > 0
					? Math.round(
							runs.reduce((sum, r) => sum + r.durationMs, 0) /
								runs.length,
						)
					: 0;

			return `<tr>
			<td class="cell-name">${esc(variantNames.get(id) ?? id)}</td>
			<td class="cell-mono">${totalPrompt.toLocaleString()}</td>
			<td class="cell-mono">${totalCompletion.toLocaleString()}</td>
			<td class="cell-mono">${totalTokens.toLocaleString()}</td>
			<td class="cell-mono">${avgTokens.toLocaleString()}</td>
			<td class="cell-mono">${formatDuration(avgDuration)}</td>
			<td class="cell-errors">${errors > 0 ? `<span class="error-count">${errors}</span>` : "0"}</td>
		</tr>`;
		})
		.join("\n");

	return `
	<table class="summary-table">
		<thead>
			<tr>
				<th>Variant</th>
				<th>Prompt Tokens</th>
				<th>Completion Tokens</th>
				<th>Total Tokens</th>
				<th>Avg / Song</th>
				<th>Avg Latency</th>
				<th>Errors</th>
			</tr>
		</thead>
		<tbody>
			${rows}
		</tbody>
	</table>`;
}

export function generateReport(
	results: AnalysisRun[],
	variantNames: Map<string, string>,
	songs: TestSong[],
): string {
	const variantIds = [...new Set(results.map((r) => r.variantId))];
	const colCount = variantIds.length;
	const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);

	const tabBar = songs
		.map(
			(song, index) =>
				`<button class="song-tab${index === 0 ? " song-tab--active" : ""}" data-song-index="${index}">${esc(song.artist)} &mdash; ${esc(song.title)}</button>`,
		)
		.join("\n\t\t");

	const songSections = songs
		.map((song, index) => {
			const songRuns = results.filter(
				(r) =>
					r.song.artist === song.artist && r.song.title === song.title,
			);

			const cards = variantIds
				.map((id) => {
					const run = songRuns.find((r) => r.variantId === id);
					if (!run) {
						return `<div class="card card--missing">
						<div class="card-header">${esc(variantNames.get(id) ?? id)}</div>
						<div class="empty-notice">Not run</div>
					</div>`;
					}
					return renderCard(run);
				})
				.join("\n");

			const albumNote = song.album
				? `<span class="song-album">${esc(song.album)}</span>`
				: "";

			return `
		<section class="song-section" id="song-${index}"${index > 0 ? ' style="display: none"' : ''}>
			<div class="song-header">
				<h2>${esc(song.artist)} &mdash; ${esc(song.title)}</h2>
				${albumNote}
			</div>
			<div class="variants-grid" style="grid-template-columns: repeat(${colCount}, 1fr)">
				${cards}
			</div>
		</section>`;
		})
		.join("\n");

	const summaryTable = renderSummaryTable(
		results,
		variantIds,
		variantNames,
		songs.length,
	);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prompt Lab Report &mdash; ${timestamp}</title>
<style>
:root {
	--bg: #f8f7f5;
	--surface: #ffffff;
	--border: #e2e0dc;
	--border-light: #edecea;
	--text: #1a1918;
	--text-secondary: #6b6862;
	--text-tertiary: #9b978f;
	--accent: #4a6fa5;
	--error-bg: #fef2f2;
	--error-border: #e8b4b4;
	--error-text: #9b2c2c;
	--font-body: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
	--font-mono: "JetBrains Mono", "Fira Code", "SF Mono", "Consolas", monospace;
	--radius: 6px;
	--shadow-card: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06);
}

*, *::before, *::after {
	box-sizing: border-box;
	margin: 0;
	padding: 0;
}

body {
	font-family: var(--font-body);
	background: var(--bg);
	color: var(--text);
	line-height: 1.6;
	padding: 2rem 2.5rem;
	max-width: 100%;
}

.report-header {
	margin-bottom: 2.5rem;
	padding-bottom: 1.5rem;
	border-bottom: 1px solid var(--border);
}

.report-header h1 {
	font-size: 1.5rem;
	font-weight: 700;
	letter-spacing: -0.02em;
	margin-bottom: 0.5rem;
}

.report-meta {
	display: flex;
	gap: 1.5rem;
	color: var(--text-secondary);
	font-size: 0.85rem;
}

.report-meta span {
	display: flex;
	align-items: center;
	gap: 0.35rem;
}

.summary-section {
	margin-bottom: 3rem;
}

.summary-section h3 {
	font-size: 0.8rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--text-tertiary);
	margin-bottom: 0.75rem;
}

.summary-table {
	width: 100%;
	border-collapse: collapse;
	background: var(--surface);
	border-radius: var(--radius);
	overflow: hidden;
	box-shadow: var(--shadow-card);
	font-size: 0.875rem;
}

.summary-table thead {
	background: #fafaf8;
}

.summary-table th {
	padding: 0.65rem 1rem;
	text-align: left;
	font-weight: 600;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--text-secondary);
	border-bottom: 1px solid var(--border);
}

.summary-table td {
	padding: 0.65rem 1rem;
	border-bottom: 1px solid var(--border-light);
}

.summary-table tbody tr:last-child td {
	border-bottom: none;
}

.cell-name {
	font-weight: 600;
}

.cell-mono {
	font-family: var(--font-mono);
	font-size: 0.8rem;
}

.cell-errors {
	font-family: var(--font-mono);
	font-size: 0.8rem;
}

.error-count {
	background: var(--error-bg);
	color: var(--error-text);
	padding: 0.1rem 0.45rem;
	border-radius: 3px;
	font-weight: 600;
}

.song-section {
	margin-bottom: 3rem;
}

.song-header {
	position: sticky;
	top: 0;
	z-index: 10;
	background: var(--bg);
	padding: 0.75rem 0;
	margin-bottom: 1rem;
	border-bottom: 2px solid var(--border);
}

.song-header h2 {
	font-size: 1.15rem;
	font-weight: 700;
	letter-spacing: -0.01em;
}

.song-album {
	display: inline-block;
	margin-top: 0.15rem;
	font-size: 0.8rem;
	color: var(--text-tertiary);
	font-style: italic;
}

.variants-grid {
	display: grid;
	gap: 1rem;
}

.card {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	box-shadow: var(--shadow-card);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.card-header {
	padding: 0.6rem 1rem;
	font-weight: 700;
	font-size: 0.8rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	background: #fafaf8;
	border-bottom: 1px solid var(--border-light);
	color: var(--text-secondary);
}

.card-body {
	padding: 1rem;
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.85rem;
}

.card-footer {
	padding: 0.5rem 1rem;
	border-top: 1px solid var(--border-light);
	background: #fafaf8;
	display: flex;
	justify-content: space-between;
	align-items: center;
	font-family: var(--font-mono);
	font-size: 0.7rem;
	color: var(--text-tertiary);
}

.tokens {
	display: flex;
	align-items: center;
	gap: 0.2rem;
}

.token-detail {
	background: var(--bg);
	padding: 0.05rem 0.35rem;
	border-radius: 3px;
}

.token-sep {
	color: var(--border);
}

.timing {
	font-weight: 600;
	color: var(--text-secondary);
}

.field-headline {
	font-size: 1.05rem;
	font-weight: 600;
	line-height: 1.45;
	color: var(--text);
}

.mood-pill {
	display: inline-block;
	padding: 0.2rem 0.7rem;
	border-radius: 100px;
	font-size: 0.8rem;
	font-weight: 600;
	letter-spacing: 0.01em;
	background: hsl(var(--pill-hue), 45%, 93%);
	color: hsl(var(--pill-hue), 50%, 32%);
	border: 1px solid hsl(var(--pill-hue), 35%, 85%);
	align-self: flex-start;
}

.field-mood-desc {
	font-style: italic;
	color: var(--text-secondary);
	line-height: 1.55;
}

.field-section h4 {
	font-size: 0.7rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--text-tertiary);
	margin-bottom: 0.4rem;
}

.field-section p {
	line-height: 1.6;
	font-size: 0.9rem;
}

.field-section ul {
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.field-section ul li {
	font-size: 0.875rem;
	line-height: 1.5;
	padding-left: 0.85rem;
	position: relative;
}

.field-section ul li::before {
	content: "";
	position: absolute;
	left: 0;
	top: 0.55em;
	width: 5px;
	height: 5px;
	border-radius: 50%;
	background: var(--border);
}

.journey-list {
	list-style: none;
	counter-reset: journey;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.journey-list li {
	counter-increment: journey;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	font-size: 0.875rem;
	line-height: 1.5;
	padding-left: 1.8rem;
	position: relative;
}

.journey-list li::before {
	content: counter(journey);
	position: absolute;
	left: 0;
	top: 0.15rem;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.3rem;
	height: 1.3rem;
	border-radius: 50%;
	background: var(--bg);
	border: 1px solid var(--border);
	font-size: 0.65rem;
	font-weight: 700;
	color: var(--text-tertiary);
}

.journey-header {
	display: flex;
	align-items: center;
	gap: 0.4rem;
}

.journey-section {
	font-weight: 600;
	font-size: 0.8rem;
	color: var(--text);
}

.journey-mood {
	font-size: 0.7rem;
	font-weight: 600;
	padding: 0.1rem 0.5rem;
	border-radius: 100px;
	background: var(--bg);
	border: 1px solid var(--border);
	color: var(--text-secondary);
	white-space: nowrap;
}

.journey-desc {
	color: var(--text-secondary);
	font-size: 0.85rem;
	margin: 0;
}

.key-line {
	margin-bottom: 0.5rem;
}

.key-line:last-child {
	margin-bottom: 0;
}

.key-line blockquote {
	border-left: 3px solid var(--border);
	padding: 0.3rem 0.75rem;
	font-style: italic;
	font-size: 0.9rem;
	color: var(--text);
	line-height: 1.5;
	margin-bottom: 0.25rem;
}

.key-line-insight {
	font-size: 0.8rem;
	color: var(--text-secondary);
	padding-left: 0.95rem;
	line-height: 1.5;
}

.card--error .card-header {
	background: var(--error-bg);
	color: var(--error-text);
	border-bottom-color: var(--error-border);
}

.error-banner {
	padding: 1rem;
	background: var(--error-bg);
	color: var(--error-text);
	font-size: 0.875rem;
	line-height: 1.5;
	border-bottom: 1px solid var(--error-border);
	flex: 1;
}

.card--error .card-footer {
	background: var(--error-bg);
	border-top-color: var(--error-border);
}

.card--empty .empty-notice,
.card--missing .empty-notice {
	padding: 2rem 1rem;
	text-align: center;
	color: var(--text-tertiary);
	font-size: 0.85rem;
	font-style: italic;
	flex: 1;
}

.song-tabs {
	display: flex;
	gap: 0.4rem;
	padding: 0.5rem 0;
	margin-bottom: 2rem;
	overflow-x: auto;
	-webkit-overflow-scrolling: touch;
}

.song-tab {
	flex-shrink: 0;
	padding: 0.4rem 0.85rem;
	border: 1px solid var(--border);
	border-radius: 100px;
	background: transparent;
	font-family: var(--font-body);
	font-size: 0.8rem;
	font-weight: 500;
	color: var(--text-secondary);
	cursor: pointer;
	white-space: nowrap;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.song-tab:hover {
	background: var(--bg);
	color: var(--text);
}

.song-tab--active {
	background: var(--surface);
	color: var(--text);
	border-color: var(--accent);
	font-weight: 600;
	box-shadow: var(--shadow-card);
}
</style>
</head>
<body>

<header class="report-header">
	<h1>Prompt Lab Report</h1>
	<div class="report-meta">
		<span>Generated ${timestamp} UTC</span>
		<span>${variantIds.length} variant${variantIds.length !== 1 ? "s" : ""}</span>
		<span>${songs.length} song${songs.length !== 1 ? "s" : ""}</span>
		<span>${results.length} total run${results.length !== 1 ? "s" : ""}</span>
	</div>
</header>

<section class="summary-section">
	<h3>Summary</h3>
	${summaryTable}
</section>

<nav class="song-tabs">
	${tabBar}
</nav>

${songSections}

<script>
(function () {
	var tabs = document.querySelectorAll(".song-tab");
	var sections = document.querySelectorAll(".song-section");

	tabs.forEach(function (tab) {
		tab.addEventListener("click", function () {
			var index = tab.getAttribute("data-song-index");

			tabs.forEach(function (t) { t.classList.remove("song-tab--active"); });
			tab.classList.add("song-tab--active");

			sections.forEach(function (s) { s.style.display = "none"; });
			var target = document.getElementById("song-" + index);
			if (target) target.style.display = "block";
		});
	});
})();
</script>

</body>
</html>`;
}
