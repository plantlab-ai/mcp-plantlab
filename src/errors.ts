export class AdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly completionUnknown = false,
  ) {
    super(message);
  }
}
export function safeError(error: unknown) {
  const e =
    error instanceof AdapterError
      ? error
      : new AdapterError("UNAVAILABLE", "The tool is unavailable.");
  return {
    code: e.code,
    message: e.message,
    completion_unknown: e.completionUnknown,
  };
}
