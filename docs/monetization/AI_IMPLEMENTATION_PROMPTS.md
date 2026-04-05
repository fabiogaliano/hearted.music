# Monetization AI Prompt Runbook

Use these prompts in order. Review each output before moving to the next step.

Current status based on work already completed:
- [x] Normalize canonical implementation plan
- [x] Create current-state audit
- [x] Run terminology pass and patch plan

---

## 1. Canonical plan normalization
- [x] Completed

```md
I want you to revise `docs/MONETIZATION_V2_PLAN.md` so it is consistently written as a **future-state implementation plan**.

## Goal
The document currently mixes:
- target-state design
- implementation sequencing
- wording that implies some billing/schema/service pieces already exist

But in the current repo, major billing infrastructure does **not** exist yet.

## Your task
Review the document and patch it so that:

1. it clearly reads as a **plan for intended implementation**
2. it does **not** imply unbuilt billing components already exist
3. it preserves the intended monetization design
4. it keeps useful implementation detail and sequencing
5. it uses consistent wording for planned vs existing behavior

## Requirements
- read the document carefully before editing
- preserve the product rules, architecture, schema proposals, RPC contracts, and rollout phases
- rewrite misleading present-tense / already-implemented language into future-state planning language
- add a short framing note near the top that this is the canonical **target-state implementation plan**
- if current-state observations are kept, label them clearly as current repo context
- do not implement app code
- do not rewrite the whole doc unnecessarily; make the smallest clean edits needed for consistency

## Specific issue to fix
The doc should **not** read as though quarterly billing, billing schema, billing service, env flags, or checkout/portal bridges are already implemented if they are only planned.

## Output
1. a brief summary of the editorial approach
2. the actual doc patch
3. a short list of the most important wording changes made
```

---

## 2. Current-state audit
- [x] Completed

```md
Create a grounded current-state audit for monetization planning in this repo.

## Goal
I need a separate document that captures **what exists today in the codebase** so the canonical monetization plan can stay future-state.

## Source of truth
- `docs/MONETIZATION_V2_PLAN.md`
- the actual codebase
- actual migrations / server functions / routes / UI types / workflows

## Your task
Audit the repo and create:

- `docs/monetization/CURRENT_STATE_AUDIT.md`

## The audit should include
1. **Existing touchpoints**
   - files/modules that are relevant today
2. **Confirmed current behavior**
   - what the repo actually does now
3. **Missing billing foundation**
   - schema, RPCs, env flags, services, UI, etc. that do not yet exist
4. **Current semantics that matter**
   - e.g. missing `item_status` means pending
   - queue priority defaults
   - current onboarding steps
   - current matching visibility behavior
5. **Known stale references / assumptions**
6. **Integration points likely to change**
   - routes
   - server functions
   - generated DB types
   - account provisioning
   - reset/reseed scripts
   - query/cache layers

## Requirements
- ground all claims in inspected code
- do not speculate
- do not make code changes
- keep the document structured and implementation-useful
- make clear which files are confirmed touchpoints vs likely future touchpoints

## Output
1. write `docs/monetization/CURRENT_STATE_AUDIT.md`
2. summarize the highest-risk current-state facts for future implementation
```

---

## 3. Terminology normalization
- [x] Completed

