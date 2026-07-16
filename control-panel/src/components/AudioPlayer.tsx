import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { loadYouTubeApi, type YTPlayer } from "../lib/youtube-iframe";

export interface AudioSource {
	// YouTube video id to load.
	id: string;
	// Short label for the A/B switch, e.g. "Match" or "#2 alt".
	label: string;
}

export interface AudioPlayerHandle {
	toggle(): void;
}

interface AudioPlayerProps {
	// One source plays straight; two or more expose an A/B switch so the operator
	// can flip between the accepted match and an alternate candidate in place.
	sources: AudioSource[];
	// Scored clip offsets (seconds) — the spots the matcher sampled. Surfaced as
	// jump chips so the operator lands on the telling part instead of the intro.
	clipStarts?: number[];
	// Denser transport for list/cockpit contexts.
	compact?: boolean;
	// Controlled selection: set when the parent owns which source plays (e.g. a
	// selectable candidate filmstrip). Hides the internal A/B chips so there's a
	// single source-switching affordance on screen.
	activeIndex?: number;
}

function fmt(seconds: number): string {
	const t = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

const BAR_COUNT = 56;

// Deterministic pseudo-waveform seeded by the video id (xorshift over an FNV
// hash). Purely a scrub surface with per-track texture — we never download the
// audio, so real amplitudes aren't available and would cost a full fetch.
function waveBars(seed: string): { key: string; height: number }[] {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	const bars: { key: string; height: number }[] = [];
	for (let i = 0; i < BAR_COUNT; i++) {
		h ^= h << 13;
		h ^= h >>> 17;
		h ^= h << 5;
		bars.push({ key: `b${i}`, height: 22 + ((h >>> 0) % 62) });
	}
	return bars;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
	function AudioPlayer(
		{ sources, clipStarts = [], compact = false, activeIndex },
		ref,
	) {
		// YT replaces the mount node with its iframe, so React must only own the
		// outer wrapper — never the node handed to the API — or unmount throws.
		const mountRef = useRef<HTMLDivElement>(null);
		const playerRef = useRef<YTPlayer | null>(null);
		// Mirror of `playing` readable synchronously inside the poll/cue closures,
		// which capture state once and would otherwise go stale.
		const playingRef = useRef(false);

		const [ready, setReady] = useState(false);
		const [playing, setPlaying] = useState(false);
		const [current, setCurrent] = useState(0);
		const [duration, setDuration] = useState(0);
		const [internalIndex, setInternalIndex] = useState(0);

		const controlled = activeIndex != null;
		const index = controlled ? activeIndex : internalIndex;
		const sourceKey = sources.map((s) => s.id).join("|");
		const activeId = sources[index]?.id ?? sources[0]?.id ?? null;

		// Create the player exactly once. Later source changes flow through the cue
		// effect below so advancing a card swaps the video without a fresh iframe.
		// biome-ignore lint/correctness/useExhaustiveDependencies: create-once; activeId is read at creation only
		useEffect(() => {
			let cancelled = false;
			let poll: ReturnType<typeof setInterval> | undefined;
			loadYouTubeApi()
				.then((YT) => {
					if (cancelled || !mountRef.current) return;
					playerRef.current = new YT.Player(mountRef.current, {
						videoId: activeId ?? undefined,
						playerVars: {
							controls: 0,
							rel: 0,
							modestbranding: 1,
							playsinline: 1,
							disablekb: 1,
						},
						events: {
							onReady: (e) => {
								if (cancelled) return;
								setReady(true);
								setDuration(e.target.getDuration());
							},
							onStateChange: (e) => {
								if (cancelled) return;
								const state = window.YT?.PlayerState;
								if (!state) return;
								if (e.data === state.PLAYING) {
									playingRef.current = true;
									setPlaying(true);
									setDuration(e.target.getDuration());
								} else if (e.data === state.PAUSED || e.data === state.ENDED) {
									playingRef.current = false;
									setPlaying(false);
								}
							},
						},
					});
					poll = setInterval(() => {
						const p = playerRef.current;
						if (p && playingRef.current) setCurrent(p.getCurrentTime());
					}, 250);
				})
				.catch(() => {
					/* API blocked/offline — the panel still works via the open-out link. */
				});
			return () => {
				cancelled = true;
				if (poll) clearInterval(poll);
				playerRef.current?.destroy();
				playerRef.current = null;
			};
		}, []);

		// New card in focus mode → reset to its primary source.
		// biome-ignore lint/correctness/useExhaustiveDependencies: reset on source-set change
		useEffect(() => {
			setInternalIndex(0);
		}, [sourceKey]);

		// Swap the loaded video when the active source changes, preserving play state
		// so an A/B flip keeps playing and a card advance lands paused.
		useEffect(() => {
			const p = playerRef.current;
			if (!p || !ready || !activeId) return;
			setCurrent(0);
			if (playingRef.current) p.loadVideoById(activeId);
			else p.cueVideoById(activeId);
		}, [activeId, ready]);

		useImperativeHandle(
			ref,
			() => ({
				toggle() {
					const p = playerRef.current;
					if (!p) return;
					if (playingRef.current) p.pauseVideo();
					else p.playVideo();
				},
			}),
			[],
		);

		function toggle() {
			const p = playerRef.current;
			if (!p) return;
			if (playingRef.current) p.pauseVideo();
			else p.playVideo();
		}

		function seekToFraction(fraction: number) {
			const p = playerRef.current;
			if (!p || duration <= 0) return;
			const t = Math.max(0, Math.min(1, fraction)) * duration;
			p.seekTo(t, true);
			setCurrent(t);
		}

		function jumpTo(seconds: number) {
			const p = playerRef.current;
			if (!p) return;
			p.seekTo(seconds, true);
			setCurrent(seconds);
			if (!playingRef.current) p.playVideo();
		}

		const bars = useMemo(() => waveBars(activeId ?? "silence"), [activeId]);
		const fraction = duration > 0 ? current / duration : 0;
		const hasAudio = activeId != null;

		return (
			<div className={`ap${compact ? " compact" : ""}`}>
				{/* The iframe stays mounted for audio but is visually parked offscreen:
				    this is an ear-check transport, not a cinema (per the approved
				    split-stage prototype). "open on YouTube" covers wanting the video. */}
				<div className="ap-mount" aria-hidden="true">
					<div ref={mountRef} />
				</div>

				<div className="ap-transport">
					<button
						type="button"
						className="ap-play"
						onClick={toggle}
						disabled={!hasAudio}
						aria-label={playing ? "Pause" : "Play"}
					>
						{playing ? (
							<PauseIcon size={compact ? 14 : 16} weight="fill" />
						) : (
							<PlayIcon size={compact ? 14 : 16} weight="fill" />
						)}
					</button>

					<button
						type="button"
						className="ap-wave"
						disabled={!hasAudio}
						aria-label="Seek"
						onClick={(e) => {
							const rect = e.currentTarget.getBoundingClientRect();
							seekToFraction((e.clientX - rect.left) / rect.width);
						}}
					>
						{bars.map((bar, i) => (
							<i
								key={bar.key}
								className={
									fraction > 0 && i / BAR_COUNT <= fraction ? "on" : undefined
								}
								style={{ height: `${bar.height}%` }}
							/>
						))}
						{clipStarts.map((t) =>
							duration > 0 && t < duration ? (
								<span
									key={t}
									className="ap-tick"
									style={{ left: `${(t / duration) * 100}%` }}
								/>
							) : null,
						)}
					</button>

					<span className="ap-time num">
						{fmt(current)} / {fmt(duration)}
					</span>

					{!controlled && sources.length > 1 && (
						<fieldset className="ap-ab" aria-label="Compare sources">
							{sources.map((s, i) => (
								<button
									type="button"
									key={s.id}
									className={i === index ? "on" : ""}
									onClick={() => setInternalIndex(i)}
								>
									{s.label}
								</button>
							))}
						</fieldset>
					)}
				</div>

				{clipStarts.length > 0 && (
					<div className="ap-clips">
						<span className="ap-clips-label">Jump to clip</span>
						{clipStarts.map((t) => (
							<button
								type="button"
								key={t}
								className="btn mini"
								disabled={!hasAudio}
								onClick={() => jumpTo(t)}
							>
								{fmt(t)}
							</button>
						))}
					</div>
				)}
			</div>
		);
	},
);
