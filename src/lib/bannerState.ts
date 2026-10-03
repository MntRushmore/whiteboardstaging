/**
 * Explicit view states for the passive banners (SetupRequiredBanner). It hides when its status
 * request fails - that is by design (it is advisory, and the request also fails when signed
 * out) - but the hidden-on-error case is named so it is visible in the DOM as
 * `data-state="hidden-error"` and testable here. (Low and empty ink are the ink meter's job.)
 */

export type BannerState = "loading" | "hidden" | "hidden-error" | "visible";

export type SetupStatusLike = { providers: ReadonlyArray<{ present: boolean }> } | null;

export function setupBannerStateFor(status: SetupStatusLike, failed: boolean): BannerState {
  if (failed) return "hidden-error";
  if (!status) return "loading";
  return status.providers.some((p) => !p.present) ? "visible" : "hidden";
}
