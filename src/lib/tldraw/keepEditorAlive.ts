import { LicenseManager } from "@tldraw/editor";
import { patchLicenseManagerClass } from "./patchLicenseManager";

/**
 * tldraw's LicenseProvider unmounts the whole editor after a few seconds when
 * the state is `unlicensed-production` or `expired`.
 *
 * Vercel preview hosts (*.vercel.app) are production HTTPS and are often
 * missing from a hobby license host list. That blanks the teacher board.
 *
 * Treat the runtime as development so a missing/mismatched host cannot hide
 * the canvas. Watermarks may still appear. Do not add a license key here.
 */
export function keepTldrawEditorAlive(): void {
  patchLicenseManagerClass(LicenseManager);
}

keepTldrawEditorAlive();
