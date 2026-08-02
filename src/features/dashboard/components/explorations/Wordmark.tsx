import { fonts } from "@/lib/theme/fonts";

interface WordmarkProps {
	/** "lg" is the sidebar's brand-mark scale — the main page simply says
	 * "hearted."; spokes shrink it to a quiet way home. */
	size: "lg" | "md";
	onHome: () => void;
}

export function Wordmark({ size, onHome }: WordmarkProps) {
	return (
		<button
			type="button"
			onClick={onHome}
			className={`focus-edge-offset theme-text font-extralight tracking-tight ${
				size === "lg" ? "text-4xl" : "text-2xl"
			}`}
			style={{ fontFamily: fonts.display }}
		>
			hearted.
		</button>
	);
}
