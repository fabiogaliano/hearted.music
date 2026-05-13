import type { Story } from "@ladle/react";
import { Check, Lock, X } from "lucide-react";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	const theme = useTheme();
	return (
		<div style={{ marginBottom: 48 }}>
			<p
				className="text-xs uppercase tracking-widest"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					marginBottom: 16,
				}}
			>
				{title}
			</p>
			<div className="flex flex-wrap items-center gap-4">{children}</div>
		</div>
	);
}

export const AllElements: Story = () => {
	const theme = useTheme();

	return (
		<div style={{ padding: 48, maxWidth: 800, fontFamily: fonts.body }}>
			<h1
				className="text-2xl font-extralight mb-12"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Border Radius — <span className="italic">Unified Language</span>
			</h1>

			{/* Primary CTAs — pill */}
			<Section title="Primary CTAs → pill · hover: opacity-90">
				<button
					type="button"
					className="cursor-pointer rounded-full border-0 px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						background: theme.primary,
						color: theme.textOnPrimary,
					}}
				>
					Unlock 3 songs
				</button>
				<button
					type="button"
					className="cursor-pointer rounded-full border-0 px-6 py-2.5 text-sm font-medium uppercase tracking-widest transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						background: theme.primary,
						color: theme.textOnPrimary,
					}}
				>
					allow sync →
				</button>
			</Section>

			{/* External CTAs — pill, surface bg */}
			<Section title="External CTAs → pill · hover: border brighten">
				<a
					href="https://example.com"
					className="hover-border-brighten group inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-sm font-medium uppercase tracking-widest active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					add to Chrome
					<span className="text-xs" style={{ opacity: 0.45 }}>
						↗
					</span>
				</a>
				<a
					href="https://example.com"
					className="hover-border-brighten group inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-sm font-medium uppercase tracking-widest active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					log in to Spotify
					<span className="text-xs" style={{ opacity: 0.45 }}>
						↗
					</span>
				</a>
			</Section>

			{/* Bordered buttons — sharp, fill hover */}
			<Section title="Bordered buttons → sharp · hover: bg-white/15">
				<button
					type="button"
					className="cursor-pointer border px-4 py-2 text-sm transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						borderColor: theme.border,
						color: theme.text,
					}}
				>
					Cancel
				</button>
				<button
					type="button"
					className="hover-border-brighten cursor-pointer rounded-full px-3 py-1 text-xs tracking-widest uppercase active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					Unlock Songs
				</button>
				<button
					type="button"
					className="cursor-pointer border px-4 py-1.5 text-xs font-normal uppercase tracking-widest transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						borderColor: theme.border,
						color: theme.text,
					}}
				>
					Use Spotify's
				</button>
				<button
					type="button"
					className="cursor-pointer border px-4 py-3 text-left transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						borderColor: theme.border,
						color: theme.text,
						width: 260,
					}}
				>
					<div className="flex items-baseline justify-between">
						<span className="text-sm font-medium">Backstage Pass</span>
						<span className="text-xs" style={{ color: theme.textMuted }}>
							$39.99/yr
						</span>
					</div>
				</button>
			</Section>

			{/* Text links — opacity hover */}
			<Section title="Text actions → sharp · hover: opacity-70">
				<button
					type="button"
					className="cursor-pointer text-xs font-medium tracking-widest uppercase transition-opacity hover:opacity-70"
					style={{
						fontFamily: fonts.body,
						color: theme.text,
						border: "none",
						background: "transparent",
					}}
				>
					Sync
				</button>
				<button
					type="button"
					className="cursor-pointer text-xs font-normal tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
					style={{
						fontFamily: fonts.body,
						color: theme.text,
						border: "none",
						background: "transparent",
					}}
				>
					Sign out
				</button>
				<button
					type="button"
					className="cursor-pointer border-0 bg-transparent text-sm transition-[transform,opacity] duration-150 hover:scale-[1.03] hover:opacity-90 active:scale-[0.98]"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Close
				</button>
				<button
					type="button"
					className="flex cursor-pointer items-center gap-1 border-0 bg-transparent px-3 py-1.5 text-xs transition-[transform,opacity] duration-150 hover:scale-[1.03] hover:opacity-90 active:scale-[0.98]"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					<X size={14} />
					Cancel
				</button>
			</Section>

			{/* Badges — pill */}
			<Section title="Badges → pill">
				<span
					className="rounded-full px-2 py-0.5 text-xs tracking-widest uppercase"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						background: theme.surface,
					}}
				>
					Demo
				</span>
				<span
					className="rounded-full px-2 py-0.5 text-xs tracking-widest uppercase"
					style={{
						fontFamily: fonts.body,
						color: theme.textOnPrimary,
						background: theme.primary,
					}}
				>
					Active
				</span>
			</Section>

			{/* Checkboxes — sharp */}
			<Section title="Checkboxes → sharp">
				<span
					className="flex h-5 w-5 shrink-0 items-center justify-center border"
					style={{ borderColor: theme.border, background: "transparent" }}
				/>
				<span
					className="flex h-5 w-5 shrink-0 items-center justify-center border"
					style={{ borderColor: theme.primary, background: theme.primary }}
				>
					<Check size={12} color={theme.bg} strokeWidth={3} />
				</span>
			</Section>

			{/* Dialog — sharp container, pill CTA */}
			<Section title="Dialog → sharp container, pill CTA inside">
				<div
					className="w-full max-w-sm p-6"
					style={{
						background: theme.surface,
						border: `1px solid ${theme.border}`,
					}}
				>
					<p
						className="text-sm font-medium"
						style={{ fontFamily: fonts.body, color: theme.text }}
					>
						Unlock 3 songs?
					</p>
					<p
						className="mt-2 text-xs"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						This will use 3 of your 50 remaining songs.
					</p>
					<div className="mt-4 flex gap-3">
						<button
							type="button"
							className="cursor-pointer border px-4 py-2 text-sm transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
							style={{
								fontFamily: fonts.body,
								borderColor: theme.border,
								color: theme.text,
							}}
						>
							Cancel
						</button>
						<button
							type="button"
							className="cursor-pointer rounded-full border-0 px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
							style={{
								fontFamily: fonts.body,
								background: theme.primary,
								color: theme.bg,
							}}
						>
							<span className="flex items-center gap-2">
								<Lock size={13} />
								Unlock
							</span>
						</button>
					</div>
				</div>
			</Section>
		</div>
	);
};
AllElements.meta = {
	description:
		"Showcase of the unified border-radius language: pills for primary CTAs and badges, sharp for everything else.",
};
