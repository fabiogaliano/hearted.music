import type {
	CreateCheckoutSessionResponse,
	CreatePortalSessionResponse,
} from "@/lib/server/billing.functions";

type CheckoutErrorCode = Extract<
	CreateCheckoutSessionResponse,
	{ success: false }
>["error"];

type PortalErrorCode = Extract<
	CreatePortalSessionResponse,
	{ success: false }
>["error"];

export function checkoutErrorMessage(code: CheckoutErrorCode): string {
	switch (code) {
		case "billing_disabled":
			return "Billing is not available right now.";
		case "billing_unavailable":
			return "Failed to start checkout. Please try again.";
		case "invalid_billing_redirect":
			return "Billing returned an invalid redirect. Please try again.";
		case "rate_limited":
			return "Too many billing attempts. Please wait a minute and try again.";
	}
}

export function portalErrorMessage(code: PortalErrorCode): string {
	switch (code) {
		case "billing_disabled":
			return "Billing is not available right now.";
		case "billing_unavailable":
			return "Something went sideways. Let's try that again.";
		case "invalid_billing_redirect":
			return "Billing returned an invalid redirect. Please try again.";
		case "rate_limited":
			return "Too many billing attempts. Please wait a minute and try again.";
	}
}
