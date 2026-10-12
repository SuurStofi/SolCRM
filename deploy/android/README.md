# Android app (Seeker and any Android phone)

The APK is a thin native shell around the real app. It holds no business logic
and no secrets: it points a WebView at `https://solcrm.tech` and lets Mobile
Wallet Adapter handle signing.

| | |
|---|---|
| Package | `tech.solcrm.app` |
| Server | `https://solcrm.tech` (override with `CAPACITOR_SERVER_URL`) |
| Signing | `android/release.keystore`, alias `solcrm`, RSA 4096, valid to 2054 |
| Output | `android/app/build/outputs/apk/release/app-release.apk` (~3.4 MB) |
| minSdk / targetSdk | 23 / 35 |

## Why a wrapper and not a bundled app

36 modules in `src/lib` are `server-only` and 16 API routes need the database
and `APP_ENCRYPTION_KEY`. A self-contained APK would have to carry the key that
decrypts every stored Binance credential, onto a device that can be lost. So
the phone talks to the same server the browser does.

The practical consequence is good: **deploying the server updates the app.** A
UI change, a new panel, a fixed bug — none of it needs a new APK. You only
rebuild when the native shell itself changes (icon, package id, server URL,
Capacitor version).

## Seed Vault signing

`src/lib/solana/mwa.ts` registers Mobile Wallet Adapter into the Wallet
Standard registry on Android. That is the same mechanism Phantom uses to
announce itself, which is why `SolanaProviders` still passes `wallets={[]}` and
the desktop path is untouched.

Signing works without any manifest changes, and it is worth knowing why, since
the obvious guess is wrong. MWA navigates to a `solana-wallet:` URL via
`window.location.assign` (confirmed in
`@solana-mobile/mobile-wallet-adapter-protocol`). Capacitor's
`Bridge.launchIntent` sees a scheme that is not the app's own and dispatches it
with `Intent.ACTION_VIEW`, which Android routes to the wallet. Because it is
WebView navigation rather than a package query, **Android 11 package visibility
does not apply and no `<queries>` block is needed** — adding one would be dead
config.

One caveat: Capacitor swallows `ActivityNotFoundException` (`// TODO - trigger
an event` in its source). With no wallet installed, the tap does nothing and
the user gets no feedback. On a Seeker that cannot happen — Seed Vault is part
of the OS.

MWA is Android-only. Chrome on Android works; Firefox, Opera and Brave are
documented as not working; iOS cannot support it at all.

## Build requirements

Both are downloaded into the repo and gitignored rather than installed
system-wide, so nothing on the machine changes.

- **JDK 21** at `build-tools-local/jdk-21.0.12.1+1`.
  **Not optional and not JDK 17**: `@capacitor/android`'s own
  `build.gradle` sets `sourceCompatibility JavaVersion.VERSION_21`, so JDK 17
  fails with `error: invalid source release: 21`. This is true of Capacitor 7.6
  as well as 8 — downgrading Capacitor does not avoid it.
- **Android SDK** at `android-sdk/` — platform 35, build-tools 35.0.0,
  platform-tools.

Recreate both:

```bash
# SDK command-line tools (verify the checksum against developer.android.com)
mkdir -p android-sdk && cd android-sdk
curl -sSLO https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip
sha256sum commandlinetools-win-15859902_latest.zip   # 90ae805d...fb04a
unzip -q commandlinetools-win-15859902_latest.zip
mkdir -p cmdline-tools/latest && mv cmdline-tools/bin cmdline-tools/lib \
  cmdline-tools/NOTICE.txt cmdline-tools/source.properties cmdline-tools/latest/

export JAVA_HOME="/c/Program Files/Java/jdk-17"   # fine for sdkmanager itself
yes | ./cmdline-tools/latest/bin/sdkmanager.bat --sdk_root="$PWD" --licenses
# One package per invocation: installing all three at once raced on Windows and
# left a half-unpacked build-tools directory.
for p in "platform-tools" "platforms;android-35" "build-tools;35.0.0"; do
  ./cmdline-tools/latest/bin/sdkmanager.bat --sdk_root="$PWD" "$p"
done

# JDK 21 (Temurin)
cd .. && mkdir -p build-tools-local && cd build-tools-local
curl -sSL -o jdk21.zip https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip
sha256sum jdk21.zip   # f9d6e191...d8b4e
unzip -q jdk21.zip && rm jdk21.zip
```

