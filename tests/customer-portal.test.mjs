import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeCustomerId,
  encodeCustomerId,
  maskPhone,
  normalizeName,
  normalizePhone,
  validPhone
} from "../src/customer-portal.js";

test("姓名與台灣手機正規化", () => {
  assert.equal(normalizeName(" 王　小 明 "), "王小明");
  assert.equal(normalizePhone("+886 912-345-678"), "0912345678");
  assert.equal(normalizePhone("0912 345 678"), "0912345678");
  assert.equal(validPhone("0912-345-678"), true);
  assert.equal(validPhone("02-1234-5678"), false);
});

test("電話遮罩不洩漏完整號碼", () => {
  assert.equal(maskPhone("0912345678"), "0912***678");
});

test("客戶識別碼可安全放入 session token", () => {
  const customerId = "customer_客戶-A_001";
  assert.equal(decodeCustomerId(encodeCustomerId(customerId)), customerId);
});
