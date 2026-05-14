import { forwardRef } from "react";

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
	variant?: ButtonVariant;
	size?: ButtonSize;
}

const base = "cursor-pointer active:scale-[0.98] disabled:cursor-not-allowed";

const variantClasses: Record<ButtonVariant, Record<ButtonSize, string>> = {
	primary: {
		md: "theme-primary-action px-5 py-2 text-sm tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 disabled:opacity-40",
		sm: "theme-primary-action px-3 py-1.5 text-xs tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 disabled:opacity-40",
	},
	secondary: {
		md: "theme-border-color theme-text border px-4 py-2 text-sm transition-[transform,background-color] duration-150 hover:bg-white/15 disabled:opacity-50",
		sm: "theme-border-color theme-text border px-3 py-1.5 text-xs tracking-widest uppercase transition-[transform,background-color] duration-150 hover:bg-white/15 disabled:opacity-50",
	},
	ghost: {
		md: "theme-text-muted text-sm tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-70 disabled:opacity-50",
		sm: "theme-text-muted text-xs tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-70 disabled:opacity-50",
	},
	surface: {
		md: "hover-border-brighten rounded-full px-3 py-1.5 text-xs tracking-widest uppercase",
		sm: "hover-border-brighten rounded-full px-3 py-1.5 text-xs tracking-widest uppercase",
	},
	icon: {
		md: "p-1.5 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30",
		sm: "p-1 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30",
	},
	link: {
		md: "theme-text group inline-flex min-h-11 items-center gap-3 transition-[transform,opacity] duration-150 hover:opacity-70 disabled:opacity-50",
		sm: "theme-text text-xs font-medium tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-70 disabled:opacity-50",
	},
	card: {
		md: "theme-border-color w-full rounded-lg border px-4 py-3 text-left transition-[transform,background-color] duration-150 hover:bg-white/15 disabled:opacity-50",
		sm: "theme-border-color w-full rounded-lg border px-4 py-3 text-left transition-[transform,background-color] duration-150 hover:bg-white/15 disabled:opacity-50",
	},
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ variant = "primary", size = "md", className, ...props }, ref) => {
		const variantClass = variantClasses[variant][size];
		// icon variant has its own scale
		const baseClass =
			variant === "icon" || variant === "link"
				? "cursor-pointer disabled:cursor-not-allowed"
				: base;
		const classes = className
			? `${baseClass} ${variantClass} ${className}`
			: `${baseClass} ${variantClass}`;

		return <button ref={ref} type="button" className={classes} {...props} />;
	},
);