```md
I want to do a terminology pass for monetization and update the canonical plan accordingly.

## Context
We already have:
- `docs/MONETIZATION_V2_PLAN.md` as the canonical future-state implementation plan
- `docs/monetization/CURRENT_STATE_AUDIT.md` as the grounded current-state audit

Before breaking implementation into decisions, phases, and stories, I want to normalize the terminology that will be used across:
- product language
- domain language
- schema / RPC naming
- TypeScript types
- module names
- server function names
- status values
- offer IDs
- env flags

## Goal
Define canonical terminology for monetization implementation, and then patch the implementation plan so it uses that terminology consistently.

## Your task
Inspect the existing plan and relevant repo touchpoints, then:

1. create `docs/monetization/TERMINOLOGY.md`
2. patch `docs/MONETIZATION_V2_PLAN.md` where needed so terminology is consistent with the chosen canonical terms

## What I want in `docs/monetization/TERMINOLOGY.md`
Please include:

### 1. Naming principles
- when user-facing copy should differ from internal code terms
- how to choose stable names
- what naming patterns to avoid
- how to keep Stripe-specific terminology isolated to the billing service

### 2. Canonical terms
For each important concept, include:
- concept
- recommended canonical term
- 2–3 alternative options
- brief pros/cons
- recommendation
- whether this should be frozen now
- whether it is user-facing, internal, or both

### 3. Required concept groups
Please cover at least:
- plans / offers / tiers
- songs-to-explore / credits / balance terminology
- unlocks / entitlements / access
- unlimited access terminology
- onboarding monetization terminology
- billing action verbs (`grant`, `unlock`, `activate`, `apply`, `release`, `reverse`, etc.)
- status/state terminology (`locked`, `pending`, `analyzed`, etc.)
- queue / priority terminology
- provider-disabled / self-hosted terminology
- billing bridge terminology
- env flag naming
- internal offer ID naming

### 4. Terms to avoid
Include ambiguous, misleading, or unstable terms we should avoid.

## Important requirement
This terminology pass should also update the canonical implementation plan where needed.

That means:
- if the plan uses inconsistent or weak terminology, patch it
- if multiple terms are being used for the same concept, consolidate them
- preserve the meaning of the plan while improving naming consistency
- do not rewrite the plan unnecessarily; make focused edits

## If there are unresolved high-impact naming decisions
For decisions that materially affect:
- shared types
- DB schema
- RPC names
- status enums
- public/internal boundaries

please present the best 3 options and use the `ask` tool so I can choose.

Use `ask` only for the small number of naming decisions that truly need my selection.
Do not use `ask` for low-impact wording choices.

## Output
1. write `docs/monetization/TERMINOLOGY.md`
2. patch `docs/MONETIZATION_V2_PLAN.md` for terminology consistency
3. summarize:
   - the most important terminology decisions made
   - any unresolved naming choices that need my input
   - any terms that should now be treated as frozen for later implementation planning

## Constraints
- do not implement code
- ground recommendations in the existing docs and repo structure
- optimize for names that will work well in SQL, RPCs, TS types, and reviews
- be opinionated and practical
```

---

## 4. Locked decisions / invariants
- [X] Next

```md
Create a monetization decisions/invariants document from the canonical plan.

## Goal
I need a document that captures the architectural and product decisions that should be treated as **locked constraints** during implementation, so multiple AI branches do not reinterpret core rules differently.

## Source of truth
- `docs/MONETIZATION_V2_PLAN.md`
- `docs/monetization/CURRENT_STATE_AUDIT.md`
- `docs/monetization/TERMINOLOGY.md`

## Your task
Create:

- `docs/monetization/DECISIONS.md`

## Include
1. **Product invariants**
   - free tier allocation rules
   - pack rules
   - unlimited rules
   - conversion/discount rules
2. **Architecture invariants**
   - public app vs billing service repo boundary
   - internal offer IDs only outside billing service
   - entitlement predicate
   - control-plane responsibility boundaries
3. **Data model invariants**
   - billing source of truth
   - unlock durability expectations
   - self-hosted/provider-disabled explicit access rule
4. **Read-model invariants**
   - locked vs pending semantics
   - shared artifacts do not imply entitlement
5. **Workflow invariants**
   - one enrichment workflow in v1
   - no split durable workflow for phase A vs B/C
6. **Terminology invariants**
   - canonical terms that should now be considered frozen
7. **Non-goals / out-of-scope rules**
8. **Open questions**
   - only if they are truly unresolved by the docs

## Requirements
- separate “locked decisions” from “implementation details”
- be concise and explicit
- phrase the document so downstream story authors can rely on it
- reference canonical terminology where relevant
- do not implement code

## Output
1. write `docs/monetization/DECISIONS.md`
2. summarize which decisions must be frozen before parallel implementation begins
```

---

## 5. Dependency-driven implementation phases
- [x]

