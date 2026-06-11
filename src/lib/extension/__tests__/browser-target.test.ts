import { afterEach, describe, expect, it } from "vitest";
import { getEngineSupport } from "../browser-target";

const ORIGINAL_UA = navigator.userAgent;
const ORIGINAL_TOUCH = navigator.maxTouchPoints;

function setNavigator(userAgent: string, maxTouchPoints = 0) {
	Object.defineProperty(navigator, "userAgent", {
		value: userAgent,
		configurable: true,
	});
	Object.defineProperty(navigator, "maxTouchPoints", {
		value: maxTouchPoints,
		configurable: true,
	});
}

afterEach(() => {
	setNavigator(ORIGINAL_UA, ORIGINAL_TOUCH);
});

// Representative real-world UA strings, one per row of the capability matrix.
const CHROMIUM_DESKTOP: Array<[string, string]> = [
	[
		"Chrome",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	],
	[
		"Edge",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
	],
	[
		"Opera",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
	],
	[
		"Vivaldi (bare Chromium UA)",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	],
	[
		"ChromeOS",
		"Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	],
];

const UNSUPPORTED: Array<[string, string, number]> = [
	[
		"Desktop Safari",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
		0,
	],
	[
		"iPhone Safari",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		5,
	],
	[
		"iPhone Chrome (CriOS, WebKit)",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
		5,
	],
	[
		"iPadOS 13+ (reports Macintosh, but touch-capable)",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
		5,
	],
	[
		"Android Chrome",
		"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
		5,
	],
	[
		"Samsung Internet (Android)",
		"Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
		5,
	],
	[
		"Samsung Internet in DeX desktop mode (UA drops Android)",
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Safari/537.36",
		0,
	],
];

describe("getEngineSupport", () => {
	for (const [name, ua] of CHROMIUM_DESKTOP) {
		it(`classifies ${name} as chromium`, () => {
			setNavigator(ua);
			expect(getEngineSupport()).toBe("chromium");
		});
	}

	it("classifies desktop Firefox as firefox", () => {
		setNavigator(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
		);
		expect(getEngineSupport()).toBe("firefox");
	});

	it("classifies Firefox for Android as firefox (capable despite small screen)", () => {
		setNavigator(
			"Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0",
			5,
		);
		expect(getEngineSupport()).toBe("firefox");
	});

	for (const [name, ua, touch] of UNSUPPORTED) {
		it(`classifies ${name} as unsupported`, () => {
			setNavigator(ua, touch);
			expect(getEngineSupport()).toBe("unsupported");
		});
	}

	it("treats an unknown UA (no engine token) as unsupported", () => {
		setNavigator("some-unknown-bot/1.0");
		expect(getEngineSupport()).toBe("unsupported");
	});
});
