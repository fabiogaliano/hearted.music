import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
} from "react";

import type { ThemeConfig } from "@/lib/theme/types";
import { getThemeHue } from "@/lib/theme/colors";
import { type ColorPalette, generatePalette } from "@/lib/utils/palette";

interface HeartRippleBackgroundProps {
	theme?: ThemeConfig;
	className?: string;
	style?: React.CSSProperties;
	onReady?: () => void;
}

export interface HeartRippleHandle {
	setPointer: (payload: { x: number; y: number; strength?: number }) => void;
}

const vertexShaderSource = `
	attribute vec2 aPosition;
	varying vec2 vUv;
	void main() {
		vUv = aPosition * 0.5 + 0.5;
		gl_Position = vec4(aPosition, 0.0, 1.0);
	}
`;

const fragmentShaderSource = `
	precision highp float;

	uniform float uTime;
	uniform vec2 uResolution;
	uniform vec3 uColorPrimary;
	uniform vec3 uColorSecondary;
	uniform vec3 uColorBackground;
	uniform vec2 uMouse;
	uniform float uMouseStrength;

	uniform vec2 uMouseHistory[5];
	uniform float uMouseHistoryStrength[5];

	varying vec2 vUv;

	#define PI 3.14159265359

	float hash(vec2 p) {
		return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
	}

	float noise(vec2 p) {
		vec2 i = floor(p);
		vec2 f = fract(p);
		f = f * f * (3.0 - 2.0 * f);

		float a = hash(i);
		float b = hash(i + vec2(1.0, 0.0));
		float c = hash(i + vec2(0.0, 1.0));
		float d = hash(i + vec2(1.0, 1.0));

		return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	}

	float fbm(vec2 p) {
		float value = 0.0;
		float amplitude = 0.5;
		float frequency = 1.0;

		for (int i = 0; i < 4; i++) {
			value += amplitude * noise(p * frequency);
			frequency *= 2.0;
			amplitude *= 0.5;
		}
		return value;
	}

	float dot2(in vec2 v) { return dot(v,v); }

	float sdHeart(in vec2 p) {
		p.x = abs(p.x);
		if (p.y + p.x > 1.0)
			return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
		return sqrt(min(dot2(p - vec2(0.00, 1.00)),
						dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
	}

	float getHeartDist(vec2 uv, vec2 center, float size) {
		vec2 p = uv - center;
		p *= 1.5 / size;
		p.y -= 0.5;
		return sdHeart(p) * size / 1.5;
	}

	float ripple(vec2 uv, vec2 center, float time, float strength, float age, float beat) {
		float size = (age * 0.6) * (0.9 + 0.1 * beat);
		if (size < 0.05) size = 0.05;

		float dist = getHeartDist(uv, center, size);

		float width = 0.01 + age * 0.03;
		float ring = 1.0 - smoothstep(0.0, width, abs(dist));

		float fade = exp(-age * 1.8) * strength;

		return ring * fade;
	}

	void main() {
		vec2 uv = vUv;
		vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
		vec2 uvAspect = uv * aspect;

		float beat = 1.0 + 0.15 * sin(uTime * 8.0);

		float slowTime = uTime * 0.15;
		vec2 shift1 = vec2(fbm(uv * 0.5 + slowTime), fbm(uv * 0.4 - slowTime));
		vec2 shift2 = vec2(fbm(uv * 0.8 + slowTime * 0.5), fbm(uv * 0.7 + slowTime * 0.3));

		float gradientBase = uv.x * 0.3 + uv.y * 0.7 + fbm(uv + shift1) * 0.2;

		float slowWave1 = sin(uv.x * 2.0 + uTime * 0.2 + shift1.x * 3.0) * 0.5 + 0.5;
		float slowWave2 = sin(uv.y * 1.5 - uTime * 0.1 + shift2.y * 2.0) * 0.5 + 0.5;
		float backgroundWaves = mix(slowWave1, slowWave2, 0.5) * 0.25;

		vec3 color = mix(uColorBackground, uColorPrimary, gradientBase * 0.3 + backgroundWaves);

		float diagonalBand = smoothstep(0.2, 0.8, uv.x + uv.y - 0.5 + sin(uTime * 0.1) * 0.2 + shift1.y * 0.1);
		color = mix(color, mix(uColorBackground, uColorSecondary, 0.4), diagonalBand * 0.25);

		float totalRipple = 0.0;
		for (int i = 0; i < 5; i++) {
			vec2 mousePos = uMouseHistory[i] * aspect;
			float strength = uMouseHistoryStrength[i];
			float age = float(i) * 0.15 + 0.2;

			if (strength > 0.01) {
				totalRipple += ripple(uvAspect, mousePos, uTime, strength, age, beat);
			}
		}

		vec2 currentMouse = uMouse * aspect;
		float cursorSize = 0.06;
		float currentHeartDist = getHeartDist(uvAspect, currentMouse, cursorSize);

		float cursorOutline = 1.0 - smoothstep(0.0, 0.02, abs(currentHeartDist));
		cursorOutline *= uMouseStrength;

		float cursorGlow = (1.0 - smoothstep(0.0, 0.3, abs(currentHeartDist))) * uMouseStrength * 0.4;

		float allRipples = totalRipple * 1.5;

		color = mix(color, uColorPrimary, allRipples * 0.6);
		color = mix(color, uColorSecondary, cursorOutline * 1.0 + cursorGlow * 0.3);

		float noiseVal = hash(uv * 500.0 + uTime);
		float grain = (noiseVal - 0.5) * 0.04;

		float dither = fract(sin(dot(uv.xy, vec2(12.9898, 78.233))) * 43758.5453);
		color += (dither - 0.5) * 0.015;
		color += grain;

		float vignette = 1.0 - length(uv - 0.5) * 0.6;
		vignette = smoothstep(0.0, 1.0, vignette);
		color *= 0.85 + vignette * 0.15;

		color = clamp(color, uColorBackground * 0.7, vec3(0.8));

		gl_FragColor = vec4(color, 1.0);
	}
`;

