import faqJson from "../../../public/legal/faq.json";
import privacyJson from "../../../public/legal/privacy.json";
import termsJson from "../../../public/legal/terms.json";

export interface FaqItem {
	q: string;
	a: string;
}

export interface FaqSection {
	title: string;
	items: FaqItem[];
}

export interface FaqData {
	sections: FaqSection[];
}

export type ContentBlock =
	| { type: "paragraph"; text: string }
	| { type: "list"; items: string[] }
	| {
			type: "definition-list";
			items: Array<{ term: string; description: string }>;
	  }
	| { type: "sub-heading"; text: string };

export interface LegalSection {
	number: number;
	title: string;
	content: ContentBlock[];
}

export interface LegalDocData {
	lastUpdated: string;
	summary: string;
	sections: LegalSection[];
}

export const faqData = faqJson as FaqData;
export const privacyData = privacyJson as LegalDocData;
export const termsData = termsJson as LegalDocData;
