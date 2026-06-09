/**
 * Public /@handle route.
 *
 * Live only after the handle owner completes onboarding. Mixed-case requests
 * are redirected to the canonical lowercase path before any lookup so that
 * the not-found UI is consistent for unknown handles in all cases.
 */

import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { PublicHandleComingSoonPage } from "@/features/public-handle/PublicHandleComingSoonPage";
import { getPublicHandleIdentity } from "@/lib/server/public-handle.functions";

export const Route = createFileRoute("/@{$handle}")({
	loader: async ({ params }) => {
		const canonicalHandle = params.handle.toLowerCase();

		// Redirect mixed-case before lookup so /@Fabio and /@fabio always
		// resolve consistently; the not-found page looks the same for both.
		if (params.handle !== canonicalHandle) {
			throw redirect({
				to: "/@{$handle}",
				params: { handle: canonicalHandle },
			});
		}

		const identity = await getPublicHandleIdentity({
			data: { handle: canonicalHandle },
		});

		if (identity === null) {
			throw notFound();
		}

		return { identity };
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? [
					{
						title: `@${loaderData.identity.handle} — Public profile coming soon • hearted.`,
					},
				]
			: [],
	}),
	component: HandlePage,
});

function HandlePage() {
	const { identity } = Route.useLoaderData();
	return <PublicHandleComingSoonPage identity={identity} />;
}
