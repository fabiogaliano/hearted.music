# Vibe probe report

**Account:** fabiogaliano (201339cf-b4a8-4bc6-af3d-22a8609429d4)  
**Source:** local Supabase container `supabase_db_v1_hearted` (read-only transaction)  
**Active liked songs:** 764  
**Embedding model(s):** `Qwen/Qwen3-Embedding-0.6B (mb_b90906c2739a9e68)`

## Result at a glance

| Modality | Usable songs | Chosen result | Best size-eligible silhouette |
|:---|---:|:---|---:|
| Semantic | 667 | no meaningful clustering | 0.086 |
| Sonic | 752 | k=2 | 0.450 |

“Meaningful” here only means mean silhouette ≥ 0.09 after the minimum-size constraint. It does **not** decide whether a cluster is musically recognizable; review the medoids, neighbors, and genre tags below. The roadmap passes only if at least one chosen partition has ≥3 clusters and roughly 70% of those clusters read as genuine taste areas.

## Method

- Semantic: latest 512-dimensional `full` embedding per active liked song, L2-normalized; k-means++ with 5 seeded restarts and at most 30 iterations.
- Sonic: all nine complete audio features (energy, valence, danceability, acousticness, instrumentalness, speechiness, liveness, tempo, loudness), independently standardized as (value − median) / IQR; k-means++ with 10 seeded restarts and at most 30 iterations.
- Euclidean distance is used for fitting, silhouette, medoids, and nearest-medoid songs. Each candidate keeps the lowest-inertia restart.
- Selection: among candidates meeting the minimum size, choose the smallest k within 0.02 silhouette of the best; reject the modality when the best eligible silhouette is below 0.09.
- Genre tags are raw song tags counted once per song. Cluster numbers are ordered largest-first for review; they are not stable identities.

## Semantic

**Usable songs:** 667 · **Candidate k:** 2–8 · **Minimum cluster size:** 25

Embeddings are clustered independently of audio features; songs without a usable latest 512-dimensional full embedding are excluded from this modality.

**Chosen k:** none — **no meaningful clustering**. The best size-eligible candidate was k=2 at 0.086, below the 0.09 probe threshold. Its partition is printed below for diagnosis, not accepted as evidence of vibes.

| k | Mean silhouette | Cluster sizes (ascending) | Minimum size met? |
|---:|---:|:---|:---:|
| 2 | 0.086 | 102, 565 | yes |
| 3 | 0.072 | 101, 202, 364 | yes |
| 4 | 0.067 | 100, 140, 212, 215 | yes |
| 5 | 0.066 | 98, 99, 147, 151, 172 | yes |
| 6 | 0.062 | 90, 98, 104, 115, 129, 131 | yes |
| 7 | 0.041 | 44, 56, 80, 111, 112, 131, 133 | yes |
| 8 | 0.040 | 42, 45, 58, 71, 98, 102, 116, 135 | yes |

### Diagnostic partition (not accepted)

#### Cluster 1 — 565 songs

**Medoid:** Nothing to Find — The War On Drugs

**Five songs nearest the medoid:**

- Heart Skipped A Beat — The xx
- No One Noticed (Extended Spanish) — The Marías
- Carnival — The Cardigans
- Fall In Love — Yuno
- La nuit n'en finit plus — Petula Clark

**Top genre tags:** `hip-hop` (135) · `rap` (96) · `electronic` (88) · `pop` (84) · `indie` (65)

#### Cluster 2 — 102 songs

**Medoid:** Cheated — Pascäal

**Five songs nearest the medoid:**

- Time — Free Nationals, Mac Miller, Kali Uchis
- Nightshade — Hotel Pools
- Dreamer's Wake — Rival Consoles
- Bunny — Tourist
- Beaches — Jesper Ryom

**Top genre tags:** `electronic` (38) · `house` (23) · `ambient` (19) · `deep house` (16) · `instrumental` (16)

## Sonic

**Usable songs:** 752 · **Candidate k:** 2–6 · **Minimum cluster size:** 30

Only songs with all nine finite audio features are included, so missing values are not imputed into the sonic geometry.

**Chosen k:** 2 (mean silhouette 0.450). This is the smallest eligible k within 0.02 of the best eligible candidate.

| k | Mean silhouette | Cluster sizes (ascending) | Minimum size met? |
|---:|---:|:---|:---:|
| 2 | 0.450 | 97, 655 | yes |
| 3 | 0.184 | 90, 215, 447 | yes |
| 4 | 0.205 | 80, 109, 171, 392 | yes |
| 5 | 0.210 | 25, 81, 108, 168, 370 | no |
| 6 | 0.204 | 25, 78, 106, 107, 119, 317 | no |

### Chosen partition

#### Cluster 1 — 655 songs

**Medoid:** Bootman — Ross from Friends

**Five songs nearest the medoid:**

- Messy Love — Mura Masa
- Why Why Why Why Why — SAULT
- Pick Up — DJ Koze
- Primative People - Tale Of Us Remix — Mano Le Tough, Tale Of Us
- WhereYouGonnaGo? — Jitwam

**Top genre tags:** `electronic` (129) · `hip-hop` (124) · `rap` (83) · `pop` (73) · `indie` (65)

#### Cluster 2 — 97 songs

**Medoid:** Kody Blu 31 — JID

**Five songs nearest the medoid:**

- Ex-Factor — Ms. Lauryn Hill
- Just Like Water — Denizen Kane
- Disco Man — Remi Wolf
- On God — Kanye West
- drive ME crazy! — Lil Yachty, Diana Gordon

**Top genre tags:** `hip-hop` (33) · `rap` (23) · `electronic` (17) · `pop` (12) · `house` (8)
