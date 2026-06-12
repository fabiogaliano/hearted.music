import { Link } from "@tanstack/react-router";
import { UserAvatar } from "@/components/ui/UserAvatar";
import type { PublicHandleIdentity } from "@/lib/domains/library/accounts/queries";
import { fonts } from "@/lib/theme/fonts";

interface PublicHandleComingSoonPageProps {
	identity: PublicHandleIdentity;
}

export function PublicHandleComingSoonPage({
	identity,
}: PublicHandleComingSoonPageProps) {
	return (
		<div
			className="theme-bg flex min-h-screen flex-col items-center justify-center px-8 text-center"
			style={{ fontFamily: fonts.body }}
		>
			<UserAvatar
				name={identity.handle}
				imageUrl={identity.imageUrl}
				size="md"
			/>

			<p
				className="theme-text mt-6 text-xl font-medium tracking-tight"
				style={{ fontFamily: fonts.body }}
			>
				@{identity.handle}
			</p>

			<h1
				className="theme-text mt-4 text-3xl font-extralight leading-tight md:text-4xl"
				style={{ fontFamily: fonts.display }}
			>
				Public profile coming soon.
			</h1>

			<p className="theme-text-muted mt-4 max-w-sm text-base leading-relaxed">
				More public hearted. features are on the way.
			</p>

			<Link
				to="/"
				className="theme-text-muted mt-10 text-sm underline underline-offset-4 transition-opacity hover:opacity-80"
			>
				Back to hearted.
			</Link>
		</div>
	);
}
