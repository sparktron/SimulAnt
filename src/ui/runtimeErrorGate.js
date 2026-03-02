export function shouldReportFatalWindowError(event) {
  if (!event) return false;
  const hostWindow = typeof window === 'undefined' ? null : window;

  // Resource load failures (e.g. missing favicon) dispatch `error` with no JS error object.
  if (!event.error && event.target && event.target !== hostWindow) {
    return false;
  }

  if (event.error instanceof Error) return true;
  if (typeof event.error === 'string' && event.error.trim().length > 0) return true;

  if (typeof event.message === 'string' && event.message.trim().length > 0) {
    return true;
  }

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
