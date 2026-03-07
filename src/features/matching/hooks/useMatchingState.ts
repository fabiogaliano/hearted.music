import { useState } from "react";

import type { MatchingState } from "../types";

export function useMatchingState(totalSongs: number) {
	const [state, setState] = useState<MatchingState>({
		currentIndex: 0,
		addedTo: {},
		showMeaning: false,
		activeJourneyStep: 0,
		songMetaVisible: true,
	});

	const handleAdd = (playlistId: number, songId: number) => {
		setState((prev) => ({
			...prev,
			addedTo: {
				...prev.addedTo,
				[songId]: [...(prev.addedTo[songId] || []), playlistId],
			},
		}));
	};

	const handleNext = () => {
		setState((prev) => ({
			...prev,
			currentIndex: prev.currentIndex + 1,
			showMeaning: false,
			activeJourneyStep: 0,
		}));
	};

	const handleDismiss = () => {
		setState((prev) => ({
			...prev,
			currentIndex: prev.currentIndex + 1,
			showMeaning: false,
			activeJourneyStep: 0,
		}));
	};

	const handleShowDetails = () => {
		setState((prev) => ({
			...prev,
			songMetaVisible: false,
			showMeaning: true,
		}));
		requestAnimationFrame(() => {
			setState((prev) => ({
				...prev,
				songMetaVisible: true,
			}));
		});
	};

	const handleHideDetails = () => {
		setState((prev) => ({
			...prev,
			songMetaVisible: false,
			showMeaning: false,
		}));
		requestAnimationFrame(() => {
			setState((prev) => ({
				...prev,
				songMetaVisible: true,
			}));
		});
	};

	const handleJourneyStepHover = (index: number) => {
		setState((prev) => ({
			...prev,
			activeJourneyStep: index,
		}));
	};

	const handleReset = () => {
		setState({
			currentIndex: 0,
			addedTo: {},
			showMeaning: false,
			activeJourneyStep: 0,
			songMetaVisible: true,
		});
	};

	return {
		state,
		isComplete: state.currentIndex >= totalSongs,
		handleAdd,
		handleNext,
		handleDismiss,
		handleShowDetails,
		handleHideDetails,
		handleJourneyStepHover,
		handleReset,
	};
}