`android/local.properties` must point at the SDK with **forward slashes**:

```properties
sdk.dir=C:/Users/Vitalii/Desktop/SolCRM/android-sdk
```

Backslashes silently break it: `\U`, `\D` and `\S` are invalid Java properties
escapes, and the failure surfaces far away as
`IOException` from `SdkLocator.validateSdkPath`.

## Building

```bash
npm run android:release
```

Or by hand:

```bash
npx cap sync android
cd android
JAVA_HOME="$PWD/../build-tools-local/jdk-21.0.12.1+1" \
ANDROID_HOME="$PWD/../android-sdk" \
  ./gradlew.bat clean assembleRelease --no-daemon
```

### Memory

`android/gradle.properties` is tuned low (`-Xmx768m`, serial GC, one worker,
lint off for release). This is not arbitrary: the Gradle daemon was
OOM-killed three times on this machine with ~2.5 GB free. The JVM failed in
**native** malloc (`Chunk::new`), not in the heap, so a *smaller* heap leaves
more room for native allocation — the opposite of the usual instinct. Raise
these on a machine with free RAM; lower them if it crashes again.

Lint is off for release builds (`checkReleaseBuilds false`) because it was the
heaviest task and produces no part of the APK. Run it deliberately:

```bash
./gradlew.bat lintRelease
```

## Signing and the keystore

`android/key.properties` holds the credentials and `android/release.keystore`
is the key. **Both are gitignored and neither is recoverable.** The keystore is
the app's identity: Android will only install an update signed by the same key,
so losing it means every user must uninstall before they can install again.
Back up both files somewhere private.

Nothing is hardcoded in Gradle — a checkout without `key.properties` still
builds debug, and `assembleRelease` falls back to unsigned rather than quietly
using a debug key.

Certificate SHA-256:
`FA:3D:E0:B5:41:DB:A0:EA:37:9F:23:54:31:7B:65:41:C5:C7:91:DC:35:8F:1C:BD:AC:FB:CD:30:67:FC:1C:0A`

Verify any APK before publishing it:

```bash
android-sdk/build-tools/35.0.0/apksigner.bat verify --verbose --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

Expect `Verifies`, with v1 and v2 both `true`.

## Releasing on GitHub

```bash
git tag -a android-v1.0.0 -m "Android v1.0.0"
git push origin android-v1.0.0
gh release create android-v1.0.0 \
  android/app/build/outputs/apk/release/app-release.apk#SolCRM-1.0.0.apk \
  --title "SolCRM Android 1.0.0" \
  --notes "Install on any Android 6+ phone. On a Solana Seeker, Seed Vault signs transactions natively."
```

Users must allow "install from unknown sources" — expected for any APK outside
Google Play.

Bump `versionCode` (an integer, must increase) and `versionName` in
`android/app/build.gradle` for each release, or Android will refuse the upgrade.

## Solana dApp Store

The dApp Store accepts a web app wrapped in an Android app, which is what this
is, and requires an APK rather than an AAB — so this artifact is the right
shape. Publishing additionally needs compliance with the publisher policy and
Solana Mobile's own submission flow, which is not set up here.

## Not yet verified

Honest list, since none of this has touched real hardware:

- Installing and launching on a physical Seeker.
- Seed Vault signing end to end (registration and the intent path are verified
  by code inspection and the package's types, not by a signed transaction).
- The offline fallback page actually appearing when the server is unreachable.
- Behaviour on Android 6–9 (minSdk is 23; only the toolchain has been checked).
