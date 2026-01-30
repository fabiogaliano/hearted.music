import { cn } from "@/lib/shared/utils/utils";

/**
 * Kbd component for displaying keyboard shortcuts.
 *
 * Supports theming via CSS custom properties when wrapped in a container that sets:
 * - `--kbd-text-color`: Text color
 * - `--kbd-bg-color`: Background color
 * - `--kbd-border-color`: Border color
 *
 * Falls back to Tailwind's muted colors when custom properties aren't set.
 */
function Kbd({ className, style, ...props }: React.ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			className={cn(
				"bg-muted text-muted-foreground pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm border border-transparent px-1 font-sans text-xs font-medium select-none",
				"[&_svg:not([class*='size-'])]:size-3",
				"in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10",
				className,
			)}
			style={{
				color: "var(--kbd-text-color)",
				backgroundColor: "var(--kbd-bg-color)",
				borderColor: "var(--kbd-border-color)",
				...style,
			}}
			{...props}
		/>
	);
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<kbd
			data-slot="kbd-group"
			className={cn("inline-flex items-center gap-1", className)}
			{...props}
		/>
	);
}

export { Kbd, KbdGroup };
