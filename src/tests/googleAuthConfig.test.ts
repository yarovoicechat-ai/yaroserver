import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleClientIdAllowlist,
  config,
  YARO_GOOGLE_WEB_CLIENT_ID,
} from "../configs/envConfig";

test("Google client ID allowlist trims, splits, and de-duplicates IDs", () => {
  assert.deepEqual(
    buildGoogleClientIdAllowlist(" old-client ", "new-client, old-client", undefined),
    ["old-client", "new-client"]
  );
});

test("the mobile app Web OAuth client remains explicitly allowed", () => {
  assert.equal(config.GOOGLE_CLIENT_IDS.includes(YARO_GOOGLE_WEB_CLIENT_ID), true);
});
