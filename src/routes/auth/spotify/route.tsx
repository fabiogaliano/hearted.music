/**
 * Layout route for /auth/spotify/*
 *
 * This is a passthrough layout - it just renders child routes.
 * The actual OAuth initiation happens in spotify.index.tsx
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/spotify")({
	component: () => <Outlet />,
});
