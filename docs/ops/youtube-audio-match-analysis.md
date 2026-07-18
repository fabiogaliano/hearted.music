# YouTube-audio match analysis

**Data collected:** 2026-07-16, production, read-only via `bun run prod:sql`.

## Scope and caveat

`audio_feature_backfill_job.candidates` was added on 2026-07-01. Therefore job-outcome totals cover the whole pipeline, while candidate-level findings cover the **90 snapshot-bearing** low-confidence jobs. There are 784 `yt_search_low_confidence` jobs in total; older jobs have `candidates = []` and cannot be retrospectively scored or inspected.

## Outcomes

| Manual-needed code | Jobs |
| --- | ---: |
| `yt_search_low_confidence` | 784 |
| `yt_search_no_candidates` | 91 |
| **Total** | **875** |

Of the 90 low-confidence jobs with snapshots:

| Best viable score | Jobs |
| --- | ---: |
| no viable candidate | 22 |
| below 0.60 | 43 |
| 0.60–0.69 | 11 |
| 0.70–0.74 | 14 |
| **0.60–0.74 near-miss** | **25** |
| at/above 0.75 | 0 |

The best-score median was 0.55 (range 0.04–0.745). Near-misses are 28% of the observable low-confidence cohort, so lowering the global floor would affect a meaningful but not overwhelmingly safe set.

## Rejections

The 90 snapshot-bearing low-confidence jobs contain 438 candidate snapshots, including 285 rejected candidates:

| Reject reason | Candidates |
| --- | ---: |
| duration off by more than 25s | 193 |
| `contains "cover"` | 32 |
| `contains "live"` | 31 |
| `contains "remix"` | 11 |
| `contains "slowed"` | 7 |
| `contains "reaction"` | 6 |
| `contains "karaoke"` | 2 |
| `contains "8d"` | 1 |
| `contains "instrumental"` | 1 |
| `contains "tutorial"` | 1 |

Duration is by far the leading rejection (68% of rejected candidates). It is a useful precision guard, not a candidate for relaxation: the individual offsets include values in the minutes and hours as well as 26–52-second edits.

A query looking for a reject phrase in a credited artist name found zero cases in this small persisted cohort. The artist-name escape hatch is still correct for names such as **Cover Drive**, but is intentionally a narrow correctness fix rather than a measured bulk-recall lever.

## Near-miss eyeball sample

I used a stable 20-job sample from the 25 jobs with a best viable score in 0.60–0.74 and compared song/artist/duration with the top candidate title and channel.

| Song → top candidate | Score | Eyeball result |
| --- | ---: | --- |
| Lift You Up – Baauer Remix → Spade Darko x Danny Brown remix | .690 | likely different remix |
| Native Sons – Part 2 → multi-artist Native Sons (Part 2) | .700 | likely correct |
| Golden Brown – Slowed Down Version → slowed/reverb TikTok upload | .740 | uncertain variant |
| Ni**as In Paris → Jay-Z & Kanye West upload | .700 | likely correct |
| Cream On Chrome – Single Edit → Ratatat (2015) | .740 | likely correct |
| Dragostea Din Tei – Original Italian Version → O-Zone original Italian version | .700 | likely correct |
| Maniac – From Flashdance → official-audio title | .733 | likely correct |
| SAME TIME → Matt Hansen – FIRST TIME | .650 | wrong song |
| San Andreas Theme Song → GTA SA Theme Song | .700 | likely correct |
| Papaoutai – Afro Soul → matching artists/title/duration | .633 | likely correct |
| Feel Good Inc Remix → Jacob Mann upload | .725 | likely correct (artist alias) |
| The Age Of Love remix → matching Topic upload | .745 | likely correct |
| Cold – Deeper Version → plain Cold lyrics upload | .633 | likely different version |
| Crazy Bitch → censored official-video title | .700 | likely correct |
| Shake It Up → Elizabeth/E.G. Daily title | .667 | likely correct (name variant) |
| NOT MY FUCKIN' PROBLEM → GIMME FUCKIN' CHEESEBURGER | .600 | wrong song |
| on time → Time | .690 | likely wrong song |
| Let It Burn – Piano Version → guitar-chords upload | .690 | wrong content |
| o que acontece agora remix → exact title/duration | .729 | likely correct |
| I'm Hot Tonight → Elizabeth/E.G. Daily Topic upload | .667 | likely correct (name variant) |

