import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<div className="min-h-screen bg-gradient-to-b from-slate-900 to-black flex items-center justify-center">
			<div className="text-center">
				<h1 className="text-4xl font-bold text-white mb-4">
					hearted.
				</h1>
				<p className="text-gray-400 mb-8">
					Automatically organize your liked songs into playlists
				</p>
				<a
					href="/auth/spotify"
					className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-full transition-colors"
				>
					Login with Spotify
				</a>
			</div>
		</div>
	);
}
