export const CUSTOMER_SESSION_COOKIE = "reconcile_customer";
export const CUSTOMER_SESSION_SECONDS = 2 * 60 * 60;

export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toLocaleLowerCase("zh-Hant");
}

export function normalizePhone(value) {
  let phone = String(value ?? "").normalize("NFKC").replace(/\D/g, "");
  if (phone.startsWith("886")) phone = `0${phone.slice(3)}`;
  return phone;
}

export function validPhone(value) {
  return /^09\d{8}$/.test(normalizePhone(value));
}

export function maskPhone(value) {
  const phone = normalizePhone(value);
  if (phone.length < 7) return "";
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function encodeCustomerId(value) {
  return bytesToBase64Url(new TextEncoder().encode(String(value)));
}

export function decodeCustomerId(value) {
  try {
    return new TextDecoder().decode(base64UrlToBytes(value));
  } catch {
    return "";
  }
}
