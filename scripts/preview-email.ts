/**
 * Dev server for email template preview + heart ripple capture.
 *
 * Usage: bun --hot scripts/preview-email.ts
 *
 * Routes:
 *   /         → Email preview with responsive width toggles
 *   /capture  → Heart ripple capture tool (exact prod shader + palette)
 *   /raw      → Raw email HTML
 */

import { resolve, dirname } from "node:path";

const ROOT = resolve(
	import.meta.dirname ?? dirname(new URL(import.meta.url).pathname),
	"..",
);
const EMAIL_FILE = resolve(ROOT, "src/lib/email/waitlist-confirmation.ts");


async function getEmailHtml(): Promise<string> {
	const file = await Bun.file(EMAIL_FILE).text();
	const match = file.match(
		/function waitlistHtml\(\)\s*\{[\s\S]*?return `([\s\S]*?)`;[\s\S]*?\}/,
	);
	if (!match) return "<p>Could not extract HTML from waitlist-confirmation.ts</p>";
	return match[1];
}

// Exact palette generation from src/lib/utils/palette.ts
function generatePalette(hue: number) {
	const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
		const hNorm = h / 360;
		const c = (1 - Math.abs(2 * l - 1)) * s;
		const x = c * (1 - Math.abs(((hNorm * 6) % 2) - 1));
		const m = l - c / 2;
		let r = 0, g = 0, b = 0;
		if (hNorm < 1 / 6) { r = c; g = x; }
		else if (hNorm < 2 / 6) { r = x; g = c; }
		else if (hNorm < 3 / 6) { g = c; b = x; }
		else if (hNorm < 4 / 6) { g = x; b = c; }
		else if (hNorm < 5 / 6) { r = x; b = c; }
		else { r = c; b = x; }
		return [r + m, g + m, b + m];
	};
	return {
		primary: hslToRgb(hue, 0.3, 0.5),
		secondary: hslToRgb((hue + 25) % 360, 0.25, 0.55),
		background: hslToRgb(hue, 0.22, 0.14),
	};
}

