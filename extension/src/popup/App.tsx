import { useEffect, useState } from "react";

export function App() {
	const [hasSpotifyToken, setHasSpotifyToken] = useState<boolean | null>(null);

	useEffect(() => {
		chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
			if (chrome.runtime.lastError) return;
			setHasSpotifyToken(response?.hasToken ?? false);
		});
	}, []);

	return (
		<div>
			<h1
				style={{
					fontSize: "1.5rem",
					fontWeight: 400,
					letterSpacing: "-0.02em",
				}}
			>
				everything you ever hearted.
			</h1>
			<p
				style={{
					marginTop: 12,
					fontSize: "0.875rem",
					color: hasSpotifyToken === true ? "#1DB954" : "#a1a1aa",
				}}
			>
				{hasSpotifyToken === null
					? "—"
					: hasSpotifyToken
						? "● Spotify: connected"
						: "○ open Spotify to connect"}
			</p>
		</div>
	);
}
