// posthog-js ships the session-replay recorder as a side-effect-only bundle with
// no type declaration. We import it to self-host rrweb (see ConsentProvider) so
// the recorder isn't lazy-fetched from /static/posthog-recorder.js, which ad
// blockers match by filename. This shim makes the bare side-effect import typed.
declare module "posthog-js/dist/posthog-recorder";
