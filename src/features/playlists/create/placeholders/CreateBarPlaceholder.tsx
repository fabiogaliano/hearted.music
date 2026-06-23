/**
 * CreateBarPlaceholder — seam for T7.
 *
 * T7 will replace this with the full create CTA: name input, create button,
 * reconnect affordance, success state, and edge-case states (empty, warming-up,
 * not-enough-songs, disconnected).
 */

import { fonts } from "@/lib/theme/fonts";

interface CreateBarPlaceholderProps {
	previewCount: number;
	intentApplied: boolean;
}

export function CreateBarPlaceholder({
	previewCount,
	intentApplied,
}: CreateBarPlaceholderProps) {
	return (
		<div
			className="theme-border-color border border-dashed px-4 py-6"
			style={{ opacity: 0.4 }}
			aria-hidden="true"
		>
			<p
				className="theme-text-muted text-[11px] tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				T7 — Create bar: name input + create button + reconnect affordance
			</p>
			<p
				className="theme-text-muted mt-1 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				{previewCount} songs queued
				{intentApplied ? " · intent applied" : ""}
			</p>
		</div>
	);
}
