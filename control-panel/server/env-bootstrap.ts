/**
 * Preloaded before the control-panel server entry (see the cp:api script's
 * `bun --preload`). Overlays .env.cloud onto process.env so @/env (t3-env, read
 * at import time) resolves PROD Supabase creds. This lets operations import and
 * reuse the app's library-processing reconciler — including its enrichment
 * kickoff — against prod instead of the dev DB bun's local .env points at.
 *
 * Must stay free of any @/env import so it runs before that module evaluates.
 */

import { loadCloudEnvIntoProcess } from "./prod-creds";

loadCloudEnvIntoProcess();
