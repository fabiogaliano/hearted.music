import { Button } from "@/components/ui/Button";
import { useConsent } from "@/lib/consent/consent-context";
import { fonts } from "@/lib/theme/fonts";

const STATUS_LABEL = {
	granted: "Allowed",
	denied: "Declined",
	none: "Not decided",
} as const;

export function ConsentSection() {
	const { status, isUpdating, grant, deny } = useConsent();
	const statusLabel = STATUS_LABEL[status ?? "none"];

	return (
		<div>
			<p className="theme-text text-base" style={{ fontFamily: fonts.body }}>
				Current choice: {statusLabel}
			</p>
			<p
				className="theme-text-muted mt-1.5 max-w-lg text-sm leading-relaxed"
				style={{ fontFamily: fonts.body }}
			>
				You can change analytics and session replay consent here at any time.
			</p>

			<p
				aria-live="polite"
				className="theme-text-muted mt-3 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				{isUpdating ? "Saving…" : " "}
			</p>

			<div className="mt-5 flex flex-wrap gap-3">
				<Button
					variant="secondary"
					size="sm"
					onClick={deny}
					disabled={isUpdating}
					style={{ fontFamily: fonts.body }}
				>
					Decline
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={grant}
					disabled={isUpdating}
					style={{ fontFamily: fonts.body }}
				>
					Allow
				</Button>
			</div>
		</div>
	);
}
