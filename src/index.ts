import {
    ARCADE_PROTOCOL,
    type ArcadeEvent,
    type ArcadeMethod,
    type ArcadeSettings,
    type ConnectedEnvelope,
    type JsonValue,
    type RequestEnvelope,
    type RunCompleteInput,
    type RunCompleteResult,
    type RunStartInput,
    type RunStartResult,
    type TelemetryErrorInput,
} from "./protocol.js";
import {
    ArcadeProtocolError,
    isConnectEnvelope,
    isRecord,
    parsePortEnvelope,
    parseRunCompleteResult,
    parseRunStartResult,
} from "./runtime.js";

export { ARCADE_PROTOCOL, ArcadeProtocolError };
export type {
    ArcadeSettings,
    JsonValue,
    PlayerCapabilities,
    RunCompleteInput,
    RunCompleteResult,
    RunStartInput,
    RunStartResult,
    TelemetryErrorInput,
} from "./protocol.js";
export {
    isConnectEnvelope,
    isJsonValue,
    parsePortEnvelope,
} from "./runtime.js";

export const SDK_VERSION = "0.1.2";
const DEFAULT_PORTAL_ORIGIN = "https://arcade.emergentinteractive.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RUN_DURATION_MS = 3_600_000;
const RUN_MODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export interface InitializeOptions {
    /** Exact portal origin. Keep the production default outside local development. */
    portalOrigin?: string;
    /** Maximum time to wait for the parent handshake and each request. */
    timeoutMs?: number;
    /** Injectable window for isolated tests. */
    window?: Window;
}

type Listener = () => void;

interface PendingRequest {
    resolve: (value: JsonValue) => void;
    reject: (reason: ArcadeProtocolError) => void;
    timeout: ReturnType<typeof setTimeout>;
}

function makeId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function")
        return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
        throw new ArcadeProtocolError(
            "crypto_unavailable",
            "A secure random source is required for Arcade request IDs.",
        );
    }
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) =>
        value.toString(16).padStart(2, "0"),
    ).join("");
}

function requireExactOrigin(value: string): string {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new ArcadeProtocolError(
            "invalid_origin",
            "portalOrigin must be an absolute origin.",
        );
    }
    if (
        parsed.origin !== value ||
        !["https:", "http:"].includes(parsed.protocol)
    ) {
        throw new ArcadeProtocolError(
            "invalid_origin",
            "portalOrigin must contain only scheme, host, and optional port.",
        );
    }
    if (
        parsed.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    ) {
        throw new ArcadeProtocolError(
            "invalid_origin",
            "Non-local Arcade origins must use HTTPS.",
        );
    }
    return parsed.origin;
}

function inferEmbeddingOrigin(targetWindow: Window): string | undefined {
    try {
        const referrer = targetWindow.document.referrer;
        if (!referrer) return undefined;

        return requireExactOrigin(new URL(referrer).origin);
    } catch {
        return undefined;
    }
}

function assertRunCompleteInput(input: RunCompleteInput): void {
    if (
        !["completed", "abandoned", "lost", "won", "draw"].includes(
            input.result,
        )
    ) {
        throw new ArcadeProtocolError(
            "invalid_request",
            "result is not supported.",
        );
    }
    if (
        !Number.isInteger(input.durationMs) ||
        input.durationMs < 0 ||
        input.durationMs > MAX_RUN_DURATION_MS
    ) {
        throw new ArcadeProtocolError(
            "invalid_request",
            "durationMs must be an integer from 0 to 3600000.",
        );
    }
    if (
        input.score !== undefined &&
        (!Number.isSafeInteger(input.score) || input.score < 0)
    ) {
        throw new ArcadeProtocolError(
            "invalid_request",
            "score must be a non-negative safe integer.",
        );
    }
}

export class ArcadeClient {
    readonly lifecycle: {
        ready: () => Promise<void>;
        onPause: (listener: Listener) => () => void;
        onResume: (listener: Listener) => () => void;
    };

    readonly runs: {
        start: (input: RunStartInput) => Promise<RunStartResult>;
        complete: (input: RunCompleteInput) => Promise<RunCompleteResult>;
    };

    readonly settings: { get: () => Promise<ArcadeSettings> };
    readonly ui: { requestFullscreen: () => Promise<boolean> };
    readonly telemetry: {
        reportError: (input: TelemetryErrorInput) => Promise<void>;
    };

    private readonly pending = new Map<string, PendingRequest>();
    private readonly listeners = new Map<ArcadeEvent, Set<Listener>>([
        ["lifecycle.pause", new Set()],
        ["lifecycle.resume", new Set()],
    ]);
    private closed = false;