```md
Break the monetization implementation into dependency-driven phases.

## Goal
I need a clean implementation phase plan that can later be split into branches, PRs, and parallel AI work.

## Source of truth
- `docs/MONETIZATION_V2_PLAN.md`
- `docs/monetization/CURRENT_STATE_AUDIT.md`
- `docs/monetization/TERMINOLOGY.md`
- `docs/monetization/DECISIONS.md`

## Your task
Create:

- `docs/monetization/IMPLEMENTATION_PHASES.md`

## Requirements
The phases should be:
- dependency-driven
- realistic for the current repo
- clear about what must happen first
- useful for converting into features/stories

## For each phase include
1. **Phase name**
2. **Goal**
3. **Why this phase exists**
4. **Inputs / dependencies**
5. **Outputs**
6. **Key touchpoints**
7. **Risks**
8. **What can be parallelized within the phase**
9. **Exit criteria**

## Important
- phases should not just mirror the big doc sections
- they should reflect actual implementation dependencies
- call out shared-contract work that should land before parallel work
- note any sequencing concerns where the original monetization plan should be reordered

## Output
1. write `docs/monetization/IMPLEMENTATION_PHASES.md`
2. include a recommended execution order
3. include a short note on which phases are serial vs partially parallel
```

---

## 6. Feature / capability briefs
- [x] Optional but recommended

```md
Convert the monetization implementation phases into feature/capability briefs.

## Goal
I need feature-level planning artifacts that sit between phases and stories.

## Source of truth
- `docs/MONETIZATION_V2_PLAN.md`
- `docs/monetization/CURRENT_STATE_AUDIT.md`
- `docs/monetization/TERMINOLOGY.md`
- `docs/monetization/DECISIONS.md`
- `docs/monetization/IMPLEMENTATION_PHASES.md`

## Your task
Create feature briefs under:

- `docs/monetization/features/`

## What I want
A set of feature docs such as:
- billing foundation
- app billing domain
- pipeline gating / entitlement enforcement
- billing service + app bridge
- onboarding monetization
- public billing UI
- hardening / launch validation

You may rename/refine these if needed.

## For each feature brief include
1. **Feature name**
2. **Goal**
3. **Why it exists**
4. **What this feature owns**
5. **What it does not own**
6. **Likely touchpoints**
7. **Dependencies**
8. **Downstream stories this feature should split into**
9. **Definition of done**

## Requirements
- organize features so they can later be split into PR-sized stories
- avoid mixing too many unrelated concerns into one feature
- keep the docs grounded in the repo
- do not implement code

## Output
1. create the feature brief files
2. provide an index of the created features and why each exists
```

---

## 7. PR-sized implementation stories
- [x]

```md
Convert the monetization planning artifacts into PR-sized implementation stories.

## Goal
I need small, clear, AI-executable work packets that can become branches / PRs / worktrees.

## Source of truth
- `docs/MONETIZATION_V2_PLAN.md`
- `docs/monetization/CURRENT_STATE_AUDIT.md`
- `docs/monetization/TERMINOLOGY.md`
- `docs/monetization/DECISIONS.md`
- `docs/monetization/IMPLEMENTATION_PHASES.md`
- `docs/monetization/features/` if they exist

## Your task
Create story docs under:

- `docs/monetization/stories/`

## Story sizing requirements
Each story should be:
- small enough for one branch / one PR
- independently reviewable
- explicit about dependencies
- narrow enough to avoid large merge conflicts
- clear enough for an AI coding agent to execute with minimal ambiguity

## For each story include
1. **Story ID and title**
2. **Goal**
3. **Why**
4. **Depends on**
5. **Blocks**
6. **Scope**
7. **Out of scope**
8. **Likely touchpoints**
9. **Constraints / decisions to honor**
10. **Acceptance criteria**
11. **Verification**
12. **Parallelization notes**
13. **Suggested PR title**

## Important
- separate shared-contract stories from downstream implementation stories
- call out stories that touch hot files likely to conflict
- do not make stories too broad
- do not implement code

## Output
1. create the story docs
2. create an index file:
   - `docs/monetization/STORY_INDEX.md`
3. in the index, group stories by phase and feature
```

---

## 8. Dependency and parallelization map
- [ ]

