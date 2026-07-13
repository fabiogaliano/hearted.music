# Pin Semantics — Decisions

> Scope: the studio's preview tracklist (pins, anchor artists, the per-row pin
> toggle). Records deliberate reversals so future reviews don't re-suggest the
> old behaviour as a fix.

## Vocabulary

- **Manual pin** — a song the user hand-added (suggestion add or the row's pin
  toggle). Stored in the draft selection's `pinnedSongIds`.
- **Anchor artist** — an artist the draft is built "around". Its liked songs
  are resolved (filter-independently) and allocated into pins; they are never
  stored in the selection, only derived at query-key time.
- **Effective pins** — the ordered, deduplicated union sent to the preview
  engine: balanced anchor-artist allocation first, manual pins after, clamped
  to `MAX_PINNED_SONG_IDS`.
- **Release vs. exclude** — releasing drops a pin so the song re-enters the
  tracklist on merit; excluding removes it from results entirely (undoable).
- **Released set** — `releasedSongIds` in the draft selection: songs the user
  un-pinned. Skipped by the artist allocator (a release must not be silently
  re-derived into a pin) but still eligible for ranked fill and suggestions.
  Never crosses the wire.

## D1 — All pins are filter-exempt; provenance does not cross the wire

The preview input carries a single `pinnedSongIds` array. Every pin — manual
or anchor-derived — is a filter-exempt commitment: it leads the tracklist and
match filters never evict it (an explicit exclude still wins; unliked ids are
reported via `droppedPinnedSongIds`).

An earlier iteration split the wire contract into `pinnedSongIds` +
`manualPinnedSongIds` so that anchor-derived pins stayed filter-subject while
manual pins were exempt. That forced a provenance invariant across the seam
(manual ⊆ effective, defended by a server-side intersection) and produced the
confusing UX D2 fixes. The split was removed; do not reintroduce it without
also solving D2's chip-count instability.

## D2 — Anchor-artist resolution is filter-INDEPENDENT

`resolveLikedArtistSongs` takes only artist names and returns each artist's
full liked-song pool. It previously accepted `matchFilters` and pre-filtered
the pools ("artist pins stay filter-subject" — there was a test asserting
this; it was deliberately inverted, not lost).

Rationale: an anchor artist is a commitment, like a manual pin. When the pools
were filter-aware, tightening a filter silently shrank an anchor artist's
contribution and its chip count, so chips claimed different song counts as
unrelated config changed — and the resolution had to re-run on every filter
settle, coordinating filter generations between chip counts and allocation.
Filter-independence makes the chip count stable (the artist's total liked
songs) and the resolution cacheable per artist set.

Consequence to accept, not "fix": an anchor artist can pull songs into the
preview that the active filters would reject.

## D3 — The pin toggle is uniform: pinned ↔ neutral, never an exclusion

(REVISED — this reverses the earlier three-way routing recorded here, where
un-pinning an anchor-derived pick excluded it.)

The pin toggle has one meaning regardless of provenance: an unpinned row
becomes a manual pin; a pinned row — manual or anchor-derived alike — is
released into the released set, so it re-enters the tracklist or suggestions
only on merit. Removal (the ✕ / swipe) remains the only excluding gesture,
and the only one that mirrors remove feedback (undo toast).

The earlier routing excluded anchor-derived picks on un-pin because no
"unpinned but still present" state existed: the allocator re-derived any
released anchor song on the next pass, making release a visible no-op. That
was a mechanism gap, not a UX goal — the same gesture silently meant
"neutralize" or "banish" depending on provenance the UI deliberately does not
display. The released set creates the missing state; with it, exclusion via
the pin toggle lost its reason to exist. A released song may still drop out
of the tracklist (an anchor pick that the filters would reject no longer has
a pin forcing it in) — that is release semantics working, not a loss to
guard against: the stance is recorded and the song stays eligible.

The released set also closes two allocator leaks: songs that are manually
pinned, released, or excluded are all withheld from the artist pools, so a
slot can never be spent on an id that would be deduplicated away (manual
overlap) or dropped server-side (exclusion) — the artist's next song is
promoted instead.

The policy lives in `useCreatePlaylistDraft.togglePin`, next to the selection
state it inspects. It no longer returns an outcome: with release uniform and
non-destructive, `PreviewList` has no feedback to mirror. `PreviewList` must
not receive a "manual pins" prop to route this itself — that was tried and it
widened a presentational interface with a distinction that is not visual.

Visually, all effective pins render one filled pin marker (no zone labels, no
per-row provenance badge); "Your picks / Matched for you" eyebrows were
removed in favour of the marker.

## D4 — Removing an artist chip has no undo

Chip ✕ removes the artist outright. The undo toast (restore at prior index)
was removed: an unsaved draft artist re-addable via search is not a
destructive loss, and the restore path carried index-bookkeeping complexity
for a case search already covers.