**Estimate:** 13/20 likely correct, 5/20 likely incorrect, and 2/20 uncertain. The approximate false-rejection rate is therefore **65%** (plausible range 65–75% if the uncertain variants are correct). The dominant false-rejection cause is incomplete literal token overlap: censored titles, aliases, long multi-artist credits, and catalog-version wording. The incorrect cases also demonstrate why simply lowering `minScore` would be unsafe: several wrong recordings score .65–.69 with a matching artist and duration.

## YouTube Music retrieval check

Using local `yt-dlp 2026.06.09`:

```sh
yt-dlp --flat-playlist --dump-single-json --playlist-end 8 \
  'https://music.youtube.com/search?q=The%20Weeknd%20Blinding%20Lights&sp=EgWKAQIIAWoKEAoQAxAEEAkQBQ%3D%3D'
```

The URL was recognized as `YoutubeMusicSearchURL`, titled `The Weeknd Blinding Lights - songs`, and emitted song-shelf entries with `id`, `title`, and a `music.youtube.com/watch?v=...` URL. Flat entries omit channel and duration, which is already safe because every selected entry is hydrated before scoring. The parser accepts that shape and now skips interleaved `music.youtube.com/browse/...` artist/album entities, which have IDs but are not videos; a fixture test locks both behaviors in.

The `sp` value is YouTube Music's opaque **Songs-shelf filter**, not a royalty-free query. I also compared the query with and without the historical `audio` suffix. Without it, the first eight included the two `Blinding Lights` song entries; with it, the result set introduced instrumental, remix, and live variants. The primary Music query therefore omits `audio`.

## Resulting calibration

| Change | Calibration decision | Evidence / precision guard |
| --- | --- | --- |
| Music Songs shelf | primary search; regular `ytsearchN:` on Music error or empty output | Biases retrieval toward recordings; fallback preserves regular-upload recall. |
| Query retry | one attempt only after empty or low-confidence result; `artist + title + album`, or `audio` only where album is absent | Targets all 91 no-candidate jobs and query-miss portions of the 784 low-confidence jobs. It rehydrates only previously unseen IDs and still requires the same .75 floor. |
| Artist escape hatch | allow a reject phrase present in a credited artist name | Corrects a bounded-name false rejection without weakening the reject rule for other songs. |
| Title leftovers | maximum proportional penalty **0.015** | 650 persisted auto-approved search reviews with candidate snapshots have minimum stored score **.766667**. Since the penalty is capped at .015, every one remains at least **.751667**, above the .75 floor. It counters extra unbracketed words such as “reacts”, “full”, and “breakdown” without hard-rejecting them. |
| Score floor | retain `minScore = autoApproveScore = .75` | The sample contains plausible wrong candidates at .65–.69. The new retrieval/retry routes improve recall without admitting them; hard version/duration rejects remain in force. |

## Reproduction queries

The principal read-only queries were:

```sql
select status, error_code, count(*)
from audio_feature_backfill_job
group by 1, 2;

with candidates as (
  select j.id, e.value as candidate
  from audio_feature_backfill_job j
  cross join lateral jsonb_array_elements(j.candidates) e
  where j.status = 'manual_needed'
    and j.error_code = 'yt_search_low_confidence'
)
select id,
       max((candidate->>'score')::numeric)
         filter (where coalesce((candidate->>'rejected')::boolean, false) = false)
from candidates
group by id;

select candidate->>'rejectReason', count(*)
from audio_feature_backfill_job j
cross join lateral jsonb_array_elements(j.candidates) candidate
where j.status = 'manual_needed'
  and j.error_code = 'yt_search_low_confidence'
  and coalesce((candidate->>'rejected')::boolean, false)
group by 1;
```
