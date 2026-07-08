# Docs

How this folder is organized and how to add to it. Keep it topic-first and let
status live *inside* files, not in folder names.

## Structure

Top level is by **domain**:

| Folder | What lives here |
| --- | --- |
| `architecture/` | How the system works; system overview, module boundaries, matching, initiatives |
| `social/` | Social/sharing features and their proposals |
| `ops/` | Operational runbooks: migrations, backups, rollouts, upgrades |
| `analysis/` | Standalone investigations and write-ups |

Inside a domain, group by **topic**, not by status:

- **A single body of work** → one **initiative folder** named for the work
  (e.g. `architecture/account-events/`). It holds that work's whole lifecycle —
  `research.md`, `proposal.md`, and later `decision.md` — plus a `README.md`
  index. This keeps one initiative in one place instead of scattering it across
  sibling `research/` and `proposals/` folders.
- **A long-lived domain with many docs** (e.g. `architecture/matching/`) → a
  topic folder whose root holds the canonical reference, with `proposals/`,
  `research/`, `audits/` subfolders only when volume justifies them.

## Status

A doc's lifecycle status is signalled one of two ways:

```yaml
---
status: proposed        # research | proposed | accepted | reference | audit | superseded
updated: 2026-07-08     # optional; last meaningful content change
---
```

1. **Frontmatter** — *required inside an initiative folder*, where docs of
   different statuses live side by side (`research.md` + `proposal.md`). It's
   the only way to tell them apart.
2. **A status-named subfolder** under a long-lived domain — `proposals/`,
   `research/`, `audits/` — is an accepted shorthand when a whole folder shares
   one status (e.g. `matching/proposals/`). The folder name *is* the status, so
   per-file frontmatter is optional there.

The rule that matters: a single body of work never gets **split across** sibling
status folders (that scatters one topic — see `account-events/`). And advancing
a doc's status means editing frontmatter or, at most, one deliberate move — not
constantly shuffling files between buckets.

This mirrors the industry split between an **RFC/proposal** (explores options,
invites feedback — mutable) and a **decision record / ADR** (records what was
decided and why — append-only). An initiative folder can hold both.

## Adding a doc

1. Find the domain (`architecture/`, `social/`, `ops/`, `analysis/`).
2. New body of work → create an initiative folder with a `README.md` index.
   Adding to existing work → drop the file in that folder.
3. Set its status: add `status` frontmatter (required in initiative folders),
   or drop it in the matching status-named subfolder.
4. Link it from the nearest `README.md` so it's discoverable.
5. Preserve history when relocating tracked docs: `git mv`, don't delete + recreate.
