# Capacitor Mobile Wrapper Guide

This project supports wrapping the web application in native Android/iOS shells using Capacitor.

Current scope:
- Web-to-native wrapper workflow for the existing SPA bundle
- No native-only feature parity guarantees

## 1. Prerequisites

General:
- Node.js 20+
- npm 10+

Android:
- Android Studio
- Android SDK + platform tools
- JDK 17 (recommended)

iOS:
- macOS
- Xcode (latest stable)
- CocoaPods

## 2. Project Baseline

- Capacitor config file: `capacitor.config.ts`
- NPM helper scripts are defined in root `package.json`

If Capacitor CLI/core packages are not installed yet, add them:

```bash
npm install @capacitor/core @capacitor/cli
```

Optional platform packages (auto-added when platform is added if missing):

```bash
npm install @capacitor/android @capacitor/ios
```

## 3. Build and Sync Workflow

Always sync after frontend changes intended for mobile shell.

```bash
npm run mobile:sync
```

This runs:
1. `npm run mobile:build`
2. `npx cap sync`

`mobile:build` points to `npm run frontend:build`, so web assets are generated before sync.

## 4. Add Platforms

Android:

```bash
npm run mobile:add:android
```

iOS:

```bash
npm run mobile:add:ios
```

Note:
- Adding iOS must be done on macOS.

## 5. Open Native Projects

Android Studio:

```bash
npm run mobile:open:android
```

iOS in Xcode:

```bash
npx cap open ios
```

## 6. Recommended Daily Dev Flow

For app/web changes:
1. Update web code
2. Run `npm run mobile:sync`
3. Open native project
4. Build and run on emulator/device

For backend/API changes only:
- No Capacitor sync needed unless web assets changed.

## 7. Signing and Release Notes

Android release signing:
- Configure keystore in Android Studio/Gradle
- Build signed APK/AAB via Android Studio

iOS signing:
- Configure signing team and bundle identifiers in Xcode
- Archive and distribute with Xcode Organizer

This repository does not include production signing keys.

## 8. Troubleshooting

### 8.1 `npx cap` command not found or fails

Fix:
- Ensure dependencies installed: `npm install`
- Install Capacitor packages: `npm install @capacitor/core @capacitor/cli`

### 8.2 Native app shows stale UI

Fix:
- Run `npm run mobile:sync` again
- Clean/rebuild in Android Studio/Xcode

### 8.3 Build fails after dependency changes

Fix:
- Delete and reinstall node modules
- Re-run `npm install`
- Re-run `npm run mobile:sync`

### 8.4 Android Gradle issues

Fix:
- Use Android Studio to update Gradle plugin and SDK components
- Confirm Java/JDK compatibility

### 8.5 iOS pod issues

Fix:
- In `ios/App` run `pod install` (if needed)
- Reopen workspace in Xcode

## 9. CI/CD Considerations

For web-only CI:
- `npm run frontend:build` is sufficient

For mobile packaging pipelines:
- Include `npm run mobile:sync` before native build steps
- Build native artifacts in platform-specific runners

## 10. Scope Clarification

Capacitor support in this project is intended for wrapper readiness and distribution convenience. Any device-specific native capabilities (background services, push notification native hooks, biometrics, deep native integrations) require dedicated feature work and testing.
