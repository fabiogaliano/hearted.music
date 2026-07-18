import { HeartIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { Card, ErrorState, Loading, UserLink } from "../components/primitives";
import { useApi } from "../lib/api";
import { fmt, relativeTime } from "../lib/format";
import type { AccountLikedRow, PageResult } from "../lib/types";
import type { AccountListQuery } from "../lib/user-selection";

const columns: DataTableColumn<AccountLikedRow>[] = [
	{
		key: "label",
		header: "Account",
		sortable: true,
		render: (r) => <UserLink id={r.id} label={r.label} handle={r.handle} />,
	},
	{
		key: "email",
		header: "Email",
		render: (r) => <span className="dim num">{r.email ?? "—"}</span>,
	},
	{
		key: "liked",
		header: "Liked",
		right: true,
		sortable: true,
		render: (r) => <span className="cell-num">{fmt(r.liked)}</span>,
	},
	{
		key: "playlists",
		header: "Playlists",
		right: true,
		sortable: true,
		render: (r) => <span className="cell-num">{fmt(r.playlists)}</span>,
	},
	{
		key: "createdAt",
		header: "Joined",
		right: true,
		sortable: true,
		render: (r) => <span className="dim">{relativeTime(r.createdAt)}</span>,
	},
];

type TableState = {
	search: string;
	sort: string;
	direction: "asc" | "desc";
	page: number;
	pageSize: 25 | 50 | 100;
};

function readTableState(): TableState {
	const params = new URL(window.location.href).searchParams;
	const page = Number(params.get("page"));
	const pageSize = params.get("pageSize");
	return {
		search: params.get("q") ?? "",
		sort: params.get("sort") ?? "liked",
		direction: params.get("direction") === "asc" ? "asc" : "desc",
		page: Number.isInteger(page) && page > 0 ? page : 1,
		pageSize: pageSize === "25" ? 25 : pageSize === "100" ? 100 : 50,
	};
}

export function AccountList({ query }: { query: AccountListQuery }) {
	const [table, setTable] = useState<TableState>(readTableState);
	useEffect(() => {
		const onPopState = () => setTable(readTableState());
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	function updateTable(patch: Partial<TableState>) {
		const next = { ...table, ...patch };
		setTable(next);
		const url = new URL(window.location.href);
		url.searchParams.set("q", next.search);
		url.searchParams.set("sort", next.sort);
		url.searchParams.set("direction", next.direction);
		url.searchParams.set("page", String(next.page));
		url.searchParams.set("pageSize", String(next.pageSize));
		window.history.pushState({ controlPanel: true }, "", url);
	}

	const params = new URLSearchParams({
		min: String(query.minLiked),
		q: table.search,
		sort: table.sort,
		direction: table.direction,
		page: String(table.page),
		pageSize: String(table.pageSize),
	});
	if (query.maxLiked != null) params.set("max", String(query.maxLiked));
	const result = useApi<PageResult<AccountLikedRow>>(
		`/api/accounts/by-liked?${params.toString()}`,
	);
	if (result.error && !result.data)
		return <ErrorState message={result.error} />;
	if (!result.data) return <Loading />;

	return (
		<div className="grid">
			<Card
				title={`${query.title} · ${result.data.total} accounts`}
				icon={HeartIcon}
				span={12}
			>
				<DataTable
					tableId="accounts-by-liked"
					columns={columns}
					rows={result.data.rows}
					total={result.data.total}
					page={result.data.page}
					pageSize={result.data.pageSize}
					search={table.search}
					sort={table.sort}
					direction={table.direction}
					getRowId={(row) => row.id}
					onSearchChange={(search) => updateTable({ search, page: 1 })}
					onSortChange={(sort) =>
						updateTable({
							sort,
							page: 1,
							direction:
								table.sort === sort && table.direction === "asc"
									? "desc"
									: "asc",
						})
					}
					onPageChange={(page) => updateTable({ page })}
					onPageSizeChange={(pageSize) => updateTable({ pageSize, page: 1 })}
					onReset={() =>
						updateTable({
							search: "",
							sort: "liked",
							direction: "desc",
							page: 1,
							pageSize: 50,
						})
					}
					loading={result.loading}
					refreshing={result.refreshing}
					error={result.error}
					onRetry={result.refetch}
					empty="No accounts exist in this range."
					noMatches="No accounts match these filters."
					exportUrl="/api/exports/accounts-by-liked"
				/>
			</Card>
		</div>
	);
}
