# Project Context

## Purpose

**Hearted** is a web application for automatically sorting Spotify liked songs. It provides users with an interface to organize, categorize, and manage their Spotify "Liked Songs" library through automatic playlist creation based on genres, moods, lyrics analysis, and audio features.

This is `v1_hearted`, built with a modern TanStack-based architecture.

## Tech Stack

### Core Framework
- **TanStack Start** - Full-stack React meta-framework with SSR/SSG capabilities
- **TanStack Router** - File-based routing with type-safe navigation
- **TanStack Query** - Server state management and data fetching
- **React 19** - Latest React with concurrent features

### Styling & UI
- **Tailwind CSS v4** - Utility-first CSS framework (via Vite plugin)
- **tw-animate-css** - Tailwind animation utilities
- **class-variance-authority (CVA)** - Type-safe component variants
- **clsx + tailwind-merge** - Conditional className utilities
- **Lucide React** - Icon library

### Validation & Environment
- **Zod v4** - Schema validation library
- **@t3-oss/env-core** - Type-safe environment variables

### Development Tools
- **TypeScript 5.7** - Strict mode enabled
- **Biome** - Fast linter and formatter (replaces ESLint + Prettier)
- **Vitest** - Unit testing framework
- **Vite 7** - Build tool and dev server

### Deployment
- **Cloudflare Workers** - Serverless edge deployment
- **Wrangler** - Cloudflare deployment CLI

## Project Conventions

### Code Style

**Formatting (via Biome):**
- **Indentation**: Tabs (not spaces)
- **Quotes**: Double quotes for strings
- **Imports**: Auto-organized by Biome

**TypeScript:**
- Strict mode enabled with all strict checks
- `noUnusedLocals` and `noUnusedParameters` enforced
- Path alias: `@/*` maps to `./src/*`
- No barrel exports (`index.ts` re-exports) - use direct imports for better tree-shaking and traceability

**Naming Conventions:**
- React components: PascalCase (e.g., `Header.tsx`)
- Utility functions: camelCase (e.g., `utils.ts`)
- Route files: kebab-case with dots for nesting (e.g., `start.ssr.full-ssr.tsx`)
- API routes: `api.{name}.ts` pattern

### Architecture Patterns

**Directory Structure:**
```
src/
├── integrations/              # Third-party integrations
│   └── tanstack-query/        # Query client setup
├── lib/                       # Core business logic
│   ├── auth/                  # Authentication utilities
│   │   ├── cookies.ts         # Cookie management
│   │   ├── oauth.ts           # OAuth flow helpers
│   │   └── session.ts         # Session management
│   ├── data/                  # Database access layer (Supabase)
│   │   ├── client.ts          # Supabase client factory
│   │   ├── database.types.ts  # Generated DB types
│   │   ├── accounts.ts        # Account CRUD
│   │   ├── auth-tokens.ts     # Token storage
│   │   ├── jobs.ts            # Job queue operations
│   │   ├── liked-song.ts      # Liked songs management
│   │   ├── song.ts            # Song entities
│   │   ├── song-analysis.ts   # Song analysis data
│   │   ├── song-audio-feature.ts
│   │   ├── playlists.ts       # Playlist operations
│   │   ├── playlist-analysis.ts
│   │   ├── preferences.ts     # User preferences
│   │   ├── matching.ts        # Song matching logic
│   │   ├── newness.ts         # New song detection
│   │   └── vectors.ts         # Vector embeddings
│   ├── errors/                # Typed error definitions
│   │   ├── database.ts        # Database errors
│   │   ├── validation.ts      # Validation errors
│   │   ├── external/          # External API errors
│   │   │   ├── spotify.ts
│   │   │   ├── genius.ts
│   │   │   ├── deepinfra.ts
│   │   │   ├── llm.ts
│   │   │   └── network.ts
│   │   └── domain/            # Business logic errors
│   │       ├── analysis.ts
│   │       ├── embedding.ts
│   │       ├── job.ts
│   │       └── sync.ts
│   ├── services/              # Business logic services
│   │   ├── job-lifecycle.ts   # Job state management
│   │   ├── analysis/          # Song/playlist analysis
│   │   ├── deepinfra/         # DeepInfra API client
│   │   ├── embedding/         # Vector embeddings
│   │   ├── llm/               # LLM integrations
│   │   ├── lyrics/            # Lyrics fetching (Genius)
│   │   ├── reranker/          # Result reranking
│   │   ├── spotify/           # Spotify API client
│   │   └── sync/              # Library sync orchestration
│   ├── utils/                 # Shared utilities
│   │   ├── concurrency.ts     # Concurrency helpers
│   │   └── result-wrappers/   # Result type adapters
│   └── utils.ts               # General utilities (cn, etc.)
├── routes/                    # File-based routes (TanStack Router)
│   ├── __root.tsx             # Root layout
│   ├── index.tsx              # Home page
│   └── auth/                  # Auth flow routes
├── env.ts                     # Environment configuration
├── router.tsx                 # Router instance creation
├── routeTree.gen.ts           # Generated route tree (auto)
└── styles.css                 # Global Tailwind styles
```

