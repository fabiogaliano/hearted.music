import type { MouseEvent, SubmitEvent } from "react";
import { useState } from "react";
import { useNavigate } from "../lib/navigation";
import {
	deleteSavedView,
	findSavedViewByName,
	listSavedViews,
	type SavedView,
	saveView,
} from "../lib/saved-views";
import { SECTION_KEYS, type SectionKey } from "../lib/url-state";

const sectionSet = new Set<string>(SECTION_KEYS);

function currentSectionAndParams(): { section: SectionKey; params: string } {
	const url = new URL(window.location.href);
	const requested = url.searchParams.get("section");
	const section: SectionKey = sectionSet.has(requested ?? "")
		? (requested as SectionKey)
		: "overview";
	const params = new URLSearchParams(url.searchParams);
	params.delete("section");
	return { section, params: params.toString() };
}

export function SavedViewsMenu() {
	const navigate = useNavigate();
	const [views, setViews] = useState<SavedView[]>(() => listSavedViews());
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);

	function handleSave(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		const trimmed = name.trim();
		if (!trimmed) return;
		const existing = findSavedViewByName(trimmed);
		if (
			existing &&
			!window.confirm(
				`A saved view named "${existing.label}" already exists. Replace it with the current view?`,
			)
		) {
			return;
		}
		try {
			const { section, params } = currentSectionAndParams();
			saveView(trimmed, section, params);
			setName("");
			setViews(listSavedViews());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	function open(view: SavedView) {
		navigate(
			view.section,
			Object.fromEntries(new URLSearchParams(view.params)),
		);
	}

	function remove(id: string, event: MouseEvent) {
		event.stopPropagation();
		deleteSavedView(id);
		setViews(listSavedViews());
	}

	return (
		<details className="saved-views-menu">
			<summary className="btn" title="Saved views">
				Saved views{views.length > 0 ? ` (${views.length})` : ""}
			</summary>
			<div className="saved-views-panel">
				<form className="saved-views-save" onSubmit={handleSave}>
					<input
						className="input"
						placeholder="Save current view as…"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
					<button type="submit" className="btn">
						Save
					</button>
				</form>
				{error && (
					<div className="result err" role="alert">
						{error}
					</div>
				)}
				{views.length === 0 ? (
					<div className="empty">No saved views yet.</div>
				) : (
					<ul className="saved-views-list">
						{views.map((view) => (
							<li key={view.id}>
								<button
									type="button"
									className="saved-view-item"
									onClick={() => open(view)}
								>
									<span className="primary">{view.label}</span>
									<span className="dim">{view.section}</span>
								</button>
								<button
									type="button"
									className="icon-btn"
									title="Delete saved view"
									onClick={(event) => remove(view.id, event)}
								>
									×
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</details>
	);
}
