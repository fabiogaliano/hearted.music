import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

interface CDCaseProps {
	/** Album art image URL (optional - shows placeholder if not provided) */
	src?: string | null;
	/** Alt text for the image */
	alt: string;
	/** Additional className for the container */
	className?: string;
	/** Hide the placeholder when no image is provided */
	hidePlaceholder?: boolean;
}

// Case dimensions
const CASE_WIDTH = 750;
const CASE_HEIGHT = 660;
const ART_X = 100;
const ART_Y = 10;
const ART_SIZE = 640;

// Pre-calculated percentages for album art positioning
const ART_LEFT_PERCENT = (ART_X / CASE_WIDTH) * 100;
const ART_TOP_PERCENT = (ART_Y / CASE_HEIGHT) * 100;
const ART_WIDTH_PERCENT = (ART_SIZE / CASE_WIDTH) * 100;
const ART_HEIGHT_PERCENT = (ART_SIZE / CASE_HEIGHT) * 100;

function CaseSVG() {
	const theme = useTheme();
	const frameColor = "#1A1A1A";
	const accentColor = theme.text;

	return (
		<svg
			width="750"
			height="660"
			viewBox="0 0 750 660"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="pointer-events-none absolute inset-0 h-full w-full"
			aria-hidden="true"
		>
			<rect
				x="0"
				y="0"
				width="750"
				height="660"
				rx="8"
				fill={frameColor}
				fillOpacity="0.05"
			/>

			<rect
				x="0.5"
				y="0.5"
				width="749"
				height="659"
				rx="8"
				stroke={frameColor}
				strokeOpacity="0.8"
				strokeWidth="2"
			/>

			<rect
				x="1"
				y="1"
				width="94"
				height="658"
				rx="6"
				fill={frameColor}
				fillOpacity="0.05"
			/>

			<line
				x1="95"
				y1="0"
				x2="95"
				y2="660"
				stroke={frameColor}
				strokeOpacity="0.8"
				strokeWidth="2"
			/>

			{[0, 1, 2, 3, 4].map((i) => (
				<line
					key={`top-${i}`}
					x1="18"
					y1={18 + i * 6}
					x2="78"
					y2={18 + i * 6}
					stroke={accentColor}
					strokeOpacity={0.35 - i * 0.05}
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			))}

			{[0, 1, 2, 3, 4].map((i) => (
				<line
					key={`bot-${i}`}
					x1="18"
					y1={612 + i * 6}
					x2="78"
					y2={612 + i * 6}
					stroke={accentColor}
					strokeOpacity={0.35 - i * 0.05}
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			))}

			<line
				x1="48"
				y1="60"
				x2="48"
				y2="600"
				stroke={accentColor}
				strokeOpacity="0.12"
				strokeWidth="1"
				strokeDasharray="2 8"
			/>

			<rect
				x="4"
				y="50"
				width="88"
				height="560"
				rx="3"
				fill="white"
				fillOpacity="0.03"
			/>

			<path
				d="M100 650 L280 10 H740 L560 650 H100 Z"
				fill="white"
				fillOpacity="0.02"
				style={{ mixBlendMode: "overlay" }}
			/>

			<line
				x1="100"
				y1="10"
				x2="740"
				y2="10"
				stroke="white"
				strokeOpacity="0.08"
				strokeWidth="1"
			/>

			<circle cx="108" cy="18" r="2" fill="white" fillOpacity="0.06" />
			<circle cx="732" cy="18" r="2" fill="white" fillOpacity="0.04" />
		</svg>
	);
}

export function CDCase({
	src,
	alt,
	className = "",
	hidePlaceholder = false,
}: CDCaseProps) {
	const showPlaceholder = !src && !hidePlaceholder;

	return (
		<div
			className={`relative ${className}`}
			style={{ aspectRatio: `${CASE_WIDTH} / ${CASE_HEIGHT}` }}
		>
			{src ? (
				<img
					src={src}
					alt={alt}
					className="absolute object-cover"
					style={{
						left: `${ART_LEFT_PERCENT}%`,
						top: `${ART_TOP_PERCENT}%`,
						width: `${ART_WIDTH_PERCENT}%`,
						height: `${ART_HEIGHT_PERCENT}%`,
					}}
				/>
			) : showPlaceholder ? (
				<div
					className="absolute"
					style={{
						left: `${ART_LEFT_PERCENT}%`,
						top: `${ART_TOP_PERCENT}%`,
						width: `${ART_WIDTH_PERCENT}%`,
						height: `${ART_HEIGHT_PERCENT}%`,
					}}
				>
					<AlbumPlaceholder />
				</div>
			) : null}

			<CaseSVG />
		</div>
	);
}
