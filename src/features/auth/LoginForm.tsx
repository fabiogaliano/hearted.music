import {
	CaretDownIcon,
	CaretUpIcon,
	EnvelopeSimpleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
	AuthButton,
	AuthField,
	AuthInlineLink,
	AuthMessage,
	AuthPage,
} from "@/features/auth/AuthPage";
import { fonts } from "@/lib/theme/fonts";

export type LoginMode = "signin" | "signup";
type Panel = "choice" | "credentials";

export type SubmitHandler = (args: {
	mode: LoginMode;
	email: string;
	password: string;
	name: string;
}) => Promise<void> | void;

type LoadingState = "google" | "credentials" | null;

type LoginFormProps = {
	mode: LoginMode;
	onModeChange: (next: LoginMode) => void;
	onSubmit: SubmitHandler;
	onGoogle: () => Promise<void> | void;
	onForgotPassword: () => void;
	error: string | null;
	notice: string | null;
	loading: LoadingState;
	initialPanel?: Panel;
};

// Bar movement = on-screen element relocating → ease-in-out (skill rule).
// Google + form blocks enter/exit → ease-out.
const EASE_IN_OUT_CUBIC: [number, number, number, number] = [
	0.645, 0.045, 0.355, 1,
];
const EASE_OUT_CUBIC: [number, number, number, number] = [
	0.215, 0.61, 0.355, 1,
];

// Durations are intentionally above the 300ms UI ceiling. Login expand is a
// rare interaction (the skill explicitly allows longer durations for "rarely-
// used interactions where delight adds value"); the calm pacing is the point.
const DUR_PRIMARY = 0.48; // bar move + Google grow/fade-in (close)
const DUR_FORM_IN = 0.36;
const DUR_FORM_OUT = 0.16;
const DUR_GOOGLE_OUT = 0.12;
const FORM_FADE_DELAY = 0.2;

