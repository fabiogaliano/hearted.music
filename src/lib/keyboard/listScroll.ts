import type { ListScrollBlock } from "@/lib/keyboard/types";

function prefersReducedMotion(): boolean {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function resolveListScrollBehavior(
	block: ListScrollBlock,
): ScrollBehavior {
	if (prefersReducedMotion()) return "auto";
	if (block === "center") return "auto";
	return "smooth";
}

export function scrollListElementIntoView(
	element: HTMLElement,
	block: ListScrollBlock,
): void {
	element.scrollIntoView({
		behavior: resolveListScrollBehavior(block),
		block,
		inline: "nearest",
	});
}
