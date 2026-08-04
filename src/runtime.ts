import {
    ARCADE_PROTOCOL,
    type ArcadeEvent,
    type ConnectEnvelope,
    type ErrorResponseEnvelope,
    type JsonValue,
    type PortEnvelope,
    type RunCompleteResult,
    type RunStartResult,
    type SuccessResponseEnvelope,
} from "./protocol.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
    if (depth > 20) return false;
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
    )
        return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value))
        return (
            value.length <= 10_000 &&
            value.every((item) => isJsonValue(item, depth + 1))
        );
    if (!isRecord(value) || Object.keys(value).length > 1_000) return false;
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

export function isConnectEnvelope(value: unknown): value is ConnectEnvelope {
    return (
        isRecord(value) &&
        value.protocol === ARCADE_PROTOCOL &&
        value.type === "arcade.connect" &&
        typeof value.requestId === "string" &&
        value.requestId.length > 0 &&
        value.requestId.length <= 128
    );
}

const EVENTS = new Set<ArcadeEvent>(["lifecycle.pause", "lifecycle.resume"]);

export function parsePortEnvelope(value: unknown): PortEnvelope | null {
    if (
        !isRecord(value) ||
        value.protocol !== ARCADE_PROTOCOL ||
        typeof value.type !== "string"
    )
        return null;

    if (value.type === "response") {
        if (typeof value.id !== "string" || typeof value.ok !== "boolean")
            return null;
        if (value.ok) {
            if (!isJsonValue(value.result)) return null;
            return value as unknown as SuccessResponseEnvelope;
        }
        if (
            !isRecord(value.error) ||
            typeof value.error.code !== "string" ||
            typeof value.error.message !== "string"
        ) {
            return null;
        }
        return value as unknown as ErrorResponseEnvelope;
    }

    if (value.type === "event") {
        if (
            typeof value.event !== "string" ||
            !EVENTS.has(value.event as ArcadeEvent)
        )
            return null;
        if ("payload" in value && !isJsonValue(value.payload)) return null;
        return value as unknown as PortEnvelope;
    }

    return null;
}

export function parseRunStartResult(value: JsonValue): RunStartResult {
    if (
        !isRecord(value) ||
        typeof value.runHandle !== "string" ||
        typeof value.seed !== "string" ||
        typeof value.mode !== "string" ||
        typeof value.ruleset !== "string" ||
        typeof value.locale !== "string" ||
        !isRecord(value.capabilities)
    ) {
        throw new ArcadeProtocolError(
            "invalid_response",
            "The portal returned an invalid run response.",
        );
    }

    const capabilities = value.capabilities;
    for (const key of [
        "authenticated",
        "ranked",
        "rewards",
        "ratings",
    ] as const) {
        if (typeof capabilities[key] !== "boolean") {
            throw new ArcadeProtocolError(
                "invalid_response",
                `The portal returned an invalid ${key} capability.`,
            );
        }
    }

    return value as unknown as RunStartResult;
}

export function parseRunCompleteResult(value: JsonValue): RunCompleteResult {
    if (
        !isRecord(value) ||
        typeof value.runHandle !== "string" ||
        !["verifying", "accepted", "rejected", "recorded"].includes(
            String(value.status),
        ) ||
        typeof value.ranked !== "boolean" ||
        typeof value.historyRecorded !== "boolean" ||
        ("validationMessage" in value &&
            typeof value.validationMessage !== "string")
    ) {
        throw new ArcadeProtocolError(
            "invalid_response",
            "The portal returned an invalid completion response.",
        );
    }
    return value as unknown as RunCompleteResult;
}

export class ArcadeProtocolError extends Error {
    public readonly code: string;

    public constructor(code: string, message: string) {
        super(message);
        this.name = "ArcadeProtocolError";
        this.code = code;
    }
}
