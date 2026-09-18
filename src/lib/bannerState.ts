/**
 * Explicit view states for the passive banners (CreditsBanner,
 * SetupRequiredBanner). Both hide when their status request fails - that is
 * by design (they are advisory, and the request also fails when signed out) -
 * but the hidden-on-error case is named so it is visible in the DOM as
 * `data-state="hidden-error"` and testable here.
 */

export type BannerState = "loading" | "hidden" | "hidden-error" | "visible";

export type CreditsLike = { remaining: number } | null;

export function creditsBannerStateFor(
  credits: CreditsLike,
  failed: boolean,
  lowThreshold: number,
): BannerState {
  if (failed) return "hidden-error";
  if (!credits) return "loading";
  return credits.remaining > lowThreshold ? "hidden" : "visible";
}

export type SetupStatusLike = { providers: ReadonlyArray<{ present: boolean }> } | null;

export function setupBannerStateFor(status: SetupStatusLike, failed: boolean): BannerState {
  if (failed) return "hidden-error";
  if (!status) return "loading";
  return status.providers.some((p) => !p.present) ? "visible" : "hidden";
}
