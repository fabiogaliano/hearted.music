type ButtonVariant =
	| "primary"
	| "secondary"
	| "ghost"
	| "surface"
	| "icon"
	| "link"
	| "card";
type ButtonSize = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	ref?: React.Ref<HTMLButtonElement>;
	variant?: ButtonVariant;
	size?: ButtonSize;
}

const base = "cursor-pointer active:scale-[0.98] disabled:cursor-not-allowed";

const variantClasses: Record<ButtonVariant, Record<ButtonSize, string>> = {
	primary: {
		md: "theme-primary-action px-5 py-2 text-sm tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 disabled:opacity-40",
		sm: "theme-primary-action px-3 py-1.5 text-xs tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 disabled:opacity-40",
	},
	// The raised chip in its rectangular form. The old hover was a flat
	// `bg-white/15` wash, which has nothing to lift off on the light themes — it
	// only ever read in dark mode. chip-raised derives from --t-surface, so it
	// works in every palette, and it drops the hairline that was carrying the
	// shape.
	secondary: {
		md: "theme-text chip-raised chip-raised-hover squircle focus-edge rounded-[10px] px-4 py-2 text-sm disabled:opacity-50",
		sm: "theme-text chip-raised chip-raised-hover squircle focus-edge rounded-[10px] px-3 py-1.5 text-xs tracking-widest uppercase disabled:opacity-50",
	},
	ghost: {
		md: "theme-text-muted text-sm tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-70 disabled:opacity-50",
		sm: "theme-text-muted text-xs tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-70 disabled:opacity-50",
	},
	// The raised-material pill. focus-edge lives in the variant rather than at each
	// call site so every consumer gets a ring that follows the squircle, instead of
	// an `outline` drawing a plain rounded rect just off the shape.
	surface: {
		md: "chip-raised chip-raised-hover squircle focus-edge rounded-full px-3 py-1.5 text-xs tracking-widest uppercase",
		sm: "chip-raised chip-raised-hover squircle focus-edge rounded-full px-3 py-1.5 text-xs tracking-widest uppercase",
	},
	icon: {
		md: "p-1.5 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30",
		sm: "p-1 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30",
	},
	link: {
		md: "theme-text group inline-flex min-h-11 items-center gap-3 transition-[transform,opacity] duration-150 hover:opacity-70 disabled:opacity-50",
		sm: "theme-text text-xs font-medium tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-70 disabled:opacity-50",
	},
	// A full-width pressable plane, so it takes the plane tier rather than the
	// chip tier — same reason a dashboard CTA does: the identical offset reads
	// much louder over a card-sized area than over a pill.
	card: {
		md: "surface-raised surface-raised-hover squircle focus-edge w-full rounded-[14px] px-4 py-3 text-left disabled:opacity-50",
		sm: "surface-raised surface-raised-hover squircle focus-edge w-full rounded-[14px] px-4 py-3 text-left disabled:opacity-50",
	},
};

export function Button({
	variant = "primary",
	size = "md",
	className,
	ref,
	...props
}: ButtonProps) {
	const variantClass = variantClasses[variant][size];
	const baseClass =
		variant === "icon" || variant === "link"
			? "cursor-pointer disabled:cursor-not-allowed"
			: base;
	const classes = className
		? `${baseClass} ${variantClass} ${className}`
		: `${baseClass} ${variantClass}`;

	return <button ref={ref} type="button" className={classes} {...props} />;
}
