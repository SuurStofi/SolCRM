/**
 * Build the signed release APK.
 *
 * Wraps `cap sync` + `gradlew assembleRelease` so the two local toolchains are
 * found without the caller having to export anything, and so a missing one
 * fails with an explanation rather than a Gradle stack trace.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sdk = path.join(root, 'android-sdk');
const jdkParent = path.join(root, 'build-tools-local');

function die(message) {
  console.error(`\n${message}\n\nSee deploy/android/README.md.\n`);
  process.exit(1);
}

if (!existsSync(sdk)) die(`No Android SDK at ${sdk}.`);

// JDK 21 specifically: @capacitor/android compiles at source level 21, so a
// JDK 17 build fails with "invalid source release: 21".
const jdk = existsSync(jdkParent)
  ? readdirSync(jdkParent).find((d) => d.startsWith('jdk-21'))
  : undefined;
if (!jdk) die(`No JDK 21 under ${jdkParent}. Capacitor requires 21; 17 will not build.`);

const env = {
  ...process.env,
  JAVA_HOME: path.join(jdkParent, jdk),
  ANDROID_HOME: sdk,
};

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell: true });

console.log(`\nJDK:  ${env.JAVA_HOME}`);
console.log(`SDK:  ${env.ANDROID_HOME}`);
console.log(`Host: ${process.env.CAPACITOR_SERVER_URL ?? 'https://solcrm.tech'}\n`);

run('npx', ['cap', 'sync', 'android']);
run(path.join(root, 'android', 'gradlew.bat'), [
  '-p', path.join(root, 'android'),
  'clean', 'assembleRelease', '--no-daemon',
]);

const apk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apk)) die('Gradle reported success but no APK was produced.');

// Never hand over an APK without checking it is actually signed: an unsigned
// or debug-signed artifact installs nowhere useful and cannot be updated.
const apksigner = path.join(sdk, 'build-tools/35.0.0/apksigner.bat');
const verdict = execFileSync(apksigner, ['verify', '--verbose', apk], { env, shell: true })
  .toString();
if (!/^Verifies/m.test(verdict)) die(`APK failed signature verification:\n${verdict}`);

const kb = (statSync(apk).size / 1024).toFixed(0);
console.log(`\nSigned APK ready (${kb} KB):\n  ${apk}\n`);
console.log(verdict.split('\n').filter((l) => /Verifies|v1 scheme|v2 scheme/.test(l)).join('\n'));