const PORT = 4321;

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		// ── Raw email HTML ──
		if (url.pathname === "/raw") {
			return new Response(await getEmailHtml(), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		// ── Waitlist success state preview ──
		if (url.pathname === "/waitlist") {
			return new Response(waitlistPreviewPage(), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		// ── Heart ripple capture page ──
		if (url.pathname === "/capture") {
			const palette = generatePalette(340); // rose theme (default)

			return new Response(
				capturePage(palette),
				{ headers: { "Content-Type": "text/html; charset=utf-8" } },
			);
		}

		// ── Email preview (default) ──
		return new Response(emailPreviewPage(), {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	},
});

console.log(`Email preview:         http://localhost:${PORT}`);
console.log(`Waitlist copy preview: http://localhost:${PORT}/waitlist`);
console.log(`Heart ripple capture:  http://localhost:${PORT}/capture`);

// ─── Page templates ─────────────────────────────────────────────────────────

function emailPreviewPage() {
	return `<!DOCTYPE html>
<html>
<head>
  <title>Email Preview — hearted.</title>
  <style>
    * { margin: 0; box-sizing: border-box; }
    body { background: #1a1a1a; display: flex; flex-direction: column; align-items: center; padding: 24px; font-family: system-ui; }
    h1 { color: #888; font-size: 13px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
    nav { display: flex; gap: 8px; margin-bottom: 12px; }
    nav a { color: #888; font-size: 12px; text-decoration: none; padding: 4px 12px; border: 1px solid #333; border-radius: 4px; }
    nav a:hover { background: #2a2a2a; color: #ccc; }
    .controls { display: flex; gap: 8px; margin-bottom: 20px; }
    .controls button {
      padding: 6px 16px; border: 1px solid #444; background: #2a2a2a; color: #ccc;
      border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.15s;
    }
    .controls button:hover { background: #3a3a3a; }
    .controls button.active { background: #555; border-color: #777; color: #fff; }
    iframe { border: none; background: #fff; transition: width 0.3s ease; border-radius: 4px; }
  </style>
</head>
<body>
  <nav><a href="/">Email</a> <a href="/waitlist">Waitlist</a> <a href="/capture">Capture</a></nav>
  <h1>Email Preview</h1>
  <div class="controls">
    <button onclick="setWidth(360)" data-w="360">Mobile (360)</button>
    <button onclick="setWidth(520)" data-w="520" class="active">Email (520)</button>
    <button onclick="setWidth(800)" data-w="800">Desktop (800)</button>
  </div>
  <iframe id="preview" src="/raw" width="520" height="700"></iframe>
  <script>
    function setWidth(w) {
      document.getElementById('preview').width = w;
      document.querySelectorAll('.controls button').forEach(b => {
        b.classList.toggle('active', Number(b.dataset.w) === w);
      });
    }
    setInterval(() => {
      document.getElementById('preview').src = '/raw?t=' + Date.now();
    }, 1000);
  </script>
</body>
</html>`;
}

function capturePage(
	palette: { primary: number[]; secondary: number[]; background: number[] },
) {
	// Self-contained shader — same heart SDF as production, with bgOff/minSize built in
	const captureFs = `precision highp float;
uniform vec2 uResolution;
uniform vec3 uColorPrimary;
uniform vec3 uColorSecondary;
uniform vec3 uColorBackground;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform vec2 uMouseHistory[5];
uniform float uMouseHistoryStrength[5];
uniform float uMinSize;
uniform float uBgOff;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
float dot2(vec2 v) { return dot(v,v); }
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0)/4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5*max(p.x+p.y, 0.0)))) * sign(p.x - p.y);
}
float getHeartDist(vec2 uv, vec2 center, float size) {
  vec2 p = uv - center;
  p *= 1.5 / size;
  p.y -= 0.5;
  return sdHeart(p) * size / 1.5;
}

void main() {
  vec2 uv = vUv;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 uvAspect = uv * aspect;

  // Background
  vec3 color;
  if (uBgOff > 0.5) {
    color = vec3(0.0); // will be transparent
  } else {
    float beat = 1.0 + 0.15 * sin(uTime * 8.0);
    float slowTime = uTime * 0.15;
    vec2 shift1 = vec2(fbm(uv*0.5 + slowTime), fbm(uv*0.4 - slowTime));
    float gradientBase = uv.x*0.3 + uv.y*0.7 + fbm(uv + shift1)*0.2;
    float sw1 = sin(uv.x*2.0 + uTime*0.2 + shift1.x*3.0)*0.5+0.5;
    float sw2 = sin(uv.y*1.5 - uTime*0.1 + shift1.y*2.0)*0.5+0.5;
    float bgWaves = mix(sw1, sw2, 0.5)*0.25;
    color = mix(uColorBackground, uColorPrimary, gradientBase*0.3 + bgWaves);
    float band = smoothstep(0.2, 0.8, uv.x+uv.y-0.5 + sin(uTime*0.1)*0.2 + shift1.y*0.1);
    color = mix(color, mix(uColorBackground, uColorSecondary, 0.4), band*0.25);
  }

  // Trail hearts
  float totalRipple = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 hp = uMouseHistory[i] * aspect;
    float str = uMouseHistoryStrength[i];
    float age = float(i) * 0.15 + 0.2;
    float baseSize = age * 0.6;
    float size = mix(baseSize, max(baseSize, 0.45), uMinSize);
    if (str > 0.01) {
      float dist = getHeartDist(uvAspect, hp, size);
      float width = 0.01 + age * 0.03;
      float ring = 1.0 - smoothstep(0.0, width, abs(dist));
      float fade = exp(-age * 1.8) * str;
      totalRipple += ring * fade;
    }
  }

  // Cursor heart (same sizing system)
  vec2 cm = uMouse * aspect;
  float cursorSize = mix(0.06, 0.45, uMinSize);
  float cd = getHeartDist(uvAspect, cm, cursorSize);
  float cursorOutline = (1.0 - smoothstep(0.0, 0.02, abs(cd))) * uMouseStrength;
  float cursorGlow = (1.0 - smoothstep(0.0, 0.3, abs(cd))) * uMouseStrength * 0.4;

  float allRipples = totalRipple * 1.5;
  color = mix(color, uColorPrimary, allRipples * 0.6);
  color = mix(color, uColorSecondary, cursorOutline * 1.0 + cursorGlow * 0.3);

  if (uBgOff > 0.5) {
    // Transparent output — alpha from heart signal
    float heartAlpha = clamp(allRipples + cursorOutline + cursorGlow, 0.0, 1.0);
    gl_FragColor = vec4(color, heartAlpha);
  } else {
    // Full background with grain/vignette
    color += (hash(uv*500.0+uTime) - 0.5) * 0.04;
    color += (fract(sin(dot(uv, vec2(12.9898,78.233)))*43758.5453) - 0.5) * 0.015;
    float vig = smoothstep(0.0, 1.0, 1.0 - length(uv-0.5)*0.6);
    color *= 0.85 + vig*0.15;
    color = clamp(color, uColorBackground*0.7, vec3(0.8));
    gl_FragColor = vec4(color, 1.0);
  }
}`;

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Heart Ripple Capture — hearted.</title>
<style>
  * { margin: 0; box-sizing: border-box; }
  body { background: #111; display: flex; flex-direction: column; align-items: center; font-family: system-ui; color: #ccc; }
  nav { display: flex; gap: 8px; padding: 12px; }
  nav a { color: #888; font-size: 12px; text-decoration: none; padding: 4px 12px; border: 1px solid #333; border-radius: 4px; }
  nav a:hover { background: #2a2a2a; color: #ccc; }
  .controls { padding: 12px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .controls label { font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .controls input[type=range] { width: 100px; }
  .controls span { min-width: 28px; text-align: right; font-variant-numeric: tabular-nums; }
  .controls button {
    padding: 8px 20px; border: 1px solid #555; background: #2a2a2a; color: #fff;
    border-radius: 4px; cursor: pointer; font-size: 13px;
  }
  .controls button:hover { background: #444; }
  canvas { display: block; margin: 8px; border-radius: 4px;
    background-image: linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%);
    background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-color: #222;
  }
  .info { font-size: 11px; color: #555; padding: 8px; }
</style>
</head>
<body>

<nav><a href="/">Email</a> <a href="/waitlist">Waitlist</a> <a href="/capture">Capture</a></nav>

<div class="controls">
  <label>Hearts <input type="range" id="countSlider" min="2" max="8" value="8" oninput="render()"><span id="countVal">8</span></label>
  <label>Trail spread <input type="range" id="spreadSlider" min="10" max="80" value="10" oninput="render()"><span id="spreadVal">10</span></label>
  <label>Curve <input type="range" id="curveSlider" min="-50" max="50" value="4" oninput="render()"><span id="curveVal">4</span></label>
  <label>Time <input type="range" id="timeSlider" min="0" max="100" value="12" oninput="render()"><span id="timeVal">12</span></label>
  <label>Mouse X <input type="range" id="mxSlider" min="0" max="100" value="9" oninput="render()"><span id="mxVal">9</span></label>
  <label>Mouse Y <input type="range" id="mySlider" min="0" max="100" value="46" oninput="render()"><span id="myVal">46</span></label>
  <label>Strength <input type="range" id="strSlider" min="0" max="100" value="100" oninput="render()"><span id="strVal">100</span></label>
  <label>Min size <input type="range" id="minSizeSlider" min="0" max="100" value="40" oninput="render()"><span id="minSizeVal">40</span></label>
  <label><input type="checkbox" id="bgOffCheck" onchange="render()"> Hearts only</label>
  <button onclick="download()">Download PNG</button>
</div>

<canvas id="c" width="1040" height="400"></canvas>
<div class="info">1040×400 (2x retina for 520px email). Same heart SDF + palette as production (rose/hue 340).</div>

<script>
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: true, antialias: false, premultipliedAlpha: false });

const vsSource = 'attribute vec2 aPosition; varying vec2 vUv; void main() { vUv = aPosition*0.5+0.5; gl_Position = vec4(aPosition,0,1); }';
const fsSource = ${JSON.stringify(captureFs)};

function compileShader(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

const vs = compileShader(gl.VERTEX_SHADER, vsSource);
const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
const prog = gl.createProgram();
gl.attachShader(prog, vs);
gl.attachShader(prog, fs);
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  console.error('Link error:', gl.getProgramInfoLog(prog));
}
gl.useProgram(prog);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
const pos = gl.getAttribLocation(prog, 'aPosition');
gl.enableVertexAttribArray(pos);
gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

const u = {};
['uTime','uResolution','uColorPrimary','uColorSecondary','uColorBackground',
 'uMouse','uMouseStrength','uMinSize','uBgOff','uMouseHistory[0]','uMouseHistoryStrength[0]'].forEach(name => {
  u[name] = gl.getUniformLocation(prog, name);
});

const palette = {
  primary: [${palette.primary.join(",")}],
  secondary: [${palette.secondary.join(",")}],
  background: [${palette.background.join(",")}],
};

gl.uniform3fv(u.uColorPrimary, palette.primary);
gl.uniform3fv(u.uColorSecondary, palette.secondary);
gl.uniform3fv(u.uColorBackground, palette.background);
gl.clearColor(0, 0, 0, 0);

function val(id) {
  const el = document.getElementById(id);
  const v = parseInt(el.value);
  const span = document.getElementById(id.replace('Slider', 'Val'));
  if (span) span.textContent = v;
  return v;
}

function render() {
  const count = val('countSlider');
  const spread = val('spreadSlider') / 100;
  const curve = val('curveSlider') / 100;
  const time = val('timeSlider') / 10;
  const mx = val('mxSlider') / 100;
  const my = val('mySlider') / 100;
  const str = val('strSlider') / 100;
  const minSize = val('minSizeSlider') / 100;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(u.uResolution, canvas.width, canvas.height);
  gl.uniform1f(u.uTime, time);
  gl.uniform2f(u.uMouse, mx, my);
  gl.uniform1f(u.uMouseStrength, str);
  gl.uniform1f(u.uMinSize, minSize);
  gl.uniform1f(u.uBgOff, document.getElementById('bgOffCheck').checked ? 1.0 : 0.0);

  const historyFlat = new Float32Array(10);
  const strengthFlat = new Float32Array(5);

  for (let i = 0; i < 5; i++) {
    if (i < count) {
      const t = i / Math.max(count - 1, 1);
      const hx = mx - t * spread;
      const hy = my + t * spread * 0.8 + Math.sin(t * Math.PI) * curve;
      historyFlat[i * 2] = hx;
      historyFlat[i * 2 + 1] = hy;
      const fadeRange = 1.0 - minSize;
      strengthFlat[i] = str * (1.0 - t * fadeRange * 0.6);
    } else {
      historyFlat[i * 2] = mx;
      historyFlat[i * 2 + 1] = my;
      strengthFlat[i] = 0;
    }
  }

  gl.uniform2fv(u['uMouseHistory[0]'], historyFlat);
  gl.uniform1fv(u['uMouseHistoryStrength[0]'], strengthFlat);

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function download() {
  render();
  const link = document.createElement('a');
  link.download = 'heart-ripple-email.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

render();
</script>

</body>
</html>`;
}

function waitlistPreviewPage() {
	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Waitlist Copy — hearted.</title>
  <style>
    * { margin: 0; box-sizing: border-box; }
    body { background: #1a1a1a; font-family: system-ui; color: #ccc; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
    nav { display: flex; gap: 8px; align-self: flex-start; }
    nav a { color: #888; font-size: 12px; text-decoration: none; padding: 4px 12px; border: 1px solid #333; border-radius: 4px; }
    nav a:hover { background: #2a2a2a; color: #ccc; }
    h1 { color: #888; font-size: 13px; font-weight: 400; letter-spacing: 2px; text-transform: uppercase; }
    .label { font-size: 11px; color: #555; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; }

    .contexts { display: flex; gap: 24px; width: 100%; max-width: 1100px; align-items: flex-start; }

    /* ── Context 1: Hero dark ── */
    .ctx-hero {
      flex: 1;
      background: radial-gradient(ellipse at 30% 60%, #3d1f2f 0%, #1a0f1a 60%, #0f0a12 100%);
      border-radius: 12px;
      padding: 56px 48px;
      display: flex;
      flex-direction: column;
      gap: 0;
      min-height: 420px;
      position: relative;
    }
    .ctx-hero .headline {
      font-size: 38px;
      font-weight: 200;
      line-height: 1.15;
      color: #f0d8e8;
      letter-spacing: -0.5px;
      margin-bottom: 32px;
      font-style: normal;
    }
    .ctx-hero .headline em { font-style: italic; }
    .ctx-hero .success {
      font-size: 15px;
      color: rgba(240,216,232,0.7);
      margin-bottom: 28px;
      letter-spacing: 0.2px;
    }
    .ctx-hero .subtext {
      font-size: 14px;
      color: rgba(240,216,232,0.45);
      line-height: 1.7;
      letter-spacing: 0.3px;
    }

    /* ── Context 2: CTA light ── */
    .ctx-cta {
      flex: 1;
      background: #faf9f7;
      border-radius: 12px;
      padding: 56px 48px;
      display: flex;
      flex-direction: column;
      gap: 0;
      min-height: 420px;
    }
    .ctx-cta .eyebrow {
      font-size: 13px;
      color: #aaa;
      margin-bottom: 12px;
      letter-spacing: 0.2px;
    }
    .ctx-cta .headline {
      font-size: 38px;
      font-weight: 300;
      line-height: 1.15;
      color: #1a1a1a;
      letter-spacing: -0.5px;
      margin-bottom: 36px;
    }
    .ctx-cta .headline em { font-style: italic; }
    .ctx-cta .success {
      font-size: 15px;
      color: #555;
      letter-spacing: 0.2px;
    }

    /* ── Editable success text ── */
    .success[contenteditable] {
      outline: none;
      border-bottom: 1px dashed rgba(128,128,128,0.4);
      padding-bottom: 2px;
      cursor: text;
    }
    .edit-hint { font-size: 11px; color: #444; margin-top: 12px; }

    .context-tag {
      position: absolute;
      top: 16px; right: 16px;
      font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
      color: rgba(240,216,232,0.25);
    }
  </style>
</head>
<body>

<nav><a href="/">Email</a> <a href="/waitlist">Waitlist</a> <a href="/capture">Capture</a></nav>
<h1>Waitlist Success State</h1>

<div class="contexts">

  <!-- Context 1: Hero section (dark bg) -->
  <div class="ctx-hero">
    <span class="context-tag">Hero · dark</span>
    <div class="headline">the stories inside <em>your liked songs</em></div>
    <div class="success" contenteditable="true" spellcheck="false">You're in. We'll be in touch.</div>
    <div class="subtext">
      Every ♥ was a feeling.<br>
      What do they all say about you?
    </div>
  </div>

  <!-- Context 2: CTA section (light bg) -->
  <div class="ctx-cta">
    <div class="eyebrow">Your songs have been trying to tell you something.</div>
    <div class="headline">What do they <em>say about you?</em></div>
    <div class="success" contenteditable="true" spellcheck="false">You're in. We'll be in touch.</div>
  </div>

</div>

<div class="edit-hint">Click the success text to edit it live in either context.</div>

</body>
</html>`;
}
