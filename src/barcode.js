const patterns = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw",
  "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn",
  "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn",
  "9": "nnwwnnwnn", A: "wnnnnwnnw", B: "nnwnnwnnw",
  C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn",
  I: "nnwnnwwnn", J: "nnnnwwwnn", K: "wnnnnnnww",
  L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww",
  O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww",
  R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn",
  X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn",
  "$": "nwnwnwnnn", "/": "nwnwnnnwn", "+": "nwnnnwnwn",
  "%": "nnnwnwnwn", "*": "nwnnwnwnn"
};

const letterValues = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 2, 3, 4,
  5, 6, 7, 8, 9, 2, 3, 4, 5, 6, 7, 8, 9
];
const values = Object.fromEntries([
  ...Array.from({ length: 10 }, (_, index) => [String(index), index]),
  ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").map((letter, index) => [
    letter,
    letterValues[index]
  ])
]);

function checkCharacter(remainder, odd) {
  if (odd && remainder === 0) return "A";
  if (odd && remainder === 10) return "B";
  if (!odd && remainder === 0) return "X";
  if (!odd && remainder === 10) return "Y";
  return String(remainder);
}

export function convenienceBarcodeValues({
  virtualAccount,
  amountDue,
  barcodeExpiry = "491231",
  collectionCode = "6R7"
}) {
  const barcode1 = `${barcodeExpiry}${collectionCode}`.toUpperCase();
  const account = String(virtualAccount || "").replace(/\D/g, "");
  const barcode2 =
    account.length === 16 ? account : account.length === 14 ? `00${account}` : "";
  const amount = Math.max(0, Math.round(Number(amountDue) || 0));
  const amountPart = String(amount).padStart(9, "0").slice(-9);
  const monthDay = barcodeExpiry.slice(2, 6);
  const thirdWithoutCheck = `${monthDay}${amountPart}`;
  let oddTotal = 0;
  let evenTotal = 0;

  for (const segment of [barcode1, barcode2, thirdWithoutCheck]) {
    Array.from(segment).forEach((character, index) => {
      const value = values[character] ?? 0;
      if ((index + 1) % 2) oddTotal += value;
      else evenTotal += value;
    });
  }

  const checks =
    checkCharacter(oddTotal % 11, true) +
    checkCharacter(evenTotal % 11, false);
  return {
    barcode1,
    barcode2,
    barcode3: `${monthDay}${checks}${amountPart}`,
    checks,
    valid: barcode1.length === 9 && barcode2.length === 16 && amount <= 99999999
  };
}

export function code39Svg(value, height = 66) {
  const encoded = `*${String(value).toUpperCase()}*`;
  const narrow = 2;
  const wide = 5;
  const gap = 2;
  const quiet = 18;
  let cursor = quiet;
  const bars = [];

  for (const character of encoded) {
    const pattern = patterns[character];
    if (!pattern) continue;
    Array.from(pattern).forEach((unit, index) => {
      const width = unit === "w" ? wide : narrow;
      if (index % 2 === 0) {
        bars.push(`<rect x="${cursor}" y="0" width="${width}" height="${height}"/>`);
      }
      cursor += width;
    });
    cursor += gap;
  }

  const width = cursor + quiet - gap;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Code 39 ${value}" preserveAspectRatio="none"><rect width="${width}" height="${height}" fill="#fff"/>${bars.join("")}</svg>`;
}
