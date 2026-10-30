/**
 * Synthetic list-render benchmark: N copies of one real SongCard row (SSR markup)
 * under the app's real CSS, in headless Chrome with CPU throttling. Compares a
 * plain DOM against `content-visibility: auto` per row / per 50-row page chunk
 * and against a bounded window, to decide whether long lists need virtualisation.
 *
 * Usage: bun scripts/perf/list-render-bench.mjs <dataDir> [cpuThrottle=4]
 *   <dataDir>/row.json   {"row": "<button class=\"song-card …\">…</button>"}
 *                        (outerHTML of one liked-songs row from SSR HTML)
 *   <dataDir>/styles.css the built app stylesheet (/assets/styles-*.css)
 * Keep the data dir out of the repo: the row carries real library content.
 * Static DOM only — measures browser style/layout/scroll cost, not React work.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const dataDir = process.argv[2];
const row = JSON.parse(readFileSync(`${dataDir}/row.json`, "utf8")).row;
const css = readFileSync(`${dataDir}/styles.css`, "utf8");
const throttle = Number(process.argv[3] ?? 4);

const variants = {
	"800 plain": { n: 800, mode: "plain" },
	"5000 plain": { n: 5000, mode: "plain" },
	"5000 cv per-row": { n: 5000, mode: "row" },
	"5000 cv per-50-chunk": { n: 5000, mode: "chunk" },
	"500 window (maxPages)": { n: 500, mode: "plain" },
};

function build({ n, mode }) {
	const extra = `
	.cv-row > .song-card { content-visibility: auto; contain-intrinsic-size: auto 72px; }
	.cv-chunk { content-visibility: auto; contain-intrinsic-size: auto 3700px; }
	.sel .song-card { padding-left: 40px; }`;
	let body = "";
	for (let c = 0; c < n; c += 50) {
		let chunk = "";
		for (let i = c; i < Math.min(n, c + 50); i++) chunk += row.replace("Money Trees", `Song ${i}`);
		body += mode === "chunk" ? `<div class="cv-chunk space-y-0.5">${chunk}</div>` : chunk;
	}
	const listClass = mode === "row" ? "cv-row space-y-0.5" : "space-y-0.5";
	return `<!doctype html><html lang="en"><head><style>${css}${extra}</style></head>
	<body><main class="@container mx-auto max-w-3xl"><div class="px-2 pt-2"><div id="list" class="${listClass}">${body}</div></div></main></body></html>`;
}

const browser = await chromium.launch({ channel: "chrome" });
const results = {};
for (const [name, v] of Object.entries(variants)) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
	await page.route("https://i.scdn.co/**", (r) =>
		r.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }),
	);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Performance.enable");
	await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
	const file = `${dataDir}/v-${name.replace(/\W+/g, "_")}.html`;
	writeFileSync(file, build(v));
	const t0 = Date.now();
	await page.goto(`file://${file}`, { waitUntil: "load" });
	const loadMs = Date.now() - t0;
	await page.waitForTimeout(500);
	const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
	const timings = await page.evaluate(async () => {
		const list = document.getElementById("list");
		const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
		const toggle = [];
		for (let i = 0; i < 5; i++) {
			const s = performance.now();
			document.body.classList.toggle("sel");
			void document.body.offsetHeight;
			toggle.push(performance.now() - s);
		}
		const append = [];
		const tpl = list.querySelector(".song-card").outerHTML;
		for (let i = 0; i < 5; i++) {
			const s = performance.now();
			const holder = list.lastElementChild.classList.contains("cv-chunk") ? document.createElement("div") : null;
			const target = holder ?? list;
			if (holder) { holder.className = "cv-chunk space-y-0.5"; list.appendChild(holder); }
			target.insertAdjacentHTML("beforeend", tpl.repeat(50));
			void document.body.offsetHeight;
			append.push(performance.now() - s);
		}
		// scroll top→bottom in 60 steps, one per frame; record worst frame
		const frames = [];
		const startY = (document.documentElement.scrollHeight - innerHeight) / 2;
		window.scrollTo(0, startY);
		await new Promise((r) => requestAnimationFrame(() => r()));
		let last = performance.now();
		for (let i = 1; i <= 120; i++) {
			window.scrollTo(0, startY + i * 120);
			await new Promise((r) => requestAnimationFrame(() => r()));
			const now = performance.now();
			frames.push(now - last);
			last = now;
		}
		return { toggleMed: med(toggle), appendMed: med(append), scrollWorstFrame: Math.max(...frames), scrollMedFrame: med(frames) };
	});
	results[name] = {
		nodes: m.Nodes,
		heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1),
		loadMs,
		initialLayoutMs: +(m.LayoutDuration * 1000).toFixed(0),
		initialStyleMs: +(m.RecalcStyleDuration * 1000).toFixed(0),
		...Object.fromEntries(Object.entries(timings).map(([k, x]) => [k, +x.toFixed(1)])),
	};
	await page.close();
}
await browser.close();
console.log(`CPU throttle ${throttle}x`);
console.table(results);