**Routing Patterns:**
- File-based routing in `src/routes/`
- Root layout in `__root.tsx` with `shellComponent`
- Route context includes `QueryClient` for SSR hydration
- API routes use `api.{name}.ts` naming convention

**Data Fetching:**
- TanStack Query for client-side data fetching
- Route loaders for SSR data loading
- SSR-Query integration for hydration (`setupRouterSsrQueryIntegration`)

**Database & Type Safety (Supabase):**

The project uses Supabase with end-to-end type safety via generated types.

*Type Generation:*
```bash
bun run gen:types  # Regenerate after schema changes
```

*Client Setup (src/lib/data/client.ts):*
```typescript
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Generic parameter enables automatic type inference
export function createAdminSupabaseClient() {
  return createClient<Database>(url, key);
}
```

*Data Layer Patterns:*
| Pattern        | Rule                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| Error handling | ✅ Return `Result<T, DbError>` - no throwing in data layer              |
| Return types   | ✅ Annotate with Result type for explicit error contracts               |
| Row types      | Only export if external code needs them: `export type X = Tables<"x">` |
| Insert types   | Use `Pick<TablesInsert<"x">, "field1" \| "field2">` for partial inputs |
| Type casts     | ❌ Never use `as X` - indicates something is wrong                      |
| External APIs  | Manual interfaces OK (Spotify responses, etc.)                         |

*Example - Correct Pattern:*
```typescript
import type { Result } from "better-result";
import { createAdminSupabaseClient } from "./client";
import type { Tables, TablesInsert } from "./database.types";
import type { DbError } from "@/lib/errors/database";
import { fromSupabaseMaybe } from "@/lib/utils/result-wrappers/supabase";

export type Account = Tables<"account">;
export type UpsertData = Pick<TablesInsert<"account">, "spotify_id" | "email">;

// Returns Result - callers decide how to handle errors
export function getAccountById(
  id: string
): Promise<Result<Account | null, DbError>> {
  const supabase = createAdminSupabaseClient();
  return fromSupabaseMaybe(
    supabase.from("account").select("*").eq("id", id).single()
  );
}
```

*Error Handling at Boundaries:*
```typescript
// Route boundary translates Result → redirect/response
const accountResult = await getAccountById(id);
if (Result.isError(accountResult)) {
  throw redirect({ to: "/", search: { error: accountResult.error._tag } });
}
const account = accountResult.value;
```

**Error Architecture:**

All errors use `TaggedError` from `better-result`. Errors live in `src/lib/errors/` organized by layer:
- `external/` - External API errors (Spotify, Genius, LLM, etc.)
- `domain/` - Business logic errors (analysis, sync, jobs, etc.)
- Root level - Infrastructure errors (database, validation, network)

*Naming Convention:*
| Category | Pattern | Example |
| -------- | ------- | ------- |
| External API | `{Service}{Problem}Error` | `GeniusNotFoundError`, `SpotifyRateLimitError` |
| Domain | `{Domain}{State}Error` | `NoLyricsAvailableError`, `SyncFailedError` |
| Infrastructure | `{Resource}Error` | `NetworkError`, `DatabaseError` |

*Abstraction Boundaries:*

Services translate low-level errors into domain concepts:
```typescript
// GeniusNotFoundError (external) → NoLyricsAvailableError (domain)
if (Result.isError(lyricsResult)) {
  return Result.err(new NoLyricsAvailableError(songId, artist, title));
}
```

*Defining Errors:*
```typescript
import { TaggedError } from "better-result";

export class MyError extends TaggedError("MyError")<{
  reason: string;
  message: string;  // Always include for logging
}>() {
  constructor(reason: string) {
    super({ reason, message: `Failed: ${reason}` });
  }
}
```

