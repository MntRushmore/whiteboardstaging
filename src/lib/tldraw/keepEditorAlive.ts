import * as TldrawEditor from "@tldraw/editor";
import { patchLicenseManagerClass } from "./patchLicenseManager";

/**
 * tldraw's LicenseProvider unmounts the whole editor after a few seconds when
 * the state is `unlicensed-production` or `expired`.
 *
 * Preview hosts and a mismatched production hostname must not blank the
 * teacher board. The hobby key is domain-locked; we still keep the editor.
 *
 * Treat the runtime as development so a missing/mismatched host cannot hide
 * the canvas. Watermarks may still appear. Do not add a license key here.
 *
 * LicenseManager is a runtime export; the published types mark it internal.
 */
type LicenseManagerCtor = {
  prototype: { getIsDevelopment?: () => boolean };
};

const LicenseManager = (TldrawEditor as { LicenseManager?: LicenseManagerCtor })
  .LicenseManager;

export function keepTldrawEditorAlive(): void {
  if (!LicenseManager) return;
  patchLicenseManagerClass(LicenseManager);
}

keepTldrawEditorAlive();
