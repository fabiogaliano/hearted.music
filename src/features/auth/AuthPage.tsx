import type { CSSProperties } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";

// The login/forgot/reset/verify routes live OUTSIDE _authenticated, so they
// don't inherit the user's theme. Match the unauthenticated treatment used by
// __root.tsx's error/404 screens: rose tokens applied locally as CSS vars so
// every `theme-*` utility resolves to the brand palette.
const roseThemeStyle: CSSProperties & Record<string, string> = {
	"--t-bg": themes.rose.bg,
	"--t-surface": themes.rose.surface,
	"--t-surface-dim": themes.rose.surfaceDim,
	"--t-border": themes.rose.border,
	"--t-text": themes.rose.text,
	"--t-text-muted": themes.rose.textMuted,
	"--t-text-on-primary": themes.rose.textOnPrimary,
	"--t-primary": themes.rose.primary,
	"--t-primary-hover": themes.rose.primaryHover,
};

export const AUTH_ERROR_COLOR = "hsl(0, 35%, 32%)";

type AuthPageProps = {
	headline?: React.ReactNode;
	intro?: React.ReactNode;
	children: React.ReactNode;
	footer?: React.ReactNode;
};

export function AuthPage({ headline, intro, children, footer }: AuthPageProps) {
	return (
		<div
			className="theme-bg theme-text flex min-h-[100dvh] flex-col items-center px-6 pt-32 pb-12 md:pt-[28vh]"
			style={roseThemeStyle}
		>
			<div className="w-full max-w-[440px]" style={{ fontFamily: fonts.body }}>
				<div className={headline || intro ? "mb-12" : "mb-16"}>
					<span
						className="theme-text inline-block text-4xl leading-none font-extralight tracking-tight"
						style={{ fontFamily: fonts.display }}
					>
						hearted.
					</span>
				</div>

				{headline && (
					<h1
						className="theme-text text-3xl leading-tight font-extralight md:text-4xl"
						style={{ fontFamily: fonts.display }}
					>
						{headline}
					</h1>
				)}
				{intro ? (
					<p className="theme-text-muted mt-3 mb-10 text-base">{intro}</p>
				) : headline ? (
					<div className="mb-10" />
				) : null}

				{children}

				{footer && (
					<div className="theme-text-muted mt-10 text-sm">{footer}</div>
				)}
			</div>
		</div>
	);
}

type AuthInlineLinkProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function AuthInlineLink({ className, ...rest }: AuthInlineLinkProps) {
	return (
		<button
			type="button"
			className={`theme-text cursor-pointer underline underline-offset-4 transition-opacity duration-200 hover:opacity-70 disabled:cursor-not-allowed ${className ?? ""}`}
			style={{ fontFamily: fonts.body }}
			{...rest}
		/>
	);
}

type AuthFieldProps = {
	label: string;
	htmlFor: string;
	value: string;
	onChange: (next: string) => void;
	type?: string;
	autoComplete?: string;
	required?: boolean;
	disabled?: boolean;
	minLength?: number;
	helper?: string;
	rightSlot?: React.ReactNode;
	inputRef?: React.Ref<HTMLInputElement>;
};

export function AuthField({
	label,
	htmlFor,
	value,
	onChange,
	type = "text",
	autoComplete,
	required,
	disabled,
	minLength,
	helper,
	rightSlot,
	inputRef,
}: AuthFieldProps) {
	return (
		<div>
			<div className="mb-2 flex items-baseline justify-between gap-3">
				<label
					htmlFor={htmlFor}
					className="theme-text-muted text-[11px] tracking-widest uppercase"
				>
					{label}
				</label>
				{rightSlot}
			</div>
			<input
				id={htmlFor}
				name={htmlFor}
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				autoComplete={autoComplete}
				required={required}
				disabled={disabled}
				minLength={minLength}
				ref={inputRef}
				className="theme-surface-bg theme-border-color theme-text w-full rounded-sm border px-3 py-2.5 text-base outline-none transition-[border-color,opacity] duration-200 focus:outline-none disabled:opacity-50"
				style={{ fontFamily: fonts.body }}
			/>
			{helper && <p className="theme-text-muted mt-2 text-[11px]">{helper}</p>}
		</div>
	);
}

type AuthButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "primary" | "secondary";
};

export function AuthButton({
	variant = "primary",
	className,
	...rest
}: AuthButtonProps) {
	const variantClass =
		variant === "primary"
			? "theme-primary-action"
			: "theme-border-color theme-text border theme-surface-bg";
	return (
		<button
			type="button"
			className={`${variantClass} w-full cursor-pointer rounded-sm px-4 py-3 text-xs tracking-widest uppercase transition-[opacity,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
			style={{ fontFamily: fonts.body }}
			{...rest}
		/>
	);
}

type AuthMessageProps = {
	tone: "error" | "info";
	children: React.ReactNode;
};

export function AuthMessage({ tone, children }: AuthMessageProps) {
	return (
		<p
			role={tone === "error" ? "alert" : "status"}
			className="text-sm"
			style={{
				color: tone === "error" ? AUTH_ERROR_COLOR : "var(--t-text-muted)",
				fontFamily: fonts.body,
			}}
		>
			{children}
		</p>
	);
}
