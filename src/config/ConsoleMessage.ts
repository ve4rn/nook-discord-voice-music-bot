import { env } from "./env.js";

export type ConsoleMessageType = "Warn" | "Error" | "Info" | "Success" | "Debug";

type ConsoleMessageOptions = {
    scope?: string;
    details?: unknown;
};

const levelConfig: Record<ConsoleMessageType, { color: string; label: string; method: "log" | "warn" | "error" }> = {
    Warn: { color: "\u001b[33m", label: "WARN", method: "warn" },
    Error: { color: "\u001b[31m", label: "ERROR", method: "error" },
    Info: { color: "\u001b[36m", label: "INFO", method: "log" },
    Success: { color: "\u001b[32m", label: "OK", method: "log" },
    Debug: { color: "\u001b[35m", label: "DEBUG", method: "log" },
};

const colors = {
    dim: "\u001b[2m",
    reset: "\u001b[0m",
};

function shouldUseColor() {
    return !env.runtime.noColor;
}

function paint(value: string, color: string) {
    return shouldUseColor() ? `${color}${value}${colors.reset}` : value;
}

function formatTimestamp() {
    return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function formatDetails(details: unknown) {
    if (!details) return null;
    if (details instanceof Error) return details.stack ?? details.message;
    if (typeof details === "string") return details;

    try {
        return JSON.stringify(details, null, 2);
    } catch {
        return String(details);
    }
}

export default class ConsoleMessage {
    type: ConsoleMessageType;
    message: string;
    options: ConsoleMessageOptions;

    constructor(type: ConsoleMessageType, message: string, options: ConsoleMessageOptions | string = {}) {
        this.type = type;
        this.message = message;
        this.options = typeof options === "string" ? { scope: options } : options;
        this.log();
    }

    static info(message: string, scope?: string, details?: unknown) {
        return new ConsoleMessage("Info", message, { scope, details });
    }

    static success(message: string, scope?: string, details?: unknown) {
        return new ConsoleMessage("Success", message, { scope, details });
    }

    static warn(message: string, scope?: string, details?: unknown) {
        return new ConsoleMessage("Warn", message, { scope, details });
    }

    static error(message: string, scope?: string, details?: unknown) {
        return new ConsoleMessage("Error", message, { scope, details });
    }

    static debug(message: string, scope?: string, details?: unknown) {
        return new ConsoleMessage("Debug", message, { scope, details });
    }

    private log(): void {
        const config = levelConfig[this.type];
        const timestamp = paint(formatTimestamp(), colors.dim);
        const level = paint(config.label.padEnd(5), config.color);
        const scope = this.options.scope ? paint(`[${this.options.scope}]`, colors.dim) : "";
        const line = [timestamp, level, scope, this.message].filter(Boolean).join(" ");
        console[config.method](line);

        const details = formatDetails(this.options.details);
        if (details) {
            console[config.method](paint(details, colors.dim));
        }
    }
}
