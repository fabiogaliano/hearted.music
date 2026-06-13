/**
 * Shared billing query keys used across features for cache invalidation.
 */

export const billingKeys = {
	all: ["billing"] as const,
	state: ["billing", "state"] as const,
	// Temporary: drop together with the waitlist welcome dialog.
	waitlistWelcome: ["billing", "waitlist-welcome"] as const,
};
