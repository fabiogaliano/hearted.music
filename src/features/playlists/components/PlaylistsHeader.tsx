import { InfoIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { DescriptionRoleDialog } from "./DescriptionRoleDialog";

interface PlaylistsHeaderProps {
	totalCount: number | null;
	searchQuery: string;
	onSearchChange: (value: string) => void;
}

export function PlaylistsHeader({
	totalCount,
	searchQuery,
	onSearchChange,
}: PlaylistsHeaderProps) {
	const searchInputRef = useRef<HTMLInputElement>(null);
	const [isHelpOpen, setIsHelpOpen] = useState(false);
	const openHelp = () => setIsHelpOpen(true);

	return (
		<header className="mb-10">
			<p
				className="theme-text-muted text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Library
			</p>

			<h1
				className="theme-text mt-3 flex items-baseline gap-4 font-extralight tracking-tight leading-[0.95] text-balance"
				style={{ fontFamily: fonts.display }}
				aria-label={
					totalCount != null ? `Playlists, ${totalCount} total` : "Playlists"
				}
			>
				<span className="text-page-title">Playlists</span>
				<span
					aria-hidden="true"
					className="theme-text-muted text-3xl tabular-nums opacity-60"
				>
					{totalCount ?? "—"}
				</span>
			</h1>

			<div className="theme-border-color mt-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b">
				<p
					className="theme-text-muted max-w-lg pb-2.5 text-base leading-relaxed text-pretty"
					style={{ fontFamily: fonts.body }}
				>
					Your liked songs find{" "}
					<button
						type="button"
						onClick={openHelp}
						className="theme-text m-0 cursor-pointer border-0 bg-transparent p-0 underline-offset-4 transition-[text-decoration] duration-150 hover:underline focus-visible:underline"
						style={{
							fontSize: "inherit",
							lineHeight: "inherit",
						}}
					>
						<em style={{ fontFamily: fonts.display, fontStyle: "italic" }}>
							homes
						</em>
					</button>{" "}
					through each playlist's{" "}
					<button
						type="button"
						onClick={openHelp}
						className="theme-text m-0 cursor-pointer border-0 bg-transparent p-0 underline-offset-4 transition-[text-decoration] duration-150 hover:underline focus-visible:underline"
						style={{
							fontSize: "inherit",
							lineHeight: "inherit",
						}}
					>
						<em style={{ fontFamily: fonts.display, fontStyle: "italic" }}>
							description
						</em>
					</button>
					.{" "}
					<button
						type="button"
						onClick={openHelp}
						aria-label="Learn how songs find their way into playlists"
						className="theme-text-muted -m-2 inline-flex size-9 cursor-pointer items-center justify-center align-middle transition-colors duration-150 hover:text-(--t-text) focus-visible:text-(--t-text)"
					>
						<InfoIcon
							aria-hidden="true"
							size={14}
							weight="regular"
							className="shrink-0"
						/>
					</button>
				</p>

				<label className="relative flex items-center gap-2 pb-2.5">
					<input
						ref={searchInputRef}
						type="search"
						value={searchQuery}
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="Search playlists"
						aria-label="Search playlists"
						className="peer theme-text w-32 border-0 bg-transparent pl-2 text-sm tracking-wide outline-none transition-[width] duration-200 placeholder:text-(--t-text-muted) placeholder:opacity-70 placeholder:transition-opacity placeholder:duration-200 focus:w-56 focus:placeholder:opacity-100 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
						style={{ fontFamily: fonts.body }}
					/>
					<button
						type="button"
						onClick={() => {
							onSearchChange("");
							searchInputRef.current?.focus();
						}}
						aria-label="Clear search"
						aria-hidden={searchQuery.length === 0}
						tabIndex={searchQuery.length === 0 ? -1 : 0}
						className={`theme-text-muted shrink-0 transition-opacity duration-150 ${
							searchQuery.length > 0
								? "cursor-pointer opacity-70 hover:opacity-100"
								: "pointer-events-none opacity-0"
						}`}
					>
						<XIcon size={12} weight="regular" />
					</button>
					<MagnifyingGlassIcon
						size={13}
						weight="regular"
						className="theme-text-muted shrink-0 transition-[color,transform] duration-200 peer-focus:scale-110 peer-focus:text-(--t-text)"
					/>
					<span
						aria-hidden="true"
						className="theme-primary-bg pointer-events-none absolute inset-x-0 -bottom-px h-px opacity-0 transition-opacity duration-200 peer-focus:opacity-100"
					/>
				</label>
			</div>
			{isHelpOpen && (
				<DescriptionRoleDialog onClose={() => setIsHelpOpen(false)} />
			)}
		</header>
	);
}