    public constructor(
        private readonly port: MessagePort,
        private readonly timeoutMs: number,
    ) {
        port.addEventListener("message", this.handleMessage);
        port.addEventListener("messageerror", this.handleMessageError);
        port.start();

        this.lifecycle = {
            ready: async () => {
                await this.request("lifecycle.ready", {});
            },
            onPause: (listener) => this.subscribe("lifecycle.pause", listener),
            onResume: (listener) =>
                this.subscribe("lifecycle.resume", listener),
        };

        this.runs = {
            start: async (input) => {
                if (
                    !input.mode ||
                    input.mode.length > 64 ||
                    !RUN_MODE_PATTERN.test(input.mode)
                ) {
                    throw new ArcadeProtocolError(
                        "invalid_request",
                        "Run mode must be a short snake_case identifier.",
                    );
                }
                return parseRunStartResult(
                    await this.request("runs.start", { mode: input.mode }),
                );
            },
            complete: async (input) => {
                assertRunCompleteInput(input);
                return parseRunCompleteResult(
                    await this.request(
                        "runs.complete",
                        input as unknown as JsonValue,
                    ),
                );
            },
        };

        this.settings = {
            get: async () => {
                const value = await this.request("settings.get", {});
                if (
                    !isRecord(value) ||
                    typeof value.locale !== "string" ||
                    typeof value.muted !== "boolean" ||
                    typeof value.reducedMotion !== "boolean" ||
                    typeof value.highContrast !== "boolean"
                ) {
                    throw new ArcadeProtocolError(
                        "invalid_response",
                        "The portal returned invalid settings.",
                    );
                }
                return value as unknown as ArcadeSettings;
            },
        };

        this.ui = {
            requestFullscreen: async () =>
                (await this.request("ui.requestFullscreen", {})) === true,
        };

        this.telemetry = {
            reportError: async (input) => {
                if (!input.name || !input.message) return;
                const payload: TelemetryErrorInput = {
                    name: input.name.slice(0, 100),
                    message: input.message.slice(0, 1_000),
                    ...(input.stack
                        ? { stack: input.stack.slice(0, 8_000) }
                        : {}),
                    ...(input.context ? { context: input.context } : {}),
                };
                await this.request(
                    "telemetry.reportError",
                    payload as unknown as JsonValue,
                );
            },
        };
    }

    public close(): void {
        if (this.closed) return;
        this.closed = true;
        this.port.removeEventListener("message", this.handleMessage);
        this.port.removeEventListener("messageerror", this.handleMessageError);
        this.port.close();
        for (const request of this.pending.values()) {
            clearTimeout(request.timeout);
            request.reject(
                new ArcadeProtocolError(
                    "closed",
                    "The Arcade bridge was closed.",
                ),
            );
        }
        this.pending.clear();
    }

    private readonly handleMessage = (event: MessageEvent<unknown>): void => {
        const message = parsePortEnvelope(event.data);
        if (!message) return;

        if (message.type === "response") {
            const request = this.pending.get(message.id);
            if (!request) return;
            this.pending.delete(message.id);
            clearTimeout(request.timeout);
            if (message.ok) request.resolve(message.result);
            else
                request.reject(
                    new ArcadeProtocolError(
                        message.error.code,
                        message.error.message,
                    ),
                );
            return;
        }

        if (message.type === "event") {
            for (const listener of this.listeners.get(message.event) ?? []) {
                try {
                    listener();
                } catch {
                    // A game listener must never break the protocol loop.
                }
            }
        }
    };

    private readonly handleMessageError = (): void => {
        this.close();
    };

    private subscribe(event: ArcadeEvent, listener: Listener): () => void {
        const listeners = this.listeners.get(event);
        listeners?.add(listener);
        return () => listeners?.delete(listener);
    }

    private request(
        method: ArcadeMethod,
        payload: JsonValue,
    ): Promise<JsonValue> {
        if (this.closed)
            return Promise.reject(
                new ArcadeProtocolError(
                    "closed",
                    "The Arcade bridge is closed.",
                ),
            );
        const id = makeId();
        const message: RequestEnvelope = {
            protocol: ARCADE_PROTOCOL,
            type: "request",
            id,
            method,
            payload,
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(
                    new ArcadeProtocolError("timeout", `${method} timed out.`),
                );
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timeout });
            this.port.postMessage(message);
        });
    }
}

async function initialize(
    options: InitializeOptions = {},
): Promise<ArcadeClient> {
    const targetWindow = options.window ?? globalThis.window;
    if (!targetWindow || targetWindow.parent === targetWindow) {
        throw new ArcadeProtocolError(
            "not_embedded",
            "Arcade games must run inside the portal game shell.",
        );
    }

    const portalOrigin = options.portalOrigin
        ? requireExactOrigin(options.portalOrigin)
        : (inferEmbeddingOrigin(targetWindow) ?? DEFAULT_PORTAL_ORIGIN);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 60_000) {
        throw new ArcadeProtocolError(
            "invalid_timeout",
            "timeoutMs must be between 250 and 60000.",
        );
    }

    return new Promise<ArcadeClient>((resolve, reject) => {
        const timer = setTimeout(() => {
            targetWindow.removeEventListener("message", onConnect);
            reject(
                new ArcadeProtocolError(
                    "handshake_timeout",
                    "The Arcade portal did not connect.",
                ),
            );
        }, timeoutMs);

        function onConnect(event: MessageEvent<unknown>): void {
            if (
                event.source !== targetWindow.parent ||
                event.origin !== portalOrigin
            )
                return;
            if (!isConnectEnvelope(event.data) || event.ports.length !== 1)
                return;

            clearTimeout(timer);
            targetWindow.removeEventListener("message", onConnect);
            const port = event.ports[0];
            if (!port) {
                reject(
                    new ArcadeProtocolError(
                        "invalid_handshake",
                        "The Arcade portal did not transfer a message port.",
                    ),
                );
                return;
            }
            const response: ConnectedEnvelope = {
                protocol: ARCADE_PROTOCOL,
                type: "arcade.connected",
                requestId: event.data.requestId,
                sdkVersion: SDK_VERSION,
            };
            port.postMessage(response);
            resolve(new ArcadeClient(port, timeoutMs));
        }

        targetWindow.addEventListener("message", onConnect);
    });
}

export const Arcade = Object.freeze({ initialize });
export { initialize };
