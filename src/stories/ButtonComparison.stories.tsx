import type { Story } from "@ladle/react";
import {
	X,
	LockSimple,
	ArrowSquareOut,
	CaretLeft,
	CaretRight,
} from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { Button } from "@/components/ui/Button";

function Row({
	label,
	note,
	children,
}: {
	label: string;
	note?: string;
	children: React.ReactNode;
}) {
	const theme = useTheme();
	return (
		<div style={{ marginBottom: 48 }}>
			<p
				className="text-xs uppercase tracking-widest"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					marginBottom: note ? 4 : 16,
				}}
			>
				{label}
			</p>
			{note && (
				<p
					className="text-xxs"
					style={{
						fontFamily: fonts.body,
						color: theme.primary,
						marginBottom: 16,
						opacity: 0.8,
					}}
				>
					{note}
				</p>
			)}
			<div className="flex items-start gap-12">{children}</div>
		</div>
	);
}

function Column({
	heading,
	children,
}: {
	heading: string;
	children: React.ReactNode;
}) {
	const theme = useTheme();
	return (
		<div className="flex min-w-[280px] flex-col gap-3">
			<p
				className="text-xxs uppercase tracking-widest"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					opacity: 0.5,
				}}
			>
				{heading}
			</p>
			<div className="flex flex-wrap items-center gap-3">{children}</div>
		</div>
	);
}

