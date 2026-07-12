/**
 * Loose config stand-ins shared by the whole-screen directions. Deliberately
 * NOT the prod ConfigSurface — its pieces are query-backed and their layout
 * is exactly what's being redesigned. These are believable fields (intent,
 * genre pills, filters, max songs) with fake local state; only the
 * composition around them is being judged.
 */

import { LockSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";

export function FieldLabel({ children }: { children: React.ReactNode }) {
	return (
		<span
			className="theme-text-muted text-[11px] font-medium tracking-[0.18em] uppercase"
			style={{ fontFamily: fonts.body }}
		>
			{children}
		</span>
	);
}

function Chip({
	label,
	onRemove,
	dashed = false,
}: {
	label: string;
	onRemove?: () => void;
	dashed?: boolean;
}) {
	return (
		<span
			className="theme-text-muted inline-flex items-center gap-1"
			style={{
				fontFamily: fonts.body,
				fontSize: "0.625rem",
				letterSpacing: "0.07em",
				padding: "3px 10px",
				borderRadius: 12,
				borderWidth: 1,
				borderStyle: dashed ? "dashed" : "solid",
				borderColor: "var(--t-border)",
			}}
		>
			{label}
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove ${label}`}
					className="cursor-pointer transition-opacity duration-150 hover:opacity-70"
				>
					<XIcon size={9} weight="bold" aria-hidden />
				</button>
			)}
		</span>
	);
}

export function IntentField({
	initial,
	locked = false,
	lockedHint,
}: {
	initial?: string;
	/** Premium gate: renders the show-then-lock teaser instead of the input. */
	locked?: boolean;
	/** Unmet gate paths, e.g. "Backstage Pass · or 1,000 songs unlocked — 340 / 1,000". */
	lockedHint?: string;
}) {
	if (locked) {
		return (
			<div className="flex flex-col gap-2">
				<FieldLabel>Intent</FieldLabel>
				<input
					type="text"
					disabled
					placeholder="Describe the vibe in your own words…"
					aria-describedby="proto-intent-locked"
					className="theme-border-color theme-text w-full border bg-transparent px-3 py-2 text-sm opacity-50 outline-none"
					style={{ fontFamily: fonts.body }}
				/>
				<p
					id="proto-intent-locked"
					className="theme-text-muted inline-flex items-start gap-1.5 text-xs leading-snug"
					style={{ fontFamily: fonts.body }}
				>
					<LockSimpleIcon
						size={11}
						weight="regular"
						aria-hidden
						className="mt-0.5 flex-none"
					/>
					{lockedHint ?? "Available with Backstage Pass"}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<FieldLabel>Intent</FieldLabel>
			<input
				type="text"
				defaultValue={initial}
				placeholder="Describe the vibe in your own words…"
				className="theme-border-color theme-text w-full border bg-transparent px-3 py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
				style={{ fontFamily: fonts.body }}
			/>
		</div>
	);
}

export function GenreField({ initial }: { initial?: string[] }) {
	const [genres, setGenres] = useState(
		initial ?? ["indie", "pop", "electronic"],
	);
	return (
		<div className="flex flex-col gap-2">
			<FieldLabel>Genres</FieldLabel>
			<div className="flex flex-wrap items-center gap-1.5">
				{genres.map((g) => (
					<Chip
						key={g}
						label={g}
						onRemove={() => setGenres((prev) => prev.filter((x) => x !== g))}
					/>
				))}
				<button type="button" className="cursor-pointer">
					<Chip label="+ add genre" dashed />
				</button>
			</div>
		</div>
	);
}

export function MaxSongsField() {
	const [maxSongs, setMaxSongs] = useState(15);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-4">
				<FieldLabel>Max songs</FieldLabel>
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{maxSongs} · ≈{Math.round(maxSongs * 3.2)} min
				</span>
			</div>
			<input
				type="range"
				min={5}
				max={50}
				step={5}
				value={maxSongs}
				onChange={(e) => setMaxSongs(Number(e.target.value))}
				aria-label="Max songs"
				className="w-full"
				style={{ accentColor: "var(--t-primary)" }}
			/>
		</div>
	);
}
