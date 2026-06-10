/**
 * Banner shown on open.spotify.com after a successful Spotify login is detected
 * by the background worker. Clicking "Close & return" hands control back to
 * hearted.'s onboarding tab.
 *
 * Rendered into a closed Shadow DOM with `all: initial` on the host to insulate
 * our styles from Spotify's global cascade (and vice versa).
 *
 * Visual language mirrors hearted's default "rose / Warm" theme
 * (src/lib/theme/colors.ts) so it reads as continuous with the onboarding UI.
 */

import { browser } from "../shared/browser";

const HOST_ID = "hearted-return-banner-host";

// Rose / "Warm" pastel theme — values copied from src/lib/theme/colors.ts.
// Inlined (not imported) because the extension has no runtime access to the
// web app's theme module. Keep these in sync if the default theme changes.
const THEME = {
	surface: "hsl(340, 32%, 91%)",
	border: "hsl(340, 20%, 75%)",
	text: "hsl(340, 28%, 22%)",
	textMuted: "hsl(340, 20%, 45%)",
	primary: "hsl(340, 28%, 28%)",
	primaryHover: "hsl(340, 30%, 20%)",
	textOnPrimary: "hsl(340, 32%, 92%)",
} as const;

const FONT_DISPLAY = "'Instrument Serif', Georgia, serif";
const FONT_BODY =
	"'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

type BannerMessage = { type?: unknown };

function isShowBannerMessage(message: BannerMessage): boolean {
	return message?.type === "SHOW_RETURN_BANNER";
}

function removeBanner(host: HTMLElement, wrap: HTMLElement): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		host.remove();
		return;
	}

	let removed = false;
	const cleanup = () => {
		if (removed) return;
		removed = true;
		window.clearTimeout(fallbackId);
		host.remove();
	};
	const fallbackId = window.setTimeout(cleanup, 300);

	wrap.classList.add("leaving");
	wrap.addEventListener("animationend", cleanup, { once: true });
}

function createBanner(): void {
	if (document.getElementById(HOST_ID)) return;
	if (!document.documentElement) return;

	const host = document.createElement("div");
	host.id = HOST_ID;
	// Host owns positioning only. The inner wrap owns animation/translate so
	// the centering transform on the host never fights the slide-in keyframes.
	host.style.cssText = [
		"all: initial",
		"position: fixed",
		"top: 84px",
		"left: 50%",
		"transform: translateX(-50%)",
		"z-index: 2147483000",
		"pointer-events: none",
	].join("; ");

	const root = host.attachShadow({ mode: "closed" });

	const style = document.createElement("style");
	style.textContent = `
		:host, * { box-sizing: border-box; }

		.wrap {
			pointer-events: auto;
			display: flex;
			align-items: center;
			gap: 14px;
			padding: 14px 14px 14px 18px;
			background: ${THEME.surface};
			border: 1px solid ${THEME.border};
			border-radius: 16px;
			box-shadow:
				0 12px 36px rgba(0, 0, 0, 0.22),
				0 2px 8px rgba(0, 0, 0, 0.1);
			color: ${THEME.text};
			font-family: ${FONT_BODY};
			animation: slideIn 260ms cubic-bezier(0.165, 0.84, 0.44, 1) both;
		}
		@keyframes slideIn {
			from { opacity: 0; transform: translateY(-8px); }
			to   { opacity: 1; transform: translateY(0); }
		}
		.leaving { animation: slideOut 180ms cubic-bezier(0.4, 0, 1, 1) forwards; }
		@keyframes slideOut {
			to { opacity: 0; transform: translateY(-8px); }
		}
		@media (prefers-reduced-motion: reduce) {
			.wrap, .leaving { animation: none !important; }
		}

		.label {
			display: flex;
			flex-direction: column;
			gap: 2px;
			max-width: 260px;
		}
		.title {
			font-family: ${FONT_DISPLAY};
			font-size: 17px;
			font-weight: 400;
			line-height: 1.15;
			color: ${THEME.text};
		}
		.title em {
			font-style: italic;
		}
		.sub {
			font-family: ${FONT_BODY};
			font-size: 12px;
			font-weight: 400;
			color: ${THEME.textMuted};
			letter-spacing: 0.005em;
		}

		.return {
			appearance: none;
			border: 0;
			cursor: pointer;
			padding: 9px 16px;
			border-radius: 24px;
			background: ${THEME.primary};
			color: ${THEME.textOnPrimary};
			font-family: ${FONT_BODY};
			font-size: 11px;
			font-weight: 500;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			transition: background 160ms ease-out, transform 120ms ease-out;
		}
		.return:hover  { background: ${THEME.primaryHover}; }
		.return:active { transform: scale(0.97); }
		.return:focus-visible {
			outline: 2px solid ${THEME.primary};
			outline-offset: 2px;
		}

		.dismiss {
			appearance: none;
			border: 0;
			cursor: pointer;
			width: 24px;
			height: 24px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border-radius: 50%;
			background: transparent;
			color: ${THEME.textMuted};
			font-size: 16px;
			line-height: 1;
			transition: background 120ms ease-out, color 120ms ease-out;
		}
		.dismiss:hover {
			background: rgba(0, 0, 0, 0.06);
			color: ${THEME.text};
		}
		.dismiss:focus-visible {
			outline: 2px solid ${THEME.primary};
			outline-offset: 2px;
		}
	`;

	const wrap = document.createElement("div");
	wrap.className = "wrap";
	wrap.setAttribute("role", "status");
	wrap.setAttribute("aria-live", "polite");

	const label = document.createElement("div");
	label.className = "label";

	const title = document.createElement("span");
	title.className = "title";
	// The brand's trademark trailing period — mirrors `<em>hearted.</em>` usage
	// in InstallExtensionStep.tsx for visual consistency.
	const brand = document.createElement("em");
	brand.textContent = "hearted.";
	title.appendChild(brand);
	title.appendChild(document.createTextNode(" is connected"));

	const sub = document.createElement("span");
	sub.className = "sub";
	sub.textContent = "you can close this tab and go back.";

	label.appendChild(title);
	label.appendChild(sub);

	const returnBtn = document.createElement("button");
	returnBtn.className = "return";
	returnBtn.type = "button";
	returnBtn.textContent = "Close & return";

	const dismissBtn = document.createElement("button");
	dismissBtn.className = "dismiss";
	dismissBtn.type = "button";
	dismissBtn.setAttribute("aria-label", "Dismiss");
	dismissBtn.textContent = "×";

	returnBtn.addEventListener("click", () => {
		try {
			browser.runtime.sendMessage({ type: "CLOSE_AND_FOCUS_HEARTED" });
		} catch {
			// extension context invalidated (e.g. extension reloaded) — just hide
			removeBanner(host, wrap);
		}
	});

	dismissBtn.addEventListener("click", () => removeBanner(host, wrap));

	wrap.appendChild(label);
	wrap.appendChild(returnBtn);
	wrap.appendChild(dismissBtn);
	root.appendChild(style);
	root.appendChild(wrap);

	document.documentElement.appendChild(host);
}

browser.runtime.onMessage.addListener((message: BannerMessage) => {
	if (isShowBannerMessage(message)) {
		createBanner();
	}
});

console.log("[hearted.] Return banner content script loaded");
