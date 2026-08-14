import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidenceUrl = new URL("../evidence/official-bootstrap/okinawa-2019-grant-decisions-h2.pdf", import.meta.url);

test("pins the exact Okinawa FY2019 H2 bootstrap original", async () => {
  const buffer = await readFile(evidenceUrl);
  assert.equal(buffer.length, 50_170);
  assert.equal(
    createHash("sha256").update(buffer).digest("hex"),
    "cc0dee7fffdc496913a88ef241f3b572f87560e7f98b32077cd3ac7f329621b3",
  );
  assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
});
