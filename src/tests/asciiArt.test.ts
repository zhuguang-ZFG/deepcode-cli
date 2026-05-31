import { test } from "node:test";
import assert from "node:assert/strict";
import { BrandInfo } from "../AsciiArt";

test("BrandInfo keeps the startup banner Chinese-first", () => {
  assert.match(BrandInfo, /特点/);
  assert.match(BrandInfo, /解决的问题/);
  assert.doesNotMatch(BrandInfo, /Features|Problems Solved|Smart routing|Auto failover/i);
});
