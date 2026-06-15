import type { Story } from "@ladle/react";
import { type ReactNode, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { GenrePillsPicker } from "../GenrePillsPicker";
import { TOP_GENRES } from "./fixtures";
import "./playlist-explorations.css";
import { WritingSurface } from "./WritingSurface";

/**
 * The intent + genre editor as one composable surface, every state laid out side
 * by side so we can sweat the details together: collapsed (empty + filled), the
 * open editor, and the genre picker at capacity. Each panel owns its own draft
 * state, so the interactions are real — type a genre, watch it pop in, edit and
 * save. The editorial chrome (serif title, hairline section rules) mirrors the
 * CoverFlow page so the editor is judged against the aesthetic it lives inside.
 */
export default { title: "Playlists/Explorations/Composable" };

function SurfaceHarness({
	description: initialDescription = null,
	genres: initialGenres = [],
	startEditing = false,
}: {
	description?: string | null;
	genres?: string[];
	startEditing?: boolean;
}) {
	const [description, setDescription] = useState<string | null>(
		initialDescription,
	);
	const [genres, setGenres] = useState<string[]>(initialGenres);
	const [isEditing, setIsEditing] = useState(startEditing);
	const [draftDescription, setDraftDescription] = useState(
		startEditing ? (initialDescription ?? "") : "",
	);
	const [draftGenres, setDraftGenres] = useState<string[]>(
		startEditing ? initialGenres : [],
	);

	const open = () => {
		setDraftDescription(description ?? "");
		setDraftGenres(genres);
		setIsEditing(true);
	};

	return (
		<WritingSurface
			description={description}
			genres={genres}
			isEditing={isEditing}
			draftDescription={draftDescription}
			draftGenres={draftGenres}
			topGenres={TOP_GENRES}
			onEditDescription={open}
			onEditGenres={open}
			onDraftDescriptionChange={setDraftDescription}
			onDraftGenresChange={setDraftGenres}
			onSave={() => {
				setDescription(draftDescription.trim() || null);
				setGenres(draftGenres);
				setIsEditing(false);
			}}
			onCancel={() => setIsEditing(false)}
		/>
	);
}

function PickerHarness({ initial }: { initial: string[] }) {
	const [value, setValue] = useState<string[]>(initial);
	return (
		<div className="xpl-genres">
			<GenrePillsPicker
				value={value}
				onChange={setValue}
				topGenres={TOP_GENRES}
			/>
		</div>
	);
}

/** A labelled cell — section label left, hairline rule trailing, like a chapter. */
function Panel({ label, children }: { label: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-5">
			<div className="flex items-center gap-4 px-1">
				<span
					className="theme-text-muted text-[11px] tracking-[0.2em] uppercase"
					style={{ fontFamily: fonts.body }}
				>
					{label}
				</span>
				<div className="theme-border-color h-px flex-1 self-center border-t" />
			</div>
			<div className="px-1">{children}</div>
		</section>
	);
}

export const IntentEditor: Story = () => (
	<div className="theme-bg min-h-screen px-6 py-12 md:px-10">
		<div className="mx-auto max-w-[1100px]">
			<header className="mb-10">
				<h1
					className="theme-text text-[clamp(34px,5vw,48px)] leading-[0.95] font-extralight tracking-tight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					Intent <span className="theme-text-muted">&amp;</span> genres
				</h1>
				<p
					className="theme-text-muted mt-2.5 max-w-[52ch] text-[15px] leading-relaxed text-pretty"
					style={{ fontFamily: fonts.body }}
				>
					The writing surface and genre picker, side by side — every state at
					once, so we can polish the editor against the page it lives in.
				</p>
			</header>

			<div className="grid items-start gap-x-12 gap-y-14 md:grid-cols-2">
				<Panel label="Collapsed · empty">
					<SurfaceHarness />
				</Panel>
				<Panel label="Collapsed · filled">
					<SurfaceHarness
						description="songs that feel like a slow sunday"
						genres={["indie pop", "dream pop"]}
					/>
				</Panel>
				<Panel label="Editing">
					<SurfaceHarness
						description="a bit of insecurity in my mind about relationships"
						genres={["indie pop", "indie rock", "alternative"]}
						startEditing
					/>
				</Panel>
				<Panel label="Genre picker · at capacity">
					<PickerHarness
						initial={[
							"indie pop",
							"dream pop",
							"alternative",
							"shoegaze",
							"lo-fi",
						]}
					/>
				</Panel>
			</div>
		</div>
	</div>
);
IntentEditor.meta = {
	description:
		"Side-by-side editor states. Add a genre to see the chip pop in; try a 6th at capacity for the shake. Click through all four themes.",
};
