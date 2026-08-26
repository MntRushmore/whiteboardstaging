import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { patchLicenseManagerClass } from "./patchLicenseManager";

describe("patchLicenseManagerClass", () => {
  it("forces getIsDevelopment so production hosts cannot gate the canvas", () => {
    class FakeLicenseManager {
      getIsDevelopment() {
        return false;
      }
    }
    patchLicenseManagerClass(FakeLicenseManager);
    assert.equal(new FakeLicenseManager().getIsDevelopment(), true);
  });
});
