import * as Sentry from "@sentry/node";
import { safeError } from "./errors.js";

/** Reports an error that needs attention: a log line, and a Sentry event when Sentry is on. */
export type ReportError = (error: unknown, tags: Record<string, string>) => void;

export function createReporter({
  capture = (error: unknown, tags: Record<string, string>) => {
    // A no-op when Sentry isn't initialized (no SENTRY_DSN).
    Sentry.captureException(error, { tags });
  },
  log = (line: object) => console.error(JSON.stringify(line)),
}: {
  capture?: (error: unknown, tags: Record<string, string>) => void;
  log?: (line: object) => void;
} = {}): ReportError {
  return (error, tags) => {
    log({ level: "error", msg: "reported error", ...tags, err: safeError(error) });
    try {
      capture(error, tags);
    } catch {
      // Reporting must never break the caller.
    }
  };
}
