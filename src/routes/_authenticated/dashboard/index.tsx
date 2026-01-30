/**
 * /dashboard (index) - Home view
 *
 * Default dashboard child route showing the Home view with stats,
 * new songs CTA, matching playlists, and activity feed.
 */

import { createFileRoute } from "@tanstack/react-router";
import { HomeView } from "@/features/dashboard/views/HomeView";

export const Route = createFileRoute("/_authenticated/dashboard/")({
	component: HomeView,
});
