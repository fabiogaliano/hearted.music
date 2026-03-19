import { useState } from "react";

import type { MatchingState } from "../types";

export function useMatchingState() {
	const [state] = useState<MatchingState>({
		songMetaVisible: true,
	});

	return { state };
}
