export const activeJobsKeys = {
	all: ["active-jobs"] as const,
	byAccount: (accountId: string) => ["active-jobs", accountId] as const,
};
