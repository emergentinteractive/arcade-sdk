export const ARCADE_PROTOCOL = "emergent.arcade.v1" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
    JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ArcadeMethod =
    | "lifecycle.ready"
    | "runs.start"
    | "runs.complete"
    | "settings.get"
    | "ui.requestFullscreen"
    | "telemetry.reportError";

export type ArcadeEvent = "lifecycle.pause" | "lifecycle.resume";

export interface ConnectEnvelope {
    protocol: typeof ARCADE_PROTOCOL;
    type: "arcade.connect";
    requestId: string;
}

export interface ConnectedEnvelope {
    protocol: typeof ARCADE_PROTOCOL;
    type: "arcade.connected";
    requestId: string;
    sdkVersion: string;
}

export interface RequestEnvelope {
    protocol: typeof ARCADE_PROTOCOL;
    type: "request";
    id: string;
    method: ArcadeMethod;
    payload: JsonValue;
}

export interface SuccessResponseEnvelope {
    protocol: typeof ARCADE_PROTOCOL;
    type: "response";
    id: string;
    ok: true;
    result: JsonValue;
}

export interface ErrorResponseEnvelope {
    protocol: typeof ARCADE_PROTOCOL;
    type: "response";
    id: string;
    ok: false;
    error: {
        code: string;
        message: string;
    };
}

export interface EventEnvelope {
    protocol: typeof ARCADE_PROTOCOL;
    type: "event";
    event: ArcadeEvent;
    payload?: JsonValue;
}

export type PortEnvelope =
    | ConnectedEnvelope
    | RequestEnvelope
    | SuccessResponseEnvelope
    | ErrorResponseEnvelope
    | EventEnvelope;

export interface PlayerCapabilities {
    authenticated: boolean;
    ranked: boolean;
    rewards: boolean;
    ratings: boolean;
}

export interface RunStartInput {
    mode: string;
}

export interface RunStartResult {
    runHandle: string;
    seed: string;
    mode: string;
    ruleset: string;
    locale: string;
    capabilities: PlayerCapabilities;
}

export interface RunCompleteInput {
    score?: number;
    result: "completed" | "abandoned" | "lost" | "won" | "draw";
    durationMs: number;
    stats?: Record<string, JsonValue>;
    proof?: JsonValue;
}

export interface RunCompleteResult {
    runHandle: string;
    status: "verifying" | "accepted" | "rejected" | "recorded";
    ranked: boolean;
    historyRecorded: boolean;
    validationMessage?: string;
}

export interface ArcadeSettings {
    locale: string;
    muted: boolean;
    reducedMotion: boolean;
    highContrast: boolean;
}

export interface TelemetryErrorInput {
    name: string;
    message: string;
    stack?: string;
    context?: Record<string, JsonValue>;
}
