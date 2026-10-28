/** Load code when a 3D view opens or is anticipated. Concurrent callers share the same request. */
let pending: ReturnType<typeof importRenderer> | undefined;
function importRenderer() {
  return import("./LocalEquipmentRenderer").then((module) => {
    void module.preloadStudioEnvironment().catch(() => {});
    return module;
  });
}
export function loadEquipmentRenderer() {
  return (pending ??= importRenderer().catch((error) => {
    pending = undefined;
    throw error;
  }));
}
