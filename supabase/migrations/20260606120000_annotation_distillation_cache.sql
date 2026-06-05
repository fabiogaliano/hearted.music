-- Cache of distilled (fact-compressed) Genius annotations.
--
-- A pure memoization of text -> grounding facts: keyed by a content hash of the
-- normalized annotation text, NOT by song. Identical annotation text across a
-- recurring chorus or across different songs collapses to one row, so each
-- distinct annotation is distilled by the LLM exactly once and reused forever.
-- distiller_version is part of the key so improving the distiller prompt/model
-- invalidates cleanly instead of serving stale output.
--
-- Worker-written via the service role; deny-all RLS like song_lyrics.

create table "public"."annotation_distillation" (
    "content_hash"      text not null,
    "distiller_version" text not null,
    "raw_text"          text not null,
    "distilled_text"    text not null,
    "model"             text not null,
    "created_at"        timestamptz not null default now(),
    constraint "annotation_distillation_pkey"
        primary key ("content_hash", "distiller_version")
);

alter table "public"."annotation_distillation" enable row level security;

create policy "annotation_distillation_deny_all"
    on "public"."annotation_distillation"
    as permissive
    for all
    to public
    using (false);
