/**
 * Generate the app icons from the original SolCRM logo.
 *
 * Next picks these up by filename convention (app/favicon.ico, app/icon.png,
 * app/apple-icon.png) and emits the right <link> tags itself, so nothing has to
 * be declared in metadata.
 *
 * Run with: node scripts/make-icons.mjs
 */
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const SOURCE = "public/solcrm-logo.jpg";

/**
 * Build a .ico containing several sizes.
 *
 * sharp cannot write .ico, and the format is simple enough that a dependency
 * for it is not worth it: a 6-byte header, a 16-byte directory entry per image,
 * then the PNG payloads. Windows and every current browser accept PNG-in-ICO.
 */
async function buildIco(sizes) {
  // The payloads must be RGBA. Next's ICO decoder rejects palette PNGs with
  // "The PNG is not in RGBA format!", and sharp palettises by default at high
  // compression levels, so both are forced off here.
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(SOURCE)
        .resize(size, size, { fit: "cover" })
        .ensureAlpha()
        .png({ palette: false, compressionLevel: 9 })
        .toBuffer(),
    ),
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map((png, index) => {
    const size = sizes[index];
    const entry = Buffer.alloc(16);
    // 0 means 256 in the ICO directory; sizes here stay under that anyway.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette colours
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images]);
}

const outputs = [
  // Browser tab / bookmarks. Multi-size so it stays sharp wherever it is drawn.
  ["src/app/favicon.ico", await buildIco([16, 32, 48])],
  // Modern browsers prefer this over the .ico. 192px covers tabs and PWA
  // tiles; keep sizes below the 203px original to avoid upscaling.
  [
    "src/app/icon.png",
    await sharp(SOURCE)
      .resize(192, 192, { fit: "cover" })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer(),
  ],
  // iOS home screen. No alpha: iOS composites it on black, and the logo's
  // light background would otherwise be lost.
  [
    "src/app/apple-icon.png",
    await sharp(SOURCE)
      .resize(180, 180, { fit: "cover" })
      .flatten({ background: "#0c0912" })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer(),
  ],
];

for (const [path, data] of outputs) {
  await writeFile(path, data);
  console.log(`${path.padEnd(28)} ${data.length.toLocaleString()} bytes`);
}
