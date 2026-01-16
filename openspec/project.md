# Project Context

## Purpose

**Hearted** is a web application for automatically sorting Spotify liked songs. It provides users with an interface to organize, categorize, and manage their Spotify "Liked Songs" library more effectively—likely enabling automatic playlist creation based on genres, moods, or other criteria.

This is `v1_hearted`, the first version of the app built with a modern TanStack-based architecture.

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

**Naming Conventions:**
- React components: PascalCase (e.g., `Header.tsx`)
- Utility functions: camelCase (e.g., `utils.ts`)
- Route files: kebab-case with dots for nesting (e.g., `start.ssr.full-ssr.tsx`)
- API routes: `api.{name}.ts` pattern

### Architecture Patterns

**Directory Structure:**
```
src/
├── components/       # Reusable UI components
├── data/            # Static data and fixtures
├── integrations/    # Third-party service integrations
│   └── tanstack-query/  # Query client setup
├── lib/             # Utility functions
├── routes/          # File-based routes (TanStack Router)
│   ├── __root.tsx   # Root layout
│   ├── index.tsx    # Home page
│   └── demo/        # Demo routes (deletable)
├── env.ts           # Environment configuration
├── router.tsx       # Router instance creation
└── styles.css       # Global Tailwind styles
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

**Component Patterns:**
- Functional components with TypeScript interfaces
- CVA for component variants
- Composable utility functions in `lib/utils.ts`

### Testing Strategy

- **Framework**: Vitest with React Testing Library
- **DOM**: jsdom environment
- **Run tests**: `bun test` or `pnpm test`
- Place tests in `__tests__/` directories or alongside components as `*.test.tsx`

### Git Workflow

- Feature branches for all development work
- Conventional commits recommended
- Main branch is protected
- Demo files (prefixed with `demo`) can be safely deleted

## Domain Context

### Spotify Integration
This app will integrate with the Spotify Web API to:
- Authenticate users via Spotify OAuth
- Fetch user's "Liked Songs" (saved tracks)
- Read track metadata (genre, tempo, mood, etc.)
- Create and manage playlists
- Potentially use Spotify's audio features API for sorting criteria

### Key Domain Terms
- **Hearted/Liked Songs**: Spotify's saved tracks collection
- **Audio Features**: Spotify's analysis data (danceability, energy, valence, etc.)
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
- **Endpoints**: `/me/tracks`, `/audio-features`, `/playlists`
- **Docs**: https://developer.spotify.com/documentation/web-api

### Cloudflare Workers
- **Deployment**: `bun run deploy` or `wrangler deploy`
- **Config**: `wrangler.jsonc`
- **Compatibility**: `nodejs_compat` flag enabled

### TanStack Ecosystem
- **Router Docs**: https://tanstack.com/router
- **Query Docs**: https://tanstack.com/query
- **Start Docs**: https://tanstack.com/start
