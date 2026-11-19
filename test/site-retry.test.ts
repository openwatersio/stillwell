import assert from "node:assert/strict";
import { test } from "node:test";
import { retryRewrite } from "../site/src/lib/retry.ts";

const counted = (fail: number, message: string) => {
  let calls = 0;
  const read = async () => {
    if (++calls <= fail) throw new Error(message);
    return "rows";
  };
  return { read, calls: () => calls };
};

test("retryRewrite reads again after a rewrite mid-read", async () => {
  // As DuckDB 2.0's httpfs reports a file replaced mid-read, whether the new one is the same size or shorter.
  const r = counted(
    2,
    'HTTP Error: ETag on reading file "https://stillwell.openwaters.io/stations/years/rws.parquet" changed after it was opened: the server rejected "b2acd854ff668f4f482045d7990ca96e"',
  );
  assert.equal(await retryRewrite(r.read, 4, 0), "rows");
  assert.equal(r.calls(), 3);
});

test("retryRewrite gives up after its tries", async () => {
  const r = counted(9, 'ETag on reading file "x" changed after it was opened');
  await assert.rejects(retryRewrite(r.read, 4, 0), /ETag/);
  assert.equal(r.calls(), 4);
});

test("retryRewrite throws other errors at once", async () => {
  for (const message of [
    "HTTP Error: HTTP HEAD error on 'https://stillwell.openwaters.io/obs/uhslc/416/1990.parquet' (HTTP 404 Not Found)",
    'Binder Error: Referenced column "ETag" not found in FROM clause!',
    "Conversion Error: Could not convert string '416' to INT32",
  ]) {
    const r = counted(9, message);
    await assert.rejects(retryRewrite(r.read, 4, 0));
    assert.equal(r.calls(), 1);
  }
});
