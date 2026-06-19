# Language-detection benchmark

Sample: **45 songs** with real lyrics, pulled from prod and stratified across
languages by a fastText pre-pass.

Gold label = **majority vote (2-of-3)**; on full-consensus songs every tool is
correct by construction, so accuracy differences come from the
disagreements. `reviewed-labels.json` overrides gold for hand-labeled songs.

- Full 3-way agreement: **41/45** (91%)
- Gold resolved (consensus or majority or reviewed): **45/45**
- Unresolved 3-way splits (need manual label): **0** → see disagreements.csv

## Accuracy vs. gold + speed

| tool | correct | accuracy | per song | total (45) |
|------|---------|----------|----------|--------------|
| tinyld | 43/45 | 95.6% | 1.112 ms | 50 ms |
| eld | 44/45 | 97.8% | 0.321 ms | 14 ms |
| fasttext | 42/45 | 93.3% | 0.318 ms | 14 ms |

_Speed measured warm over the full sample; per-song = total / 45._

## Per-language accuracy

| language | tinyld | eld | fasttext |
|----------|---|---|---|
| English (en) | 7/8 | 8/8 | 6/8 |
| Spanish (es) | 6/6 | 6/6 | 6/6 |
| German (de) | 5/5 | 5/5 | 5/5 |
| Hungarian (hu) | 5/5 | 5/5 | 5/5 |
| Portuguese (pt) | 5/5 | 5/5 | 5/5 |
| French (fr) | 4/4 | 4/4 | 4/4 |
| Japanese (ja) | 4/4 | 4/4 | 4/4 |
| Korean (ko) | 2/2 | 2/2 | 2/2 |
| Italian (it) | 2/2 | 2/2 | 2/2 |
| Persian (fa) | 1/1 | 1/1 | 0/1 |
| Russian (ru) | 1/1 | 1/1 | 1/1 |
| Catalan (ca) | 0/1 | 0/1 | 1/1 |
| Arabic (ar) | 1/1 | 1/1 | 1/1 |