export const SideBySide: Story = () => {
	const theme = useTheme();

	return (
		<div style={{ padding: 48, maxWidth: 960, fontFamily: fonts.body }}>
			<h1
				className="text-2xl font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Button Component — <span className="italic">Before / After</span>
			</h1>
			<p className="mb-12 mt-2 text-xs" style={{ color: theme.textMuted }}>
				Left: original hand-rolled classes from production. Right: new{" "}
				{"<Button>"} component. Hover and click both to compare feel.
			</p>

			{/* ── Primary md (pill) ── */}
			<Row label="Primary · md — filled pill CTA (rounded-full opt-in)">
				<Column heading="Before">
					{/* SongSelectionBar — canonical pill */}
					<button
						type="button"
						className="theme-primary-action cursor-pointer rounded-full px-5 py-2 text-sm tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
					>
						Unlock 3 songs
					</button>
					{/* InstallExtensionStep — pill */}
					<button
						type="button"
						className="theme-primary-action inline-flex cursor-pointer items-center gap-2 self-start rounded-full px-6 py-2.5 text-sm font-medium uppercase tracking-widest transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
					>
						I&apos;ve installed it
					</button>
				</Column>
				<Column heading="After">
					<Button className="rounded-full">Unlock 3 songs</Button>
					<Button className="rounded-full">I&apos;ve installed it</Button>
				</Column>
			</Row>

			{/* ── Primary md (sharp) ── */}
			<Row label="Primary · md — filled sharp CTA">
				<Column heading="Before">
					{/* UnlockConfirmDialog — no rounded-full */}
					<button
						type="button"
						className="theme-primary-action cursor-pointer px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
					>
						Get more credits
					</button>
					{/* DescriptionConflictDialog — keep mine */}
					<button
						type="button"
						className="theme-primary-action cursor-pointer px-6 py-2 text-sm font-medium tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
					>
						Keep mine
					</button>
				</Column>
				<Column heading="After">
					<Button>Get more credits</Button>
					<Button>Keep mine</Button>
				</Column>
			</Row>

			{/* ── Primary md with icon ── */}
			<Row label="Primary · md — with inline icon (pill)">
				<Column heading="Before">
					{/* SongSelectionBar confirm */}
					<button
						type="button"
						className="theme-primary-action flex cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
					>
						<LockSimple size={14} weight="regular" />
						Unlock 3 songs
					</button>
				</Column>
				<Column heading="After">
					<Button className="flex items-center gap-2 rounded-full">
						<LockSimple size={14} weight="regular" />
						Unlock 3 songs
					</Button>
				</Column>
			</Row>

			{/* ── Primary sm ── */}
			<Row label="Primary · sm — compact filled (sharp)">
				<Column heading="Before">
					{/* PlaylistDescription — no hover/active/transition */}
					<button
						type="button"
						className="theme-primary-action px-3 py-1.5 text-xs tracking-widest uppercase"
					>
						Save
					</button>
					{/* PaywallCTA — explicit borderRadius: 2px */}
					<button
						type="button"
						className="theme-primary-action cursor-pointer px-5 py-1.5 text-xs tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
						style={{ borderRadius: "2px" }}
					>
						Add 500 more
					</button>
				</Column>
				<Column heading="After">
					<Button size="sm">Save</Button>
					<Button size="sm">Add 500 more</Button>
				</Column>
			</Row>

			{/* ── Primary disabled ── */}
			<Row label="Primary · md — disabled states">
				<Column heading="Before">
					<button
						type="button"
						disabled
						className="theme-primary-action cursor-pointer rounded-full px-5 py-2 text-sm tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
					>
						No credits
					</button>
					<button
						type="button"
						disabled
						className="theme-primary-action cursor-pointer px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
					>
						No credits
					</button>
				</Column>
				<Column heading="After">
					<Button disabled className="rounded-full">
						No credits
					</Button>
					<Button disabled>No credits</Button>
				</Column>
			</Row>

			{/* ── Secondary md ── */}
			<Row label="Secondary · md — bordered, transparent bg">
				<Column heading="Before">
					{/* UnlockConfirmDialog cancel — canonical */}
					<button
						type="button"
						className="theme-border-color theme-text cursor-pointer border px-4 py-2 text-sm transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
					>
						Cancel
					</button>
				</Column>
				<Column heading="After">
					<Button variant="secondary">Cancel</Button>
				</Column>
			</Row>

			{/* ── Secondary sm ── */}
			<Row label="Secondary · sm — compact bordered">
				<Column heading="Before">
					{/* DescriptionConflictDialog — had font-normal */}
					<button
						type="button"
						className="theme-border-color theme-text cursor-pointer border px-4 py-1.5 text-xs font-normal tracking-widest uppercase transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
					>
						Use Spotify&apos;s
					</button>
				</Column>
				<Column heading="After">
					<Button variant="secondary" size="sm">
						Use Spotify&apos;s
					</Button>
				</Column>
			</Row>

			{/* ── Secondary disabled ── */}
			<Row label="Secondary · md — disabled state">
				<Column heading="Before">
					{/* PaywallCTA pack card — has disabled states */}
					<button
						type="button"
						disabled
						className="theme-border-color theme-text cursor-pointer border px-4 py-2 text-sm transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
					>
						Processing…
					</button>
				</Column>
				<Column heading="After">
					<Button variant="secondary" disabled>
						Processing…
					</Button>
				</Column>
			</Row>

			{/* ── Ghost md ── */}
			<Row label="Ghost · md — muted text action">
				<Column heading="Before">
					{/* UnlockConfirmDialog "Not now" */}
					<button
						type="button"
						className="theme-text-muted mt-2 cursor-pointer border-0 bg-transparent px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-70 active:scale-[0.98]"
					>
						Not now
					</button>
				</Column>
				<Column heading="After">
					<Button variant="ghost">Not now</Button>
				</Column>
			</Row>

			{/* ── Ghost sm ── */}
			<Row
				label="Ghost · sm — compact muted text"
				note="△ Timing: 'Dismiss' had duration-100 → normalized to 150"
			>
				<Column heading="Before">
					{/* MatchesSection — duration-100 */}
					<button
						type="button"
						className="theme-text-muted text-xs tracking-widest uppercase transition-[transform,opacity] duration-100 hover:opacity-70 active:scale-[0.98]"
					>
						Dismiss
					</button>
					{/* SettingsPage — font-normal, disabled:cursor-wait */}
					<button
						type="button"
						className="theme-text-muted cursor-pointer text-xs font-normal tracking-widest uppercase transition-opacity duration-150 hover:opacity-70 disabled:cursor-wait disabled:opacity-50"
					>
						Sign out
					</button>
					{/* PaywallCTA — missing active:scale */}
					<button
						type="button"
						className="theme-text-muted cursor-pointer border-0 bg-transparent px-4 py-1.5 text-xs tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
					>
						Not now
					</button>
					{/* BillingSection — inline-flex for icon */}
					<button
						type="button"
						className="theme-text-muted inline-flex cursor-pointer items-center gap-2 text-xs font-normal tracking-widest uppercase transition-opacity duration-150 hover:opacity-70 disabled:cursor-wait disabled:opacity-50"
					>
						Manage subscription
						<ArrowSquareOut size={12} weight="light" />
					</button>
					{/* PlaylistDescription cancel — no transitions at all */}
					<button
						type="button"
						className="theme-text-muted text-xs tracking-widest uppercase"
					>
						Cancel
					</button>
				</Column>
				<Column heading="After">
					<Button variant="ghost" size="sm">
						Dismiss
					</Button>
					<Button variant="ghost" size="sm">
						Sign out
					</Button>
					<Button variant="ghost" size="sm">
						Not now
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="inline-flex items-center gap-2"
					>
						Manage subscription
						<ArrowSquareOut size={12} weight="light" />
					</Button>
					<Button variant="ghost" size="sm">
						Cancel
					</Button>
				</Column>
			</Row>

			{/* ── Ghost disabled ── */}
			<Row label="Ghost · sm — disabled state">
				<Column heading="Before">
					{/* SettingsPage sign out while signing out */}
					<button
						type="button"
						disabled
						className="theme-text-muted cursor-pointer text-xs font-normal tracking-widest uppercase transition-opacity duration-150 hover:opacity-70 disabled:cursor-wait disabled:opacity-50"
					>
						Sign out
					</button>
					{/* BillingSection while loading portal */}
					<button
						type="button"
						disabled
						className="theme-text-muted inline-flex cursor-pointer items-center gap-2 text-xs font-normal tracking-widest uppercase transition-opacity duration-150 hover:opacity-70 disabled:cursor-wait disabled:opacity-50"
					>
						Manage subscription
						<ArrowSquareOut size={12} weight="light" />
					</button>
				</Column>
				<Column heading="After">
					<Button variant="ghost" size="sm" disabled>
						Sign out
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled
						className="inline-flex items-center gap-2"
					>
						Manage subscription
						<ArrowSquareOut size={12} weight="light" />
					</Button>
				</Column>
			</Row>

			{/* ── Surface ── */}
			<Row
				label="Surface — bordered pill, surface bg"
				note="△ Padding: original had py-1 → normalized to py-1.5"
			>
				<Column heading="Before">
					{/* LikedSongsHeader — py-1 */}
					<button
						type="button"
						className="hover-border-brighten cursor-pointer rounded-full px-3 py-1 text-xs tracking-widest uppercase active:scale-[0.98]"
					>
						Unlock Songs
					</button>
				</Column>
				<Column heading="After">
					<Button variant="surface">Unlock Songs</Button>
				</Column>
			</Row>

			{/* ── Icon md ── */}
			<Row label="Icon · md — close / dismiss icons">
				<Column heading="Before">
					{/* ShortcutsHelpModal close — p-1, hover:opacity-70 */}
					<button
						type="button"
						className="theme-text-muted cursor-pointer p-1 transition-opacity hover:opacity-70"
					>
						<X size={18} style={{ color: theme.textMuted }} />
					</button>
					{/* PlaylistDetailView close — p-2, opacity fades */}
					<button
						type="button"
						className="theme-text-muted p-2"
						style={{ opacity: 0.7 }}
					>
						<X size={18} style={{ color: theme.textMuted }} />
					</button>
					{/* PlaylistCard remove — p-2, reveal-on-hover (forced visible here) */}
					<button
						type="button"
						className="p-2 transition-opacity duration-150 ease-out"
						style={{ opacity: 0.7 }}
					>
						<X size={16} style={{ color: theme.textMuted }} />
					</button>
				</Column>
				<Column heading="After">
					<Button variant="icon">
						<X size={18} style={{ color: theme.textMuted }} />
					</Button>
					<Button variant="icon">
						<X size={18} style={{ color: theme.textMuted }} />
					</Button>
					<Button variant="icon">
						<X size={16} style={{ color: theme.textMuted }} />
					</Button>
				</Column>
			</Row>

			{/* ── Icon nav — prev/next/close from song detail ── */}
			<Row label="Icon · md — nav arrows (Nav.tsx)">
				<Column heading="Before">
					{/* Nav.tsx — active:scale-[0.9], disabled:opacity-30 */}
					<button
						type="button"
						className="p-1.5 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30"
						style={{ color: theme.textMuted }}
					>
						<CaretLeft size={20} weight="bold" />
					</button>
					<button
						type="button"
						className="p-1.5 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30"
						style={{ color: theme.textMuted }}
					>
						<CaretRight size={20} weight="bold" />
					</button>
					<button
						type="button"
						disabled
						className="p-1.5 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30"
						style={{ color: theme.textMuted }}
					>
						<CaretLeft size={20} weight="bold" />
					</button>
				</Column>
				<Column heading="After">
					<Button variant="icon" style={{ color: theme.textMuted }}>
						<CaretLeft size={20} weight="bold" />
					</Button>
					<Button variant="icon" style={{ color: theme.textMuted }}>
						<CaretRight size={20} weight="bold" />
					</Button>
					<Button variant="icon" disabled style={{ color: theme.textMuted }}>
						<CaretLeft size={20} weight="bold" />
					</Button>
				</Column>
			</Row>

			{/* ── Icon sm ── */}
			<Row label="Icon · sm — compact icon buttons">
				<Column heading="Before">
					{/* UnlockConfirmDialog close — border-0 bg-transparent */}
					<button
						type="button"
						className="theme-text-muted cursor-pointer border-0 bg-transparent"
					>
						<X size={16} style={{ color: theme.textMuted }} />
					</button>
				</Column>
				<Column heading="After">
					<Button variant="icon" size="sm">
						<X size={16} style={{ color: theme.textMuted }} />
					</Button>
				</Column>
			</Row>

			{/* ── Dialog composition ── */}
			<Row label="Dialog — composed primary + secondary + ghost">
				<Column heading="Before">
					<div
						className="flex flex-col items-start gap-3 p-6"
						style={{
							background: theme.surface,
							border: `1px solid ${theme.border}`,
						}}
					>
						<div className="flex gap-3">
							<button
								type="button"
								className="theme-border-color theme-text cursor-pointer border px-4 py-2 text-sm transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
							>
								Cancel
							</button>
							<button
								type="button"
								className="theme-primary-action cursor-pointer rounded-full px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
							>
								Unlock
							</button>
						</div>
						<button
							type="button"
							className="theme-text-muted mt-2 cursor-pointer border-0 bg-transparent px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-70 active:scale-[0.98]"
						>
							Not now
						</button>
					</div>
				</Column>
				<Column heading="After">
					<div
						className="flex flex-col items-start gap-3 p-6"
						style={{
							background: theme.surface,
							border: `1px solid ${theme.border}`,
						}}
					>
						<div className="flex gap-3">
							<Button variant="secondary">Cancel</Button>
							<Button className="rounded-full">Unlock</Button>
						</div>
						<Button variant="ghost">Not now</Button>
					</div>
				</Column>
			</Row>
		</div>
	);
};
SideBySide.meta = {
	description:
		"Complete side-by-side comparison of hand-rolled button classes (before) vs the unified Button component (after). Notes on shape/timing changes marked with △.",
};