```md
Create a dependency and parallelization map for the monetization implementation stories.

## Goal
I want to know which stories must be done serially and which can safely be worked in parallel in separate branches/worktrees by AI agents.

## Source of truth
- `docs/monetization/DECISIONS.md`
- `docs/monetization/IMPLEMENTATION_PHASES.md`
- `docs/monetization/STORY_INDEX.md`
- `docs/monetization/stories/`

## Your task
Create:

- `docs/monetization/DEPENDENCY_MAP.md`

## Include
1. **Story dependency graph**
   - textual is fine
2. **Critical path**
3. **Shared-contract stories that should land first**
4. **Hot files / merge-risk zones**
5. **Parallelizable story groups**
6. **Stories that should not run in parallel**
7. **Recommended implementation waves**
   - wave 1
   - wave 2
   - wave 3
   etc.

## Requirements
- identify file overlap risks
- identify generated artifact risks (e.g. DB types)
- identify central schema/env/route/workflow files likely to conflict
- be practical, not theoretical
- do not implement code

## Output
1. write `docs/monetization/DEPENDENCY_MAP.md`
2. include a concise “safe parallel work plan”
```

---

## 9. Branch / worktree / PR execution plan
- [ ]

```md
Create a branch/worktree execution plan for monetization implementation.

## Goal
I want a practical plan for how to execute the monetization stories across branches, PRs, and possibly parallel worktrees with AI agents.

## Source of truth
- `docs/monetization/STORY_INDEX.md`
- `docs/monetization/DEPENDENCY_MAP.md`
- `docs/monetization/stories/`

## Your task
Create:

- `docs/monetization/EXECUTION_PLAN.md`

## Include
1. **Recommended branch naming scheme**
   - epic / phase / story level if useful
2. **Recommended PR granularity**
3. **Suggested worktree usage**
4. **Recommended implementation waves**
5. **Which stories to assign one at a time**
6. **Which story groups are safe for parallel AI execution**
7. **Merge order**
8. **Rebase / regeneration hazards**
   - migrations
   - generated DB types
   - env files
   - central unions / routes / workflow types
9. **What should be manually coordinated**
10. **What should be validated before opening dependent PRs**

## Requirements
- optimize for low merge conflict risk
- assume AI agents may work in separate sessions/branches
- keep it practical and repository-specific
- do not implement code

## Output
1. write `docs/monetization/EXECUTION_PLAN.md`
2. provide a recommended “first 5 branches/PRs” sequence
```

---

## 10. Per-story AI execution prompts
- [ ] Last

```md
Generate AI-ready implementation prompts for each monetization story.

## Goal
I want a reusable prompt per story that I can paste into a coding-agent conversation to execute that story cleanly.

## Source of truth
- `docs/monetization/stories/`
- `docs/monetization/DECISIONS.md`
- `docs/monetization/CURRENT_STATE_AUDIT.md`
- `docs/monetization/TERMINOLOGY.md`

## Your task
For each story in `docs/monetization/stories/`, generate an implementation prompt and write them under:

- `docs/monetization/story-prompts/`

## Each prompt should include
1. the story goal
2. the constraints / decisions to honor
3. the likely touchpoints
4. the out-of-scope boundaries
5. acceptance criteria
6. verification steps
7. explicit instruction to inspect the current code before changing anything
8. explicit instruction not to drift beyond the story scope

## Prompt style
The prompt should be suitable for a coding agent that can:
- inspect files
- edit code
- run tests/checks

It should be specific enough that the agent can execute with minimal restatement.

## Output
1. create one prompt file per story
2. create an index:
   - `docs/monetization/STORY_PROMPT_INDEX.md`
3. include a note on which prompts are safe to run in parallel
```

---

## Suggested order from here

- [ ] 4. `DECISIONS.md`
- [ ] 5. `IMPLEMENTATION_PHASES.md`
- [ ] 6. `features/` briefs *(optional but recommended)*
- [ ] 7. `stories/` + `STORY_INDEX.md`
- [ ] 8. `DEPENDENCY_MAP.md`
- [ ] 9. `EXECUTION_PLAN.md`
- [ ] 10. `story-prompts/` + `STORY_PROMPT_INDEX.md`

## Practical checkpoint rule
Review the output before moving on after steps:
- 4
- 5
- 7
- 8
- 9

Steps 6 and 10 are lower risk once the earlier artifacts are solid.
