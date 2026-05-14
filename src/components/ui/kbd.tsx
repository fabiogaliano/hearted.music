import { cn } from "@/lib/shared/utils/utils";

function Kbd({ className, style, ...props }: React.ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			className={cn(
				"pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm border px-1 font-sans text-xs font-medium select-none",
				"[&_svg:not([class*='size-'])]:size-3",
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