function Separator() {
	const theme = useTheme();
	return (
		<div
			className="my-10"
			style={{ borderTop: `1px solid ${theme.border}`, opacity: 0.3 }}
		/>
	);
}

function Group({
	label,
	reason,
	children,
}: {
	label: string;
	reason: string;
	children: React.ReactNode;
}) {
	const theme = useTheme();
	return (
		<div>
			<p
				className="text-xs uppercase tracking-widest"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					marginBottom: 4,
				}}
			>
				{label}
			</p>
			<p
				className="text-xxs"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					marginBottom: 16,
					opacity: 0.5,
					maxWidth: 640,
					lineHeight: 1.5,
				}}
			>
				{reason}
			</p>
			{children}
		</div>
	);
}

export const NotMigrated: Story = () => {
	const theme = useTheme();

	return (
		<div style={{ padding: 48, maxWidth: 960, fontFamily: fonts.body }}>
			<h1
				className="text-2xl font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Buttons — <span className="italic">Not Migrated</span>
			</h1>
			<p className="mb-12 mt-2 text-xs" style={{ color: theme.textMuted }}>
				Buttons that stay hand-rolled. Two groups now covered by the new{" "}
				<code
					className="rounded px-1 py-0.5 text-xxs"
					style={{ background: theme.surface }}
				>
					link
				</code>{" "}
				variant (before / after), the rest are truly custom.
			</p>

			{/* ═══════════════════════════════════════════════════════ */}
			{/* CAN MIGRATE — link variant                             */}
			{/* ═══════════════════════════════════════════════════════ */}

			<Group
				label="Navigation text links — 8 buttons · now link variant"
				reason='Onboarding "Continue →", "Next Song →", "Back to Home →", "Start over →", error "Try again →". All share: theme-text, inline-flex, gap-3, group-hover arrow translation. The link md variant normalizes cursor, hover:opacity-70, active:scale, and disabled:opacity.'
			>
				<div className="flex items-start gap-12">
					<Column heading="Before">
						{/* WelcomeStep — border border-transparent px-4 py-2 */}
						<button
							type="button"
							className="theme-text group inline-flex min-h-11 cursor-pointer items-center gap-3 border border-transparent px-4 py-2 transition-opacity duration-150 active:scale-[0.98] disabled:opacity-50"
							style={{ fontFamily: fonts.body }}
						>
							<span className="text-lg font-medium tracking-wide">
								Let&apos;s go
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</button>
						{/* PickColorStep — sm:mt-20 */}
						<button
							type="button"
							className="theme-text group inline-flex min-h-11 cursor-pointer items-center gap-3"
							style={{ fontFamily: fonts.body }}
						>
							<span className="text-lg font-medium tracking-wide">
								Continue
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</button>
						{/* MatchesSection — transition-transform duration-100 */}
						<button
							type="button"
							className="theme-text group inline-flex items-center gap-3 transition-transform duration-100 active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
						>
							<span className="text-base font-medium tracking-wide">
								Next Song
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</button>
						{/* CompletionScreen */}
						<button
							type="button"
							className="theme-text group inline-flex items-center gap-3 transition-transform duration-100 active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
						>
							<span className="text-base font-medium tracking-wide">
								Back to Home
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</button>
						{/* PlanSelectionStep — text-xl */}
						<button
							type="button"
							className="theme-text group inline-flex min-h-11 cursor-pointer items-center gap-3"
							style={{ fontFamily: fonts.body }}
						>
							<span className="text-xl font-medium tracking-wide">
								Start Exploring
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</button>
					</Column>
					<Column heading="After">
						<Button variant="link" style={{ fontFamily: fonts.body }}>
							<span className="text-lg font-medium tracking-wide">
								Let&apos;s go
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</Button>
						<Button variant="link" style={{ fontFamily: fonts.body }}>
							<span className="text-lg font-medium tracking-wide">
								Continue
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</Button>
						<Button variant="link" style={{ fontFamily: fonts.body }}>
							<span className="text-base font-medium tracking-wide">
								Next Song
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</Button>
						<Button variant="link" style={{ fontFamily: fonts.body }}>
							<span className="text-base font-medium tracking-wide">
								Back to Home
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</Button>
						<Button variant="link" style={{ fontFamily: fonts.body }}>
							<span className="text-xl font-medium tracking-wide">
								Start Exploring
							</span>
							<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
								→
							</span>
						</Button>
					</Column>
				</div>
			</Group>

			<Separator />

			<Group
				label="Inline text actions — 6 buttons · now link sm variant"
				reason='"Sync", "Refresh", "Retry confirmation", "Choose a different plan", "Select all", "Skip for now". The link sm variant normalizes cursor, hover:opacity-70, and transition timing. Color overrides via className (theme-primary, theme-text-muted).'
			>
				<div className="flex items-start gap-12">
					<Column heading="Before">
						{/* DashboardHeader */}
						<button
							type="button"
							className="theme-text cursor-pointer text-xs font-medium tracking-widest uppercase transition-opacity hover:opacity-70"
							style={{ fontFamily: fonts.body }}
						>
							Sync
						</button>
						{/* match.tsx */}
						<button
							type="button"
							className="theme-primary cursor-pointer text-xs font-medium tracking-widest uppercase transition-opacity hover:opacity-70"
							style={{ fontFamily: fonts.body }}
						>
							Refresh
						</button>
						{/* PlanSelectionStep retry */}
						<button
							type="button"
							className="theme-primary cursor-pointer text-sm font-medium tracking-wide"
							style={{ fontFamily: fonts.body }}
						>
							Retry confirmation
						</button>
						{/* PlanSelectionStep choose different */}
						<button
							type="button"
							className="theme-text-muted cursor-pointer text-sm font-medium tracking-wide"
							style={{ fontFamily: fonts.body }}
						>
							Choose a different plan
						</button>
						{/* FlagPlaylistsStep */}
						<button
							type="button"
							className="theme-text-muted min-h-11 cursor-pointer text-sm underline"
							style={{ fontFamily: fonts.body }}
						>
							Select all
						</button>
						{/* FlagPlaylistsStep */}
						<button
							type="button"
							className="theme-text-muted min-h-11 cursor-pointer text-sm underline"
							style={{ fontFamily: fonts.body }}
						>
							Skip for now
						</button>
					</Column>
					<Column heading="After">
						<Button variant="link" size="sm" style={{ fontFamily: fonts.body }}>
							Sync
						</Button>
						<Button
							variant="link"
							size="sm"
							className="theme-primary"
							style={{ fontFamily: fonts.body }}
						>
							Refresh
						</Button>
						<Button
							variant="link"
							size="sm"
							className="theme-primary text-sm tracking-wide"
							style={{ fontFamily: fonts.body }}
						>
							Retry confirmation
						</Button>
						<Button
							variant="link"
							size="sm"
							className="theme-text-muted text-sm tracking-wide"
							style={{ fontFamily: fonts.body }}
						>
							Choose a different plan
						</Button>
						<Button
							variant="link"
							size="sm"
							className="theme-text-muted min-h-11 text-sm underline"
							style={{ fontFamily: fonts.body }}
						>
							Select all
						</Button>
						<Button
							variant="link"
							size="sm"
							className="theme-text-muted min-h-11 text-sm underline"
							style={{ fontFamily: fonts.body }}
						>
							Skip for now
						</Button>
					</Column>
				</div>
			</Group>

			<Separator />

			<Group
				label="Content cards — 4 buttons · now card variant"
				reason="PaywallCTA (Song Pack, Backstage Pass, 3-Month) and PlanSelectionStep PlanCard. The card variant normalizes rounded-lg, border, hover:bg-white/15, active:scale, and disabled states. PlanCard's px-6 py-5 normalized to px-4 py-3."
			>
				<div className="flex items-start gap-12">
					<Column heading="Before">
						<div
							className="flex w-full flex-col gap-3"
							style={{ maxWidth: 300 }}
						>
							<button
								type="button"
								className="theme-border-color w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
								style={{ fontFamily: fonts.body }}
							>
								<div className="flex items-baseline justify-between">
									<span className="theme-text text-sm font-medium">
										Song Pack
										<span className="theme-text-muted ml-1 font-normal">
											· 500 songs
										</span>
									</span>
									<span className="theme-text-muted shrink-0 text-xs">
										$5.99
									</span>
								</div>
							</button>
							{/* PlanCard — was px-6 py-5, transition-opacity, no hover bg */}
							<button
								type="button"
								className="group flex w-full cursor-pointer items-center justify-between rounded-lg border px-6 py-5 text-left transition-opacity"
								style={{
									fontFamily: fonts.body,
									borderColor: theme.primary,
								}}
							>
								<div>
									<p className="theme-text text-sm font-medium tracking-wide">
										Free
									</p>
									<p className="theme-text-muted mt-1 text-xs">
										50 songs to explore
									</p>
								</div>
								<span
									className="theme-text text-lg font-light"
									style={{ fontFamily: fonts.display }}
								>
									$0
								</span>
							</button>
						</div>
					</Column>
					<Column heading="After">
						<div
							className="flex w-full flex-col gap-3"
							style={{ maxWidth: 300 }}
						>
							<Button variant="card" style={{ fontFamily: fonts.body }}>
								<div className="flex items-baseline justify-between">
									<span className="theme-text text-sm font-medium">
										Song Pack
										<span className="theme-text-muted ml-1 font-normal">
											· 500 songs
										</span>
									</span>
									<span className="theme-text-muted shrink-0 text-xs">
										$5.99
									</span>
								</div>
							</Button>
							<Button variant="card" style={{ fontFamily: fonts.body }}>
								<div className="flex items-center justify-between">
									<div>
										<p className="theme-text text-sm font-medium tracking-wide">
											Free
										</p>
										<p className="theme-text-muted mt-1 text-xs">
											50 songs to explore
										</p>
									</div>
									<span
										className="theme-text text-lg font-light"
										style={{ fontFamily: fonts.display }}
									>
										$0
									</span>
								</div>
							</Button>
						</div>
					</Column>
				</div>
			</Group>

			<Separator />

			{/* ═══════════════════════════════════════════════════════ */}
			{/* TRULY NOT MIGRATED                                     */}
			{/* ═══════════════════════════════════════════════════════ */}

			<p
				className="mb-8 text-xs uppercase tracking-widest"
				style={{ color: theme.primary, fontFamily: fonts.body, opacity: 0.6 }}
			>
				Truly custom — stays hand-rolled
			</p>

			<Group
				label="Selection controls — 5 buttons"
				reason="SettingsPage theme swatches (4 colors with dynamic inline border/background per swatch, scale-on-hover), PickColorStep onboarding swatches (similar pattern with focus ring), ReleaseToggle (boolean toggle with sliding thumb)."
			>
				<div className="flex items-center gap-6">
					{(["rose", "blue", "green", "lavender"] as const).map((color) => (
						<button
							key={color}
							type="button"
							className="group flex cursor-pointer flex-col items-center gap-2 disabled:cursor-wait"
							aria-label={`Select ${color} theme`}
						>
							<div
								className="size-12 rounded-full transition-transform duration-150 group-hover:scale-[1.05] group-active:scale-[0.98]"
								style={{
									background:
										color === "rose"
											? "hsl(350, 50%, 25%)"
											: color === "blue"
												? "hsl(220, 50%, 25%)"
												: color === "green"
													? "hsl(150, 40%, 20%)"
													: "hsl(270, 40%, 25%)",
									border:
										color === "blue"
											? `2px solid ${theme.text}`
											: "2px solid transparent",
								}}
							/>
							<span
								className={`${color === "blue" ? "theme-text font-medium" : "theme-text-muted font-normal"} text-xs tracking-widest uppercase transition-colors duration-150`}
								style={{ fontFamily: fonts.body }}
							>
								{color}
							</span>
						</button>
					))}
				</div>
				<div className="mt-4 flex items-center gap-3">
					<button
						type="button"
						className="relative h-6 w-11 rounded-full transition-colors duration-200"
						style={{ background: theme.border }}
					>
						<span
							className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform"
							style={{ transform: "translateX(0px)" }}
						/>
					</button>
					<span
						className="theme-text-muted text-xs"
						style={{ fontFamily: fonts.body }}
					>
						off
					</span>
					<button
						type="button"
						className="relative h-6 w-11 rounded-full transition-colors duration-200"
						style={{ background: theme.primary }}
					>
						<span
							className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform"
							style={{ transform: "translateX(20px)" }}
						/>
					</button>
					<span
						className="theme-text-muted text-xs"
						style={{ fontFamily: fonts.body }}
					>
						on
					</span>
				</div>
			</Group>

			<Separator />

			<Group
				label="Color-computed — 4 buttons"
				reason="PanelContent 'See where this song belongs' (bg/color from album art extraction), HorizontalJourney step dots and prev/next arrows (all colors via inline style, not CSS tokens)."
			>
				<div className="flex items-center gap-6">
					<button
						type="button"
						className="text-sm"
						style={{
							width: 280,
							padding: "14px 20px",
							color: theme.bg,
							background: theme.primary,
							fontFamily: fonts.body,
						}}
					>
						See where this song belongs
					</button>
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							style={{
								color: theme.textMuted,
								background: "none",
								border: "none",
								cursor: "pointer",
								fontSize: 18,
								padding: 4,
							}}
						>
							‹
						</button>
						{[0, 1, 2, 3].map((i) => (
							<button
								key={i}
								type="button"
								aria-label={`Step ${i + 1}`}
								style={{
									width: 8,
									height: 8,
									borderRadius: "100%",
									background: i === 1 ? theme.text : theme.border,
									border: "none",
									cursor: "pointer",
									padding: 0,
								}}
							/>
						))}
						<button
							type="button"
							style={{
								color: theme.textMuted,
								background: "none",
								border: "none",
								cursor: "pointer",
								fontSize: 18,
								padding: 4,
							}}
						>
							›
						</button>
					</div>
				</div>
			</Group>

			<Separator />

			<Group
				label="Interactive rows — 2 buttons"
				reason="SongCard (full-width row with -mx-3 bleed, dual click handlers, data attributes for keyboard nav, inline --hover-bg CSS var from theme). PlaylistMatchRow 'Add' (reveal-on-hover text with inline color/fontFamily from parent context)."
			>
				<button
					type="button"
					className="song-card -mx-3 flex w-full cursor-pointer items-center gap-4 border-0 bg-transparent px-3 py-4 text-left transition-transform duration-100 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						maxWidth: 400,
						position: "relative",
					}}
				>
					<div
						className="size-12 shrink-0"
						style={{ background: theme.surface }}
					/>
					<div className="min-w-0 flex-1">
						<p
							className="theme-text truncate text-sm"
							style={{ fontFamily: fonts.body, fontWeight: 300 }}
						>
							Midnight City
						</p>
						<p
							className="theme-text-muted truncate text-xs"
							style={{ fontFamily: fonts.body }}
						>
							M83 · Hurry Up, We&apos;re Dreaming
						</p>
					</div>
					<span
						className="text-xs tracking-widest uppercase"
						style={{ color: theme.primary, fontFamily: fonts.body }}
					>
						Add
					</span>
				</button>
			</Group>

			<Separator />

			<Group
				label="Auth boundary — 2 buttons"
				reason="login.tsx 'Continue with Google' (light-theme: bg-white, text-neutral-800, border-neutral-200, hover:bg-neutral-50). logout.tsx 'Confirm Logout' (destructive: bg-red-600, hover:bg-red-700). Both completely outside the --t-* token system."
			>
				<div className="flex items-center gap-4">
					<button
						type="button"
						className="flex cursor-pointer items-center justify-center gap-3 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-800 transition-[background-color,transform] duration-150 hover:bg-neutral-50 active:scale-[0.98] disabled:opacity-50"
						style={{ fontFamily: fonts.body }}
					>
						Continue with Google
					</button>
					<button
						type="button"
						className="cursor-pointer rounded-md bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
						style={{ fontFamily: fonts.body }}
					>
						Confirm Logout
					</button>
				</div>
			</Group>
		</div>
	);
};
NotMigrated.meta = {
	description:
		"Non-migrated buttons: link variant candidates (before/after) and truly custom buttons grouped by reason.",
};
