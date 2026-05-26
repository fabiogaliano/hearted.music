import type { Story } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ActiveJobs } from "@/lib/server/jobs.functions";
import { allLikedSongs, simulateDashboard } from "@/stories/fixtures";
import { Dashboard } from "./Dashboard";

const TOTAL_LIKED_SONGS = allLikedSongs.length;

export const FullyEnriched: Story = () => (
	<Dashboard
		{...simulateDashboard(allLikedSongs, allLikedSongs.length, false)}
	/>
);

export const Empty: Story = () => (
	<Dashboard {...simulateDashboard(allLikedSongs, 0, false)} />
);

export const MidEnrichment: Story = () => (
	<Dashboard {...simulateDashboard(allLikedSongs, 12, true)} />
);

export const ProgressiveEnrichment: Story = () => {
	const [count, setCount] = useState(0);
	const total = TOTAL_LIKED_SONGS;

	useEffect(() => {
		if (count >= total) return;
		const id = setTimeout(() => setCount((c) => Math.min(c + 1, total)), 800);
		return () => clearTimeout(id);
	}, [count]);

	return (
		<div>
			<div
				style={{
					padding: "12px 16px",
					background: "#f5f5f5",
					borderBottom: "1px solid #e5e5e5",
					fontSize: 13,
					display: "flex",
					gap: 12,
					alignItems: "center",
				}}
			>
				<span>
					Enriched: {count}/{total}
				</span>
				<input
					type="range"
					min={0}
					max={total}
					value={count}
					onChange={(e) => setCount(Number(e.target.value))}
					style={{ flex: 1 }}
				/>
				<button
					type="button"
					onClick={() => setCount(0)}
					style={{ fontSize: 12, padding: "4px 8px" }}
				>
					Reset
				</button>
			</div>
			<Dashboard {...simulateDashboard(allLikedSongs, count, count < total)} />
		</div>
	);
};
ProgressiveEnrichment.meta = {
	description: "Drag the slider to simulate songs being enriched over time",
};

function ReadyExtensionStub({ children }: { children: ReactNode }) {
	const previousChrome = useMemo(() => Reflect.get(globalThis, "chrome"), []);

	Reflect.set(globalThis, "chrome", {
		runtime: {
			sendMessage: (
				_extensionId: string,
				message: unknown,
				callback: (response: unknown) => void,
			) => {
				const type =
					typeof message === "object" && message !== null && "type" in message
						? Reflect.get(message, "type")
						: null;

				if (type === "PING") {
					callback({ type: "PONG" });
					return;
				}
				if (type === "SPOTIFY_STATUS") {
					callback({ type: "SPOTIFY_STATUS", hasToken: true });
					return;
				}
				if (type === "GET_STATUS") {
					callback({
						hasToken: true,
						tokenExpiresAtMs: Date.now() + 60_000,
						sync: {
							status: "idle",
							phase: "idle",
							fetched: 0,
							total: 0,
							likedSongs: { fetched: 0, total: 0 },
							playlists: { fetched: 0, total: 0 },
							playlistTracks: { fetched: 0, total: 0 },
							artistImages: { fetched: 0, total: 0 },
							lastSyncAt: Date.now() - 60_000,
							error: null,
						},
					});
					return;
				}

				callback(undefined);
			},
			lastError: undefined,
		},
	});

	useEffect(() => {
		return () => {
			if (previousChrome === undefined) {
				Reflect.deleteProperty(globalThis, "chrome");
				return;
			}
			Reflect.set(globalThis, "chrome", previousChrome);
		};
	}, [previousChrome]);

	return <>{children}</>;
}

// Integration state: the inline sync control coexisting with the header's
// enrichment ("analyzing") UI, with the extension stubbed into a ready state so
// the shipped dashboard composition is visible in Ladle without a real browser
// extension.
export const ReadyWhileEnrichmentRunning: Story = () => {
	const props = simulateDashboard(allLikedSongs, 40, true);
	const client = useMemo(() => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const activeJobs: ActiveJobs = {
			enrichment: {
				id: "story-enrichment",
				status: "running",
				progress: {
					done: 40,
					total: TOTAL_LIKED_SONGS,
					succeeded: 40,
					failed: 0,
				},
			},
			matchSnapshotRefresh: null,
			firstMatchReady: false,
		};
		queryClient.setQueryData(["active-jobs", props.accountId], activeJobs);
		return queryClient;
	}, [props.accountId]);

	return (
		<QueryClientProvider client={client}>
			<ReadyExtensionStub>
				<Dashboard {...props} />
			</ReadyExtensionStub>
		</QueryClientProvider>
	);
};
ReadyWhileEnrichmentRunning.meta = {
	description:
		"Ready sync control alongside a live enrichment job (active-jobs cache seeded)",
};
