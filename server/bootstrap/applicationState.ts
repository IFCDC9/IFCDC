let applicationReady = false;

export function setApplicationReady(ready: boolean): void {
  applicationReady = ready;
}

export function isApplicationReady(): boolean {
  return applicationReady;
}
