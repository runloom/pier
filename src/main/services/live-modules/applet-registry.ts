export interface RegisteredCanvasApplet {
  appletId: string;
  deprecated?: boolean;
  entryAbsolutePath: string;
  fenceRoot: string;
  pluginId: string;
  title?: string;
}

let registered: readonly RegisteredCanvasApplet[] = [];

export function setRegisteredCanvasApplets(
  next: readonly RegisteredCanvasApplet[]
): void {
  registered = next;
}

export function listRegisteredCanvasApplets(): readonly RegisteredCanvasApplet[] {
  return registered;
}

export function findRegisteredCanvasApplet(
  pluginId: string,
  appletId: string
): RegisteredCanvasApplet | undefined {
  return registered.find(
    (item) => item.pluginId === pluginId && item.appletId === appletId
  );
}
