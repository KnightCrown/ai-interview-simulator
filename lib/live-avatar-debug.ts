export type LiveAvatarLogDetails = Record<string, unknown>;

export interface LiveAvatarLogInput {
  event: string;
  source?: string;
  pathname?: string;
  at?: number;
  details?: LiveAvatarLogDetails;
}

export interface LiveAvatarLogEntry {
  event: string;
  source: string;
  pathname: string;
  at: string;
  details: LiveAvatarLogDetails;
}

const MAX_STRING_LENGTH = 180;
const SENSITIVE_KEY_PATTERN = /(api.?key|authorization|token|secret|password)/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...`
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item, index) => sanitizeValue(`${key}.${index}`, item));
  }

  if (typeof value === "object" && value) {
    return sanitizeDetails(value as Record<string, unknown>);
  }

  return String(value);
}

export function sanitizeDetails(details: Record<string, unknown> = {}): LiveAvatarLogDetails {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, sanitizeValue(key, value)])
  );
}

export function normalizeLiveAvatarLog(input: LiveAvatarLogInput): LiveAvatarLogEntry {
  const event = typeof input.event === "string" && input.event.trim()
    ? input.event.trim()
    : "unknown";

  return {
    event,
    source: typeof input.source === "string" && input.source.trim() ? input.source.trim() : "client",
    pathname: typeof input.pathname === "string" && input.pathname.trim() ? input.pathname.trim() : "",
    at: new Date(typeof input.at === "number" ? input.at : Date.now()).toISOString(),
    details: sanitizeDetails(input.details)
  };
}

export function formatLiveAvatarLogLine(entry: LiveAvatarLogEntry): string {
  const details = Object.keys(entry.details).length > 0
    ? ` ${JSON.stringify(entry.details)}`
    : "";
  const location = entry.pathname ? ` ${entry.pathname}` : "";

  return `[live-avatar] ${entry.at} ${entry.source}:${entry.event}${location}${details}`;
}
