import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    ARCADE_PROTOCOL,
    ArcadeClient,
    initialize,
    isConnectEnvelope,
    isJsonValue,
    parsePortEnvelope,
} from "../dist/index.js";

const packageMetadata = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

function runPackageVerifier(tag) {
    const environment = { ...process.env };
    delete environment.CI_COMMIT_TAG;
    delete environment.GITHUB_REF;
    delete environment.GITHUB_REF_NAME;
    delete environment.GITHUB_REF_TYPE;
    if (tag !== null) environment.CI_COMMIT_TAG = tag;

    return spawnSync(
        process.execPath,
        [
            fileURLToPath(
                new URL("../scripts/verify-package.mjs", import.meta.url),
            ),
        ],
        {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            encoding: "utf8",
            env: environment,
        },
    );
}

test("infers the exact staging portal origin from the embedding referrer", async () => {
    const parent = {};
    let messageListener;
    const fakeWindow = {
        parent,
        document: {
            referrer: "https://staging.arcade.example.test/games/example/play",
        },
        addEventListener(type, listener) {
            if (type === "message") messageListener = listener;
        },
        removeEventListener() {},
    };
    const channel = new MessageChannel();
    const connected = new Promise((resolve) => {
        channel.port2.onmessage = ({ data }) => resolve(data);
    });
    const pending = initialize({ window: fakeWindow, timeoutMs: 500 });

    messageListener({
        source: parent,
        origin: "https://staging.arcade.example.test",
        data: {
            protocol: ARCADE_PROTOCOL,
            type: "arcade.connect",
            requestId: "staging-connect",
        },
        ports: [channel.port1],
    });

    const client = await pending;
    assert.ok(client instanceof ArcadeClient);
    assert.equal((await connected).sdkVersion, packageMetadata.version);
    client.close();
    channel.port2.close();
});

test("scopes GitLab release-tag validation to SDK tags", () => {
    for (const tag of [
        null,
        "production-2026-08-04",
        `arcade-sdk-v${packageMetadata.version}`,
    ]) {
        const verified = runPackageVerifier(tag);
        assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    }

    const rejected = runPackageVerifier("arcade-sdk-v999.0.0");
    assert.notEqual(rejected.status, 0);
    assert.match(
        rejected.stderr,
        /release tag must match the SDK package version/i,
    );
});

test("accepts only the versioned connect envelope", () => {
    assert.equal(
        isConnectEnvelope({
            protocol: ARCADE_PROTOCOL,
            type: "arcade.connect",
            requestId: "abc",
        }),
        true,
    );
    assert.equal(
        isConnectEnvelope({
            protocol: "old",
            type: "arcade.connect",
            requestId: "abc",
        }),
        false,
    );
    assert.equal(
        isConnectEnvelope({
            protocol: ARCADE_PROTOCOL,
            type: "arcade.connect",
            requestId: "",
        }),
        false,
    );
});

test("correlates port requests and ignores spoofed response ids", async () => {
    const channel = new MessageChannel();
    const client = new ArcadeClient(channel.port1, 500);
    channel.port2.onmessage = ({ data }) => {
        channel.port2.postMessage({
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: "spoofed",
            ok: true,
            result: {},
        });
        channel.port2.postMessage({
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: data.id,
            ok: true,
            result: {
                runHandle: "opaque-run",
                seed: "server-seed",
                mode: "score_attack",
                ruleset: "rules-v1",
                locale: "en",
                capabilities: {
                    authenticated: true,
                    ranked: true,
                    rewards: true,
                    ratings: true,
                },
                challenge: {
                    id: "faultline:daily_sprint:2026-08-06",
                    date: "2026-08-06",
                    attempt: 2,
                    attemptLimit: 3,
                    attemptsRemaining: 1,
                },
            },
        });
    };
    const run = await client.runs.start({ mode: "score_attack" });
    assert.equal(run.seed, "server-seed");
    assert.deepEqual(run.challenge, {
        id: "faultline:daily_sprint:2026-08-06",
        date: "2026-08-06",
        attempt: 2,
        attemptLimit: 3,
        attemptsRemaining: 1,
    });
    client.close();
    channel.port2.close();
});

test("accepts casual daily challenge metadata with exhausted attempts", async () => {
    const channel = new MessageChannel();
    const client = new ArcadeClient(channel.port1, 500);
    channel.port2.onmessage = ({ data }) => {
        channel.port2.postMessage({
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: data.id,
            ok: true,
            result: {
                runHandle: "casual-daily-run",
                seed: "shared-daily-seed",
                mode: "daily_sprint",
                ruleset: "faultline-daily-sprint-v1",
                locale: "en",
                capabilities: {
                    authenticated: true,
                    ranked: false,
                    rewards: false,
                    ratings: false,
                },
                challenge: {
                    id: "faultline:daily_sprint:2026-08-06",
                    date: "2026-08-06",
                    attempt: null,
                    attemptLimit: 3,
                    attemptsRemaining: 0,
                },
            },
        });
    };

    const run = await client.runs.start({ mode: "daily_sprint" });
    assert.equal(run.challenge?.attempt, null);
    assert.equal(run.challenge?.attemptsRemaining, 0);
    client.close();
    channel.port2.close();
});

