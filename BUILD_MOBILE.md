# Building the native iOS / Android app (EAS)

The app in `mobile/` is already a native Expo app — the web build is just one
export target. This is the pipeline to get the *same code* onto TestFlight and
the App Store. Nothing here is a rewrite.

The config is done (committed): `app.json` has the bundle identifier and
`eas.json` has the build profiles. The steps below are the ones that need a
human — they involve interactive logins (Expo, Apple with 2FA) that can't be
scripted.

## One decision to lock before your first submit

`app.json` sets both `ios.bundleIdentifier` and `android.package` to
**`live.dscovr.app`** (reverse of the domain you own). This is effectively
permanent once the app is on the App Store — changing it later means a brand
new app listing. If you want something else (e.g. `com.dscovr.app`), change it
now, before the first `eas submit`.

## 0. Prerequisites (once)

- Apple Developer account — you have this.
- A free Expo account — sign up at expo.dev if you don't have one. EAS builds
  in Expo's cloud, so **you do not need a Mac.**

## 1. Log in and link the project

From `mobile/`:

    npx eas-cli@latest login          # your Expo account
    npx eas-cli@latest init           # creates the EAS project, writes
                                      # extra.eas.projectId into app.json

Commit the `projectId` change `init` makes — it belongs in the repo.

## 2. First build onto your own phone (fastest feedback)

    npx eas-cli@latest build --profile preview --platform ios

EAS will offer to create the iOS credentials for you — say yes; it manages the
signing certificate and provisioning profile in the cloud. The `preview`
profile uses internal distribution, so it installs via a link/QR without going
through review. For iOS internal distribution you register device UDIDs when
prompted (yours, your buddy's).

When it finishes (~10-20 min in the free queue) you get a QR code / install
link. Open it on the phone.

## 3. TestFlight (multiple testers, no UDID juggling)

    npx eas-cli@latest build --profile production --platform ios
    npx eas-cli@latest submit --profile production --platform ios

`submit` uploads the build to App Store Connect. From there, add testers in
TestFlight. This is the better path once you have more than one or two testers.

## 4. Android rides along

Same commands, `--platform android`. Google Play is a $25 one-time fee and a
lighter review than Apple's. `--platform all` builds both at once.

## What changes in the code for native (later, not now)

Most features already work on native with no changes — the invite share sheet
(`Share.share`) and the `sms:` "Text friends" link are native-first already;
the web versions are the fallbacks.

The one genuinely new capability is **contacts import**:

- Add the package: `npx expo install expo-contacts`
- Add it as a config plugin in `app.json` with a permission string
  (`NSContactsUsageDescription`) explaining why — Apple review scrutinizes
  this, so the reason must be honest and specific ("find friends already on
  DSCOVR").
- Read the device numbers with permission, then hand the array to the
  **existing** `get_contacts_on_dscovr` RPC (migration 0018). The matching and
  its enumeration guards are already built and tested — only the client-side
  "read the address book" part is new.

Push notifications (`expo-notifications`) are the other native-only lever, on
the same shape: an npm package plus a bit of registration code, no new backend
shape.

## Gotchas worth knowing before submit

- **App icon:** `ios.icon` currently points at `assets/expo.icon`, which is the
  default Expo template icon. Apple will reject or you'll ship an unbranded
  icon — swap in a DSCOVR icon before the production build.
- **Privacy policy:** the App Store requires a hosted privacy policy URL,
  especially with contacts access. dscovr.live needs a `/privacy` page.
- **Deep links:** the `dscovr://` scheme is set. For `https://dscovr.live/e/...`
  links to open the app instead of Safari, you'll add Universal Links
  (an `apple-app-site-association` file on the domain) — a later polish, not a
  launch blocker.
