import { UserAvatar } from "@/components/ui/UserAvatar";
import { fonts } from "@/lib/theme/fonts";

interface ProfileLinkProps {
	handle: string;
	planLabel: string;
	isActive?: boolean;
	onOpen: () => void;
}

/** The sidebar footer strip relocated to the masthead corner: avatar +
 * @handle + plan, the whole strip a settings link — identity and the
 * settings entry stay one visible affordance, not a bare avatar. */
export function ProfileLink({
	handle,
	planLabel,
	isActive = false,
	onOpen,
}: ProfileLinkProps) {
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-label="Settings"
			aria-current={isActive ? "page" : undefined}
			className="theme-hover-surface focus-edge squircle -mx-2 flex items-center gap-3 rounded-full px-2 py-1.5 text-left transition-[background-color] duration-150 ease-out motion-reduce:transition-none"
		>
			<UserAvatar name={handle} size="sm" />
			<span className="min-w-0">
				<span
					className={`block truncate text-sm leading-tight ${isActive ? "theme-text font-medium" : "theme-text"}`}
					style={{ fontFamily: fonts.body }}
				>
					@{handle}
				</span>
				<span
					className="theme-text-muted block text-xs leading-tight"
					style={{ fontFamily: fonts.body }}
				>
					{planLabel}
				</span>
			</span>
		</button>
	);
}
