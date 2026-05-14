import faqJson from "../../../public/legal/faq.json";
import privacyJson from "../../../public/legal/privacy.json";
import termsJson from "../../../public/legal/terms.json";

interface FaqItem {
	q: string;
	a: string;
}

interface FaqSection {
	title: string;
	items: FaqItem[];
}

interface FaqData {
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

interface LegalSection {
	number: number;
	title: string;
	content: ContentBlock[];
}

interface LegalDocData {
	lastUpdated: string;
	summary: string;
	sections: LegalSection[];
}

export const faqData = faqJson as FaqData;
export const privacyData = privacyJson as LegalDocData;
export const termsData = termsJson as LegalDocData;