function compileShader(
	gl: WebGLRenderingContext,
	type: number,
	source: string,
) {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("Failed to create shader");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const err = gl.getShaderInfoLog(shader) || "Unknown shader compile error";
		gl.deleteShader(shader);
		throw new Error(err);
	}
	return shader;
}

function createProgram(
	gl: WebGLRenderingContext,
	vsSource: string,
	fsSource: string,
) {
	const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
	const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

	const program = gl.createProgram();
	if (!program) throw new Error("Failed to create program");
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);

	gl.deleteShader(vs);
	gl.deleteShader(fs);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const err = gl.getProgramInfoLog(program) || "Unknown program link error";
		gl.deleteProgram(program);
		throw new Error(err);
	}

	return program;
}

export const HeartRippleBackground = forwardRef<
	HeartRippleHandle,
	HeartRippleBackgroundProps
>(function HeartRippleBackground({ theme, className, style, onReady }, ref) {
	const containerRef = useRef<HTMLDivElement>(null);
	const timeRef = useRef(0);
	const rafRef = useRef<number | null>(null);
	const renderOnceRef = useRef<(() => void) | null>(null);
	const onReadyRef = useRef(onReady);
	onReadyRef.current = onReady;
	const updateMouseRef = useRef<
		((x: number, y: number, strength?: number) => void) | null
	>(null);

	useImperativeHandle(
		ref,
		() => ({
			setPointer: ({ x, y, strength }) => {
				const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
				updateMouseRef.current?.(clamp01(x), clamp01(y), strength);
			},
		}),
		[],
	);

	const glStateRef = useRef<{
		gl: WebGLRenderingContext;
		program: WebGLProgram;
		uColorPrimary: WebGLUniformLocation | null;
		uColorSecondary: WebGLUniformLocation | null;
		uColorBackground: WebGLUniformLocation | null;
	} | null>(null);

	const hue = theme ? getThemeHue(theme) : 218;
	const palette = useMemo(() => generatePalette(hue), [hue]);
	const initialPaletteRef = useRef(palette);

	const mouseRef = useRef({
		x: 0.5,
		y: 0.5,
		strength: 0,
		history: [
			{ x: 0.5, y: 0.5 },
			{ x: 0.5, y: 0.5 },
			{ x: 0.5, y: 0.5 },
			{ x: 0.5, y: 0.5 },
			{ x: 0.5, y: 0.5 },
		],
		historyStrength: [0, 0, 0, 0, 0] as number[],
		lastUpdateTime: 0,
	});

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const reducedMotionQuery = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		);
		const maxPixelRatio = 1;
		const targetFrameMs = 1000 / 30;

		const canvas = document.createElement("canvas");
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		canvas.style.display = "block";
		container.appendChild(canvas);

		const gl = canvas.getContext("webgl", {
			alpha: false,
			antialias: false,
			powerPreference: "low-power",
			depth: false,
			stencil: false,
		});
		if (!gl) {
			if (container.contains(canvas)) container.removeChild(canvas);
			return;
		}

		let program: WebGLProgram;
		try {
			program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
		} catch {
			if (container.contains(canvas)) container.removeChild(canvas);
			return;
		}
		gl.useProgram(program);

		const positionLocation = gl.getAttribLocation(program, "aPosition");
		const buffer = gl.createBuffer();
		if (!buffer) {
			gl.useProgram(null);
			gl.deleteProgram(program);
			if (container.contains(canvas)) container.removeChild(canvas);
			return;
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
			gl.STATIC_DRAW,
		);
		gl.enableVertexAttribArray(positionLocation);
		gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

		const uTime = gl.getUniformLocation(program, "uTime");
		const uResolution = gl.getUniformLocation(program, "uResolution");
		const uColorPrimary = gl.getUniformLocation(program, "uColorPrimary");
		const uColorSecondary = gl.getUniformLocation(program, "uColorSecondary");
		const uColorBackground = gl.getUniformLocation(program, "uColorBackground");
		const uMouse = gl.getUniformLocation(program, "uMouse");
		const uMouseStrength = gl.getUniformLocation(program, "uMouseStrength");
		const uMouseHistory0 = gl.getUniformLocation(program, "uMouseHistory[0]");
		const uMouseHistoryStrength0 = gl.getUniformLocation(
			program,
			"uMouseHistoryStrength[0]",
		);

		const mouseHistoryFlat = new Float32Array(10);
		const mouseHistoryStrengthFlat = new Float32Array(5);

		const applyColors = (p: ColorPalette) => {
			if (uColorPrimary)
				gl.uniform3f(uColorPrimary, p.primary[0], p.primary[1], p.primary[2]);
			if (uColorSecondary)
				gl.uniform3f(
					uColorSecondary,
					p.secondary[0],
					p.secondary[1],
					p.secondary[2],
				);
			if (uColorBackground)
				gl.uniform3f(
					uColorBackground,
					p.background[0],
					p.background[1],
					p.background[2],
				);
			gl.clearColor(p.background[0], p.background[1], p.background[2], 1);
		};

		applyColors(initialPaletteRef.current);
		glStateRef.current = {
			gl,
			program,
			uColorPrimary,
			uColorSecondary,
			uColorBackground,
		};

		const resizeBuffer = () => {
			const dpr = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
			const width = window.innerWidth;
			const height = window.innerHeight;

			const newWidth = Math.max(1, Math.floor(width * dpr));
			const newHeight = Math.max(1, Math.floor(height * dpr));

			if (canvas.width !== newWidth || canvas.height !== newHeight) {
				canvas.width = newWidth;
				canvas.height = newHeight;
				gl.viewport(0, 0, newWidth, newHeight);
			}
		};

		const updateResolution = () => {
			const width = container.clientWidth;
			const height = container.clientHeight;
			if (uResolution) gl.uniform2f(uResolution, width, height);
		};

		resizeBuffer();
		updateResolution();

		let lastFrameTime = 0;
		let lastClockTime = performance.now();

		const renderFrame = () => {
			updateResolution();

			const now = performance.now();
			const delta = Math.min((now - lastClockTime) / 1000, 0.1);
			lastClockTime = now;
			timeRef.current += delta;

			mouseRef.current.strength *= 0.96;
			for (let i = 0; i < 5; i++) {
				mouseRef.current.historyStrength[i] *= 0.985;
			}

			if (uTime) gl.uniform1f(uTime, timeRef.current);
			if (uMouse) gl.uniform2f(uMouse, mouseRef.current.x, mouseRef.current.y);
			if (uMouseStrength)
				gl.uniform1f(uMouseStrength, mouseRef.current.strength);

			for (let i = 0; i < 5; i++) {
				mouseHistoryFlat[i * 2] = mouseRef.current.history[i].x;
				mouseHistoryFlat[i * 2 + 1] = mouseRef.current.history[i].y;
				mouseHistoryStrengthFlat[i] = mouseRef.current.historyStrength[i];
			}
			if (uMouseHistory0) gl.uniform2fv(uMouseHistory0, mouseHistoryFlat);
			if (uMouseHistoryStrength0)
				gl.uniform1fv(uMouseHistoryStrength0, mouseHistoryStrengthFlat);

			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.drawArrays(gl.TRIANGLES, 0, 6);
		};
		renderOnceRef.current = renderFrame;

		const stop = () => {
			if (rafRef.current != null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};

		const animate = (t: number) => {
			if (document.hidden || reducedMotionQuery.matches) {
				rafRef.current = null;
				return;
			}
			rafRef.current = requestAnimationFrame(animate);
			if (t - lastFrameTime < targetFrameMs) return;
			lastFrameTime = t;
			renderFrame();
		};

		const start = () => {
			if (rafRef.current != null) return;
			lastFrameTime = performance.now();
			lastClockTime = performance.now();
			rafRef.current = requestAnimationFrame(animate);
		};

		const updateMouse = (x: number, y: number, strength?: number) => {
			const now = Date.now();
			if (now - mouseRef.current.lastUpdateTime > 100) {
				for (let i = 4; i > 0; i--) {
					mouseRef.current.history[i] = { ...mouseRef.current.history[i - 1] };
					mouseRef.current.historyStrength[i] =
						mouseRef.current.historyStrength[i - 1] * 0.8;
				}
				mouseRef.current.history[0] = {
					x: mouseRef.current.x,
					y: mouseRef.current.y,
				};
				mouseRef.current.historyStrength[0] = mouseRef.current.strength;
				mouseRef.current.lastUpdateTime = now;
			}
			mouseRef.current.x = x;
			mouseRef.current.y = y;
			mouseRef.current.strength =
				strength !== undefined
					? strength
					: Math.min(mouseRef.current.strength + 0.25, 1);
		};

		updateMouseRef.current = updateMouse;

		const handleVisibilityChange = () => {
			if (document.hidden) {
				stop();
				return;
			}
			if (reducedMotionQuery.matches) {
				renderFrame();
				return;
			}
			start();
		};

		const handleReducedMotionChange = () => {
			if (reducedMotionQuery.matches) {
				stop();
				renderFrame();
				return;
			}
			if (!document.hidden) {
				start();
			}
		};

		const handleResize = () => {
			resizeBuffer();
			if (reducedMotionQuery.matches) {
				renderFrame();
			}
		};
		window.addEventListener("resize", handleResize);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		if (typeof reducedMotionQuery.addEventListener === "function") {
			reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
		} else {
			reducedMotionQuery.addListener(handleReducedMotionChange);
		}

		if (reducedMotionQuery.matches) {
			renderFrame();
		} else {
			start();
		}

		if (onReadyRef.current) {
			onReadyRef.current();
		}

		return () => {
			stop();
			renderOnceRef.current = null;
			glStateRef.current = null;
			updateMouseRef.current = null;

			window.removeEventListener("resize", handleResize);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			if (typeof reducedMotionQuery.removeEventListener === "function") {
				reducedMotionQuery.removeEventListener(
					"change",
					handleReducedMotionChange,
				);
			} else {
				reducedMotionQuery.removeListener(handleReducedMotionChange);
			}

			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			gl.deleteBuffer(buffer);
			gl.useProgram(null);
			gl.deleteProgram(program);

			if (container.contains(canvas)) {
				container.removeChild(canvas);
			}
		};
	}, []);

	useEffect(() => {
		const state = glStateRef.current;
		if (!state) return;
		state.gl.useProgram(state.program);
		if (state.uColorPrimary)
			state.gl.uniform3f(
				state.uColorPrimary,
				palette.primary[0],
				palette.primary[1],
				palette.primary[2],
			);
		if (state.uColorSecondary)
			state.gl.uniform3f(
				state.uColorSecondary,
				palette.secondary[0],
				palette.secondary[1],
				palette.secondary[2],
			);
		if (state.uColorBackground)
			state.gl.uniform3f(
				state.uColorBackground,
				palette.background[0],
				palette.background[1],
				palette.background[2],
			);
		state.gl.clearColor(
			palette.background[0],
			palette.background[1],
			palette.background[2],
			1,
		);
		renderOnceRef.current?.();
	}, [palette]);

	return (
		<div
			ref={containerRef}
			className={className}
			style={{
				width: "100%",
				height: "100%",
				overflow: "hidden",
				...style,
			}}
		/>
	);
});

export default HeartRippleBackground;
