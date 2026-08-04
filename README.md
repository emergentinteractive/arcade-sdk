# Emergent Arcade SDK

The MIT-licensed browser bridge used by games published on Emergent Arcade. It speaks
`emergent.arcade.v1` over a transferred `MessageChannel`; cookies, account identifiers,
OIDC tokens, analytics credentials, age, email, and balances are never exposed to a game.

```sh
npm install @emergentinteractive/arcade-sdk
```

```ts
import { Arcade } from "@emergentinteractive/arcade-sdk";

const arcade = await Arcade.initialize();
await arcade.lifecycle.ready();

const run = await arcade.runs.start({ mode: "score_attack" });
const completion = await arcade.runs.complete({
    score: 420,
    result: "completed",
    durationMs: 90_000,
    stats: { goals: 1, longestRally: 18 },
    proof: { version: 1, seed: run.seed, transitions: [] },
});
```

Pause and resume are pushed by the shell:

```ts
arcade.lifecycle.onPause(() => game.pause());
arcade.lifecycle.onResume(() => game.resume());
```

`durationMs` may be at most 60 minutes. `ui.requestFullscreen()` resolves to `false`
when fullscreen is unavailable or the browser declines the request, so games should keep
their normal layout usable without fullscreen.

By default, the SDK derives the exact embedding origin from `document.referrer`, so one
immutable release can pass review on staging and then run unchanged in production. The
release-host `frame-ancestors` policy remains the embedding allowlist. For unusual local
setups without a referrer, pass an exact loopback origin:

```ts
await Arcade.initialize({ portalOrigin: "http://localhost:5173" });
```

The SDK rejects malformed envelopes, unknown origins, non-parent senders, late replies,
and uncorrelated request IDs. The portal shell is responsible for same-origin API calls,
CSRF protection, session handling, and idempotency headers.

## Contributing

Issues and pull requests are welcome at
[emergentinteractive/arcade-sdk](https://github.com/emergentinteractive/arcade-sdk).
Use Node.js 20 or newer and npm 11.5.1:

```sh
git clone https://github.com/emergentinteractive/arcade-sdk.git
cd arcade-sdk
npm ci --ignore-scripts
npm run format:check
npm run release:check
```

Run `npm run format` before submitting changes that affect formatting. `release:check`
rebuilds the SDK, runs its tests and type checks, and inspects the exact npm package
contents.

## Maintainer release

Release automation is not active in this repository yet. Before a maintainer publishes
a release, update the version in `package.json`, document it in `CHANGELOG.md`, and run:

```sh
npm ci --ignore-scripts
npm run format:check
npm run release:check
npm pack --dry-run --ignore-scripts
```

Once GitHub Actions and npm trusted publishing have been enabled, the release commit can
be tagged with a `vX.Y.Z` tag that exactly matches `package.json`:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The publish workflow uses GitHub OIDC and does not require a long-lived npm token. Protect
release tags and the `npm` GitHub environment. In npm trusted-publisher settings, select
the `emergentinteractive/arcade-sdk` repository, `publish.yml` workflow, and `npm`
environment. npm versions are immutable, so never reuse a published version.
