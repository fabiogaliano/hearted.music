# Routes Organization

We use **hierarchical directory-based routing** with folders for clarity.

## Structure

```
routes/
├── __root.tsx              ← Root layout
├── index.tsx               ← /
├── onboarding.tsx          ← /onboarding
│
├── api/                    ← API endpoints (/api/*)
│   ├── [resource]/
│   │   ├── index.tsx      ← GET/POST /api/[resource]
│   │   ├── $id.tsx        ← GET/PUT/DELETE /api/[resource]/:id
│   │   └── $id/
│   │       └── [action].tsx  ← POST /api/[resource]/:id/[action]
│
└── auth/                   ← Auth routes (/auth/*)
    └── [provider]/
        ├── index.tsx       ← Initiate OAuth
        └── callback.tsx    ← OAuth callback
```

## Special Files

| Pattern     | Example                  | URL               | Purpose         |
| ----------- | ------------------------ | ----------------- | --------------- |
| `index.tsx` | `posts/index.tsx`        | `/posts`          | Exact match     |
| `$param`    | `jobs/$id.tsx`           | `/jobs/123`       | Dynamic param   |
| `$`         | `files/$.tsx`            | `/files/any/path` | Wildcard        |
| `route.tsx` | `auth/spotify/route.tsx` | -                 | Layout (no URL) |

## Patterns

### API Endpoints
```
api/playlists/
├── index.tsx         → GET/POST /api/playlists
├── $id.tsx          → GET/PUT/DELETE /api/playlists/:id
└── $id/
    └── sync.tsx     → POST /api/playlists/:id/sync
```

### Auth Providers
```
auth/spotify/
├── route.tsx        → Layout
├── index.tsx        → /auth/spotify (initiate)
└── callback.tsx     → /auth/spotify/callback
```

## Resources
- [TanStack Router Docs](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing)