*Rules:*
- ✅ Service-specific errors (`LlmRateLimitError`, not generic `RateLimitError`)
- ✅ Return `Result.err(new TypedError(...))` - never plain `throw new Error()`

*Workflow:*
1. Modify schema in `supabase/migrations/`
2. Run `bun run gen:types`
3. Types propagate everywhere automatically

**Zod Usage:**

Use Zod schemas as the **single source of truth** for runtime validation + type inference.

| Use Case | Pattern |
| -------- | ------- |
| Enums (not from DB) | `const X = z.enum([...]); type X = z.infer<typeof X>;` |
| API request/response | Define schema, infer type, validate at boundary |
| Form inputs | Schema for validation, `z.infer` for types |
| Config objects | Schema with defaults via `.default()` |

❌ Don't use plain `type X = "a" | "b"` when runtime validation is needed.
❌ Don't duplicate types (e.g., in class property AND constructor) - use Zod.
✅ Do use `Enums<...>` for database-derived enums (already typed via Supabase).

**Service Layer Patterns:**

Services in `src/lib/services/` follow this structure:
- Class with constructor injection + Zod-validated config
- All async methods return `Promise<Result<T, ErrorUnion>>`
- Factory function (e.g., `createMyService()`) handles env vars
- Error union type defined at module level

❌ Never throw in async methods — return `Result.err()`
❌ Never read env vars inside class methods

**Concurrency Patterns:**

| Pattern | When to Use |
|---------|-------------|
| `ConcurrencyLimiter` | External APIs with rate limits (e.g., Genius) |
| `Promise.all` | Independent ops, no rate limit concerns |
| `Promise.allSettled` | Partial success is acceptable |

See `src/lib/utils/concurrency.ts` for `ConcurrencyLimiter` implementation.

### Testing Strategy

- **Framework**: Vitest with React Testing Library
- **DOM**: jsdom environment
- **Run tests**: `bun test` or `pnpm test`
- Place tests in `__tests__/` directories or alongside components as `*.test.tsx`

### Git Workflow

- Feature branches for all development work
- Conventional commits recommended
- Main branch is protected

## Domain Context

### Spotify Integration
The app integrates with the Spotify Web API to:
- Authenticate users via Spotify OAuth
- Fetch user's "Liked Songs" (saved tracks)
- Read track metadata (genre, tempo, mood, etc.)
- Create and manage playlists

Audio features (danceability, energy, etc.) come from ReccoBeats since Spotify deprecated their `/audio-features` endpoint.

### External Services
| Service | Purpose |
|---------|---------|
| Spotify API | Authentication, library access, playlist management |
| ReccoBeats | Audio features (replaces deprecated Spotify audio-features endpoint) |
| Genius API | Lyrics fetching for content analysis |
| DeepInfra | LLM inference for song analysis |

### Key Domain Terms
- **Liked Songs**: Spotify's saved tracks collection (the "heart" button)
- **Audio Features**: ReccoBeats analysis data (danceability, energy, valence, tempo, etc.)
- **Song Analysis**: LLM-generated metadata (themes, mood, genre tags)
- **Playlist**: User-created or auto-generated song collections

## Important Constraints

### Technical Constraints
- **Edge Runtime**: Runs on Cloudflare Workers (no Node.js-specific APIs)
- **SSR**: Server-side rendering enabled—components must be SSR-safe
- **Bundle Size**: Edge deployment has size limits (~1-10MB)

### API Constraints
- Spotify API rate limits (varies by endpoint)
- OAuth token refresh handling required
- User must authorize app access to their Spotify account

### Browser Support
- Modern browsers only (ES2022 target)
- No IE11 support

## External Dependencies

### Spotify Web API
- **Auth**: OAuth 2.0 with PKCE flow (recommended for SPAs)
- **Endpoints**: `/me/tracks`, `/playlists` (audio-features deprecated → use ReccoBeats)
- **Docs**: https://developer.spotify.com/documentation/web-api

### ReccoBeats API
- **Purpose**: Audio features replacement for deprecated Spotify endpoint
- **Data**: danceability, energy, valence, tempo, acousticness, etc.
- **Docs**: https://reccobeats.com/docs/apis/reccobeats-api

### Cloudflare Workers
- **Deployment**: `bun run deploy` or `wrangler deploy`
- **Config**: `wrangler.jsonc`
- **Compatibility**: `nodejs_compat` flag enabled

### TanStack Ecosystem
- **Router Docs**: https://tanstack.com/router
- **Query Docs**: https://tanstack.com/query
- **Start Docs**: https://tanstack.com/start
