/** Classify a failed Grant Center read so the panel can show permission vs error. */
export function grantCallFailure(error: unknown): { permission: boolean; message: string } {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : NaN;
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "This panel could not be loaded.";
  const permission = status === 401
    || status === 403
    || /founder mode required|authentication required|access denied|not authorized|permission/i.test(message);
  return { permission, message };
}

export function grantCallFailureText(error: unknown, fallback: string): string {
  const failure = grantCallFailure(error);
  if (failure.permission) return `Permission required. ${failure.message}`;
  return failure.message || fallback;
}
