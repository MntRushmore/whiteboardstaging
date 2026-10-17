/**
 * What `tldraw` is inside the native app's brain bundle (`scripts/build-ios-brain.mjs` aliases the
 * package to this file). The brain's modules import tldraw for types, which vanish when compiled,
 * and `handwriting.ts` imports `createShapeId` for the web board's `HandWriter`, which the brain
 * never runs. Anything the bundle does reach throws, so a call that needs the web board fails
 * loudly instead of half-working; the build fails if this shim's marker survives tree-shaking.
 */
function unavailable(name: string): never {
  throw new Error(`AGATHON_BRAIN_TLDRAW_SHIM: tldraw.${name} is not available in the native brain`);
}

export function createShapeId(): never {
  return unavailable("createShapeId");
}
