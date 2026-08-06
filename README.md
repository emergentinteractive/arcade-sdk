# Emergent Arcade SDK

The MIT-licensed browser bridge used by games published on Emergent Arcade. It speaks
`emergent.arcade.v1` over a transferred `MessageChannel`; cookies, account identifiers,
OIDC tokens, analytics credentials, age, email, and balances are never exposed to a game.

```sh
npm install @emergentinteractive/arcade-sdk
```

## Quick start

```ts
import { Arcade, type JsonValue } from "@emergentinteractive/arcade-sdk";

const arcade = await Arcade.initialize({ timeoutMs: 3_000 });
const settings = await arcade.settings.get();

applyLocale(settings.locale);
setMuted(settings.muted);
setReducedMotion(settings.reducedMotion);
setHighContrast(settings.highContrast);

const stopPauseListener = arcade.lifecycle.onPause(() => game.pause());
const stopResumeListener = arcade.lifecycle.onResume(() => game.resume());
await arcade.lifecycle.ready();

const run = await arcade.runs.start({ mode: "score_attack" });
game.start({ seed: run.seed });

const proof: JsonValue = buildDeterministicProof(run.seed);
const completion = await arcade.runs.complete({
    score: 420,
    result: "completed",
    durationMs: 90_000,
    stats: { goals: 1, longestRally: 18 },
    ...(run.capabilities.ranked ? { proof } : {}),
});

if (completion.runHandle !== run.runHandle) {
    throw new Error("Arcade returned a mismatched run handle.");
}

stopPauseListener();
stopResumeListener();
arcade.close();
```

Call `runs.start()` immediately before authoritative play begins and use only its
server-issued seed for a deterministic ranked run. A capability-false run is valid
casual play; do not label it ranked or attach a ranked proof. The shell decides whether
the submitted result enters verification, history, rewards, or a leaderboard.

## Daily challenges

SDK 0.1.3 adds optional immutable challenge metadata to `RunStartResult` without
exposing account or leaderboard data:

```ts
if (run.challenge) {
    const { id, date, attempt, attemptLimit, attemptsRemaining } =
        run.challenge;

    challengeLabel.textContent = date;
    attemptLabel.textContent =
        attempt === null
            ? attemptsRemaining === 0
                ? "Casual replay · ranked attempts used"
                : "Casual daily board"
            : `Ranked attempt ${attempt} of ${attemptLimit}`;

    startDailyBoard({ id, seed: run.seed });
}
```

`attempt` is `null` for casual and guest runs. `attemptsRemaining` is `null` when
ranked attempts do not apply and `0` after the ranked cap is exhausted. `attemptLimit`
is the public cap, or `null` when no cap is declared. A challenge may still be present
for capability-false, casual, and guest runs so every player can receive the same
deterministic board. Treat `id`, `date`, and the seed as run-bound values; never derive
or replace them with the browser clock.

## Runtime API

### Initialize and lifecycle

`Arcade.initialize(options?)` connects to the embedding shell. `timeoutMs` defaults to
10,000 and accepts integers from 250 through 60,000. In production, omit
`portalOrigin`: the SDK derives the exact embedding origin from `document.referrer` and
falls back to the production Arcade origin. An explicit non-HTTPS origin is accepted
only for `localhost`, `127.0.0.1`, or `[::1]` development.

Pause and resume are pushed by the shell:

```ts
const offPause = arcade.lifecycle.onPause(() => {
    input.neutralize();
    game.pause();
});
const offResume = arcade.lifecycle.onResume(() => {
    input.suppressHeldControlsUntilReleased();
    showResumeDialog();
});

// Both registration methods return an unsubscribe function.
offPause();
offResume();
```

Signal `lifecycle.ready()` only after settings, listeners, UI, and the first playable
frame are ready. The host can pause for blur, hidden tabs, navigation, or policy
reasons. Whether a ranked clock continues is part of the game's approved ruleset, so
neutralize input even when simulation time continues.

### Settings, capabilities, and runs

`settings.get()` returns `{ locale, muted, reducedMotion, highContrast }`. Apply all
four values without storing them. `runs.start({ mode })` accepts a non-empty snake-case
mode of at most 64 characters and returns:

- `runHandle`: opaque identity used to verify the matching completion response;
- `seed`, `mode`, `ruleset`, and `locale`: authoritative run bindings;
- `capabilities.authenticated`, `ranked`, `rewards`, and `ratings`: independent booleans;
- optional `challenge`: daily challenge identity and attempt metadata described above.

`runs.complete(outcome)` accepts an optional non-negative safe-integer `score`, one of
`completed`, `abandoned`, `lost`, `won`, or `draw`, an integer `durationMs` from 0
through 3,600,000, and optional JSON-compatible `stats` and `proof`. It returns the
same `runHandle`, a `status` of `verifying`, `accepted`, `rejected`, or `recorded`, plus
`ranked`, `historyRecorded`, and an optional `validationMessage`. Do not infer ranked
acceptance from a submitted score; use the completion result.

Abandon every started run that exits through retry, quit, or menu flow:

```ts
async function abandonRun(run: { runHandle: string }, durationMs: number) {
    const completion = await arcade.runs.complete({
        result: "abandoned",
        durationMs,
    });
    if (completion.runHandle !== run.runHandle) {
        throw new Error("Arcade returned a mismatched run handle.");
    }
}
```

### Fullscreen, telemetry, and shutdown

`ui.requestFullscreen()` resolves to `false` when fullscreen is unavailable or the
browser declines the request. Always retain a usable embedded layout. Call it only from
a player gesture.

`telemetry.reportError({ name, message, stack?, context? })` reports a bounded,
developer-selected error to the shell. Never include player data, secrets, tokens, free
text entered by a player, or complete URLs in its context. Call `arcade.close()` and
remove lifecycle listeners when permanently disposing the game bridge.

## Embedding and security

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

The public repository currently uses a manual release path. The workflow files kept in
the monorepo source are inactive templates and are deliberately excluded from the
standalone repository until its protected `npm` environment and npm trusted publisher
are configured.

Before publishing a new, unpublished version, update `package.json`, its lockfile,
`SDK_VERSION`, and `CHANGELOG.md`. From a clean standalone checkout on `main`, run:

```sh
npm ci --ignore-scripts
npm run format:check
npm run release:check
npm pack --dry-run --ignore-scripts
npm view @emergentinteractive/arcade-sdk version
```

An authorized maintainer can then authenticate to npm outside the repository and publish
the verified package manually. Never put an npm token in a tracked `.npmrc`, a shell
history entry, a commit, or a CI log.

```sh
npm publish --access public --ignore-scripts
npm view @emergentinteractive/arcade-sdk@0.1.3 version dist.integrity
```

Replace `0.1.3` in the verification command with the version being released. Only after
the registry reports that exact version should the already-pushed release commit receive
an annotated `vX.Y.Z` tag that exactly matches `package.json`:

```sh
git tag -a v0.1.3 -m "Release 0.1.3"
git push origin v0.1.3
```

Never reuse a version already present in npm; published versions are immutable. When the
tag-triggered workflow is eventually enabled, stop publishing manually: the release tag
becomes the sole publish action. That workflow uses GitHub OIDC and does not require a
long-lived npm token. Protect release tags and the `npm` GitHub environment, then select
the `emergentinteractive/arcade-sdk` repository, `publish.yml` workflow, and `npm`
environment in npm trusted-publisher settings.
