import { createContext, useContext } from "react";
import type { SectionKey } from "./url-state";

// Lets a card deep in a section jump to another section (e.g. an Overview alert
// → the Jobs detail table, or User Detail → a prefilled Grant/Email form).
// `params` are set on the destination URL as-is; each landing section decides
// which of its own query params it reads back out.
export type NavigateFn = (
	sectionKey: SectionKey,
	params?: Record<string, string>,
) => void;

export const NavContext = createContext<NavigateFn>(() => {});

export const useNavigate = () => useContext(NavContext);
