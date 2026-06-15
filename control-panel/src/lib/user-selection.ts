import { createContext, useContext } from "react";

// Lets any table cell open a user drill-down without prop-threading a callback
// through every section. App provides the setter; UserLink consumes it.
export const SelectUserContext = createContext<(id: string | null) => void>(
	() => {},
);

export const useSelectUser = () => useContext(SelectUserContext);

// A filtered account list to drill into (e.g. a liked-song distribution tier).
export interface AccountListQuery {
	title: string;
	minLiked: number;
	maxLiked: number | null;
}

export const ShowAccountsContext = createContext<
	(query: AccountListQuery | null) => void
>(() => {});

export const useShowAccounts = () => useContext(ShowAccountsContext);