test("preserves start responses from hosts without challenge metadata", async () => {
    const channel = new MessageChannel();
    const client = new ArcadeClient(channel.port1, 500);
    channel.port2.onmessage = ({ data }) => {
        channel.port2.postMessage({
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: data.id,
            ok: true,
            result: {
                runHandle: "classic-run",
                seed: "classic-seed",
                mode: "score_attack",
                ruleset: "classic-rules-v1",
                locale: "en",
                capabilities: {
                    authenticated: true,
                    ranked: true,
                    rewards: true,
                    ratings: true,
                },
            },
        });
    };

    const run = await client.runs.start({ mode: "score_attack" });
    assert.equal(run.runHandle, "classic-run");
    assert.equal("challenge" in run, false);
    client.close();
    channel.port2.close();
});

test("rejects malformed or inconsistent run challenge metadata", async () => {
    for (const challenge of [
        {
            id: "faultline:daily_sprint:2026-02-30",
            date: "2026-02-30",
            attempt: 1,
            attemptLimit: 3,
            attemptsRemaining: 2,
        },
        {
            id: "faultline:daily_sprint:2026-08-06",
            date: "2026-08-06",
            attempt: 3,
            attemptLimit: 3,
            attemptsRemaining: 1,
        },
        {
            id: "faultline:daily_sprint:2026-08-06",
            date: "2026-08-06",
            attempt: null,
            attemptLimit: 3,
            attemptsRemaining: 2,
        },
    ]) {
        const channel = new MessageChannel();
        const client = new ArcadeClient(channel.port1, 500);
        channel.port2.onmessage = ({ data }) => {
            channel.port2.postMessage({
                protocol: ARCADE_PROTOCOL,
                type: "response",
                id: data.id,
                ok: true,
                result: {
                    runHandle: "bad-daily-run",
                    seed: "shared-daily-seed",
                    mode: "daily_sprint",
                    ruleset: "faultline-daily-sprint-v1",
                    locale: "en",
                    capabilities: {
                        authenticated: true,
                        ranked: true,
                        rewards: false,
                        ratings: true,
                    },
                    challenge,
                },
            });
        };

        await assert.rejects(
            client.runs.start({ mode: "daily_sprint" }),
            (error) =>
                error.code === "invalid_response" &&
                /challenge metadata/i.test(error.message),
        );
        client.close();
        channel.port2.close();
    }
});

test("rejects malformed or non-finite JSON values", () => {
    assert.equal(isJsonValue({ okay: [1, true, null] }), true);
    assert.equal(isJsonValue({ bad: Number.NaN }), false);
    assert.equal(isJsonValue({ bad: undefined }), false);
});

test("requires a correlated response-shaped envelope", () => {
    assert.deepEqual(
        parsePortEnvelope({
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: "1",
            ok: true,
            result: { accepted: true },
        }),
        {
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: "1",
            ok: true,
            result: { accepted: true },
        },
    );
    assert.equal(
        parsePortEnvelope({
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: "1",
            ok: true,
        }),
        null,
    );
    assert.equal(
        parsePortEnvelope({
            protocol: ARCADE_PROTOCOL,
            type: "event",
            event: "account.details",
        }),
        null,
    );
});

test("accepts draw completions up to the 60-minute transport limit", async () => {
    const channel = new MessageChannel();
    const client = new ArcadeClient(channel.port1, 500);
    channel.port2.onmessage = ({ data }) => {
        channel.port2.postMessage({
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: data.id,
            ok: true,
            result: {
                runHandle: "draw-run",
                status: "recorded",
                ranked: false,
                historyRecorded: true,
            },
        });
    };

    const result = await client.runs.complete({
        result: "draw",
        durationMs: 3_600_000,
    });
    assert.equal(result.runHandle, "draw-run");
    await assert.rejects(
        client.runs.complete({
            result: "completed",
            durationMs: 3_600_001,
        }),
        (error) => error.code === "invalid_request",
    );
    client.close();
    channel.port2.close();
});

test("rejects run modes that the server cannot accept", async () => {
    const channel = new MessageChannel();
    const client = new ArcadeClient(channel.port1, 500);
    await assert.rejects(
        client.runs.start({ mode: "Score Attack" }),
        (error) => error.code === "invalid_request",
    );
    client.close();
    channel.port2.close();
});

test("returns false when the portal cannot enter fullscreen", async () => {
    const channel = new MessageChannel();
    const client = new ArcadeClient(channel.port1, 500);
    channel.port2.onmessage = ({ data }) => {
        channel.port2.postMessage({
            protocol: ARCADE_PROTOCOL,
            type: "response",
            id: data.id,
            ok: true,
            result: false,
        });
    };

    assert.equal(await client.ui.requestFullscreen(), false);
    client.close();
    channel.port2.close();
});

test("rejects pending requests when the bridge closes", async () => {
    const channel = new MessageChannel();
    const client = new ArcadeClient(channel.port1, 500);
    const pending = client.lifecycle.ready();
    client.close();

    await assert.rejects(pending, (error) => error.code === "closed");
    channel.port2.close();
});
