export function shouldReportFatalWindowError(event) {
  if (!event) return false;
  // Only treat as fatal when the browser provides an actual runtime error object/value.
  // Message-only `error` events are frequently resource load failures, not JS crashes.
  if (event.error instanceof Error) return true;
  if (typeof event.error === 'string' && event.error.trim().length > 0) return true;
  if (event.error && typeof event.error === 'object') return true;
  return false;
}

export function normalizeUnhandledRejectionReason(reason) {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string' && reason.trim().length > 0) return reason;
  if (reason == null) return 'Unhandled promise rejection';

  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}
