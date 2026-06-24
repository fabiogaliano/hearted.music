/**
 * GenreConfig — thin controlled wrapper around GenrePillsPicker.
 *
 * Drives the picker from draft state (value/onChange) and seeds it with
 * account top genres for quick-pick suggestions. The picker is already
 * fully controlled; we just wire it to the draft hook's genrePills state.
 */

import { useQuery } from "@tanstack/react-query";
import { GenrePillsPicker } from "@/features/playlists/components/GenrePillsPicker";
import { accountTopGenresQueryOptions } from "@/features/playlists/queries";

interface GenreConfigProps {
	accountId: string;
	value: string[];
	onChange: (next: string[]) => void;
}

export function GenreConfig({ accountId, value, onChange }: GenreConfigProps) {
	const { data } = useQuery(accountTopGenresQueryOptions(accountId));
	const topGenres = data?.genres ?? [];

	return (
		<GenrePillsPicker value={value} onChange={onChange} topGenres={topGenres} />
	);
}