export function LoginForm({
	mode,
	onModeChange,
	onSubmit,
	onGoogle,
	onForgotPassword,
	error,
	notice,
	loading,
	initialPanel = "choice",
}: LoginFormProps) {
	const [panel, setPanel] = useState<Panel>(initialPanel);
	const isBusy = loading !== null;
	const isGoogleCommitted = loading === "google";
	const reduceMotion = useReducedMotion() ?? false;

	const barTransition = reduceMotion
		? { duration: 0 }
		: { duration: DUR_PRIMARY, ease: EASE_IN_OUT_CUBIC };
	const googleEnterTransition = reduceMotion
		? { duration: 0 }
		: { duration: DUR_PRIMARY, ease: EASE_OUT_CUBIC };
	const googleExitTransition = reduceMotion
		? { duration: 0 }
		: { duration: DUR_GOOGLE_OUT, ease: EASE_OUT_CUBIC };
	const formEnterTransition = reduceMotion
		? { duration: 0 }
		: {
				duration: DUR_FORM_IN,
				ease: EASE_OUT_CUBIC,
				delay: FORM_FADE_DELAY,
			};
	const formExitTransition = reduceMotion
		? { duration: 0 }
		: { duration: DUR_FORM_OUT, ease: EASE_OUT_CUBIC };

	const footer =
		panel === "credentials" ? (
			<>
				{mode === "signup" ? "Already have an account? " : "New here? "}
				<AuthInlineLink
					onClick={() => onModeChange(mode === "signup" ? "signin" : "signup")}
					disabled={isBusy}
				>
					{mode === "signup" ? "Sign in" : "Create an account"}
				</AuthInlineLink>
			</>
		) : undefined;

	return (
		<AuthPage footer={footer}>
			<div className="space-y-6">
				<AnimatePresence initial={false} mode="popLayout">
					{panel === "choice" && (
						<motion.div
							key="google-block"
							initial={{ opacity: 0 }}
							animate={{
								opacity: 1,
								transition: googleEnterTransition,
							}}
							exit={{
								opacity: 0,
								transition: googleExitTransition,
							}}
						>
							<div className="space-y-6">
								<GoogleButton
									loading={loading}
									onClick={onGoogle}
									disabled={isBusy}
								/>
								{error && <AuthMessage tone="error">{error}</AuthMessage>}
								{!isGoogleCommitted && <OrDivider />}
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				{!isGoogleCommitted && (
					<motion.div layout transition={barTransition}>
						<ToggleBar
							panel={panel}
							disabled={isBusy}
							onClick={() =>
								setPanel(panel === "choice" ? "credentials" : "choice")
							}
						/>
					</motion.div>
				)}

				<AnimatePresence initial={false}>
					{panel === "credentials" && (
						<motion.div
							key="form-block"
							initial={{ opacity: 0 }}
							animate={{
								opacity: 1,
								transition: formEnterTransition,
							}}
							exit={{
								opacity: 0,
								transition: formExitTransition,
							}}
						>
							<CredentialsFields
								mode={mode}
								loading={loading}
								error={error}
								notice={notice}
								onSubmit={onSubmit}
								onForgotPassword={onForgotPassword}
							/>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</AuthPage>
	);
}

function GoogleButton({
	loading,
	onClick,
	disabled,
}: {
	loading: LoadingState;
	onClick: () => Promise<void> | void;
	disabled: boolean;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="theme-border-color theme-text theme-surface-bg relative flex w-full cursor-pointer items-center justify-center gap-3 rounded-sm border px-4 py-3.5 text-xs tracking-widest uppercase transition-[opacity,transform] duration-200 active:scale-[0.98] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
			style={{ fontFamily: fonts.body }}
		>
			<span className="absolute left-4 inline-flex">
				<GoogleIcon />
			</span>
			<span>
				{loading === "google" ? "Redirecting…" : "Continue with Google"}
			</span>
		</button>
	);
}

function OrDivider() {
	return (
		<div className="flex items-center gap-3">
			<span className="theme-border-bg h-px flex-1" />
			<span
				className="theme-text-muted text-[10px] tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				or
			</span>
			<span className="theme-border-bg h-px flex-1" />
		</div>
	);
}

function ToggleBar({
	panel,
	disabled,
	onClick,
}: {
	panel: Panel;
	disabled: boolean;
	onClick: () => void;
}) {
	const expanded = panel === "credentials";
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-expanded={expanded}
			className="theme-border-color theme-text theme-surface-bg group relative flex w-full cursor-pointer items-center justify-center gap-3 rounded-sm border px-4 py-3.5 text-xs tracking-widest uppercase transition-[opacity,transform] duration-200 active:scale-[0.98] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
			style={{ fontFamily: fonts.body }}
		>
			{!expanded && (
				<EnvelopeSimpleIcon
					size={16}
					weight="regular"
					className="absolute left-4"
				/>
			)}
			<span>{expanded ? "Use Google instead" : "Use email and password"}</span>
			{expanded ? (
				<CaretUpIcon
					size={12}
					weight="bold"
					className="absolute right-4 transition-transform duration-200 group-hover:-translate-y-0.5"
				/>
			) : (
				<CaretDownIcon
					size={12}
					weight="bold"
					className="absolute right-4 transition-transform duration-200 group-hover:translate-y-0.5"
				/>
			)}
		</button>
	);
}

function CredentialsFields({
	mode,
	loading,
	error,
	notice,
	onSubmit,
	onForgotPassword,
}: {
	mode: LoginMode;
	loading: LoadingState;
	error: string | null;
	notice: string | null;
	onSubmit: SubmitHandler;
	onForgotPassword: () => void;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const isBusy = loading !== null;
	const isSignup = mode === "signup";

	const nameRef = useRef<HTMLInputElement>(null);
	const emailRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const target = isSignup ? nameRef.current : emailRef.current;
		target?.focus();
	}, [isSignup]);

	return (
		<form
			className="space-y-4"
			onSubmit={async (e) => {
				e.preventDefault();
				await onSubmit({ mode, email, password, name });
			}}
		>
			{isSignup && (
				<AuthField
					label="Name"
					htmlFor="name"
					value={name}
					onChange={setName}
					autoComplete="name"
					disabled={isBusy}
					required
					inputRef={nameRef}
				/>
			)}

			<AuthField
				label="Email"
				htmlFor="email"
				type="email"
				value={email}
				onChange={setEmail}
				autoComplete="email"
				disabled={isBusy}
				required
				inputRef={emailRef}
			/>

			<AuthField
				label="Password"
				htmlFor="password"
				type="password"
				value={password}
				onChange={setPassword}
				autoComplete={isSignup ? "new-password" : "current-password"}
				disabled={isBusy}
				required
				minLength={isSignup ? 8 : undefined}
				helper={isSignup ? "8 characters minimum." : undefined}
				rightSlot={
					!isSignup ? (
						<button
							type="button"
							onClick={onForgotPassword}
							disabled={isBusy}
							className="theme-text-muted cursor-pointer text-[11px] tracking-widest uppercase transition-opacity duration-200 hover:opacity-70 disabled:cursor-not-allowed"
							style={{ fontFamily: fonts.body }}
						>
							Forgot?
						</button>
					) : null
				}
			/>

			{error && <AuthMessage tone="error">{error}</AuthMessage>}
			{notice && !error && <AuthMessage tone="info">{notice}</AuthMessage>}

			<AuthButton type="submit" disabled={isBusy}>
				{loading === "credentials"
					? isSignup
						? "Creating account…"
						: "Signing in…"
					: isSignup
						? "Create account"
						: "Continue"}
			</AuthButton>
		</form>
	);
}

function GoogleIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
			<path
				d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
				fill="#4285F4"
			/>
			<path
				d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
				fill="#34A853"
			/>
			<path
				d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
				fill="#FBBC05"
			/>
			<path
				d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
				fill="#EA4335"
			/>
		</svg>
	);
}
