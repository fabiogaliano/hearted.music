export interface AnalysisContent {
	headline?: string;
	compound_mood?: string;
	mood_description?: string;
	interpretation?: string;
	themes?: Array<{
		name: string;
		confidence?: number;
		description: string;
	}>;
	journey?: Array<{
		section: string;
		mood: string;
		description: string;
	}>;
	key_lines?: Array<{
		line: string;
		insight: string;
	}>;
	sonic_texture?: string;
	audio_features?: {
		tempo?: number;
		energy?: number;
		valence?: number;
		liveness?: number;
		loudness?: number;
		speechiness?: number;
		acousticness?: number;
		danceability?: number;
		instrumentalness?: number;
	};
}
