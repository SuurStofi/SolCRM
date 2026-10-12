/**
 * Regenerate the Android launcher icons from the web app's icon.
 *
 * Run after changing src/app/icon.png:  node scripts/android-icons.mjs
 *
 * Capacitor ships its own placeholder icons; this replaces them so the APK
 * carries this app's branding at every density.
 */
import sharp from 'sharp';
import fs from 'node:fs';

// Android launcher densities. ic_launcher is the square icon; the adaptive
// foreground needs more padding because Android masks it to a circle or
// squircle and crops the edges.
const SQUARE = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const src = 'src/app/icon.png';
const meta = await sharp(src).metadata();
console.log(`source ${src}: ${meta.width}x${meta.height} ${meta.format}`);

for (const [density, size] of Object.entries(SQUARE)) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
    await sharp(src).resize(size, size, { fit: 'cover' }).png().toFile(`${dir}/${name}`);
  }
  console.log(`${density}: ${size}x${size} square`);
}

// The adaptive foreground sits inside a safe zone: Android only guarantees the
// middle ~66%, so the logo is scaled to that and padded transparent.
for (const [density, size] of Object.entries(FOREGROUND)) {
  const inner = Math.round(size * 0.66);
  const pad = Math.round((size - inner) / 2);
  const logo = await sharp(src).resize(inner, inner, { fit: 'cover' }).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toFile(`android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`);
  console.log(`${density}: ${size}x${size} foreground (logo ${inner}px, pad ${pad}px)`);
}

for (const f of fs.readdirSync('android/app/src/main/res/mipmap-xxxhdpi')) {
  const b = fs.readFileSync(`android/app/src/main/res/mipmap-xxxhdpi/${f}`);
  console.log(`verify xxxhdpi/${f}: ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`);
}
