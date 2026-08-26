/** Shared by the runtime import and unit tests. No tldraw import here. */
export function patchLicenseManagerClass(ctor: {
  prototype: { getIsDevelopment?: () => boolean };
}): void {
  ctor.prototype.getIsDevelopment = () => true;
}
