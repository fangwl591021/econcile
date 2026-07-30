import assert from "node:assert/strict";
import test from "node:test";
import { convenienceBarcodeValues, code39Svg } from "../src/barcode.js";

test("reproduces the supplied paper bill barcodes", () => {
  const result = convenienceBarcodeValues({
    virtualAccount: "15030950700056",
    amountDue: 3600
  });
  assert.deepEqual(
    [result.barcode1, result.barcode2, result.barcode3, result.checks],
    ["4912316R7", "0015030950700056", "123156000003600", "56"]
  );
  assert.equal(result.valid, true);
});

test("renders start and stop patterns into SVG", () => {
  const svg = code39Svg("4912316R7");
  assert.match(svg, /^<svg/);
  assert.match(svg, /<rect/);
  assert.match(svg, /aria-label="Code 39 4912316R7"/);
});
