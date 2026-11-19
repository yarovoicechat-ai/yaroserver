# YARO Cocos Creator 3.8.x Game Integration Deployment Guide

## 1. Prerequisites

- **Node.js**: v18.x or v20.x
- **MongoDB**: Replica set recommended for multi-document ACID transactions.
- **Redis**: v6.x or v7.x for Pub/Sub and single-use launch ticket caching.
- **React Native CLI**: 0.73+ with `react-native-webview` ^14.0.1.
- **Android SDK**: Compile SDK 36, Target SDK 36, Min SDK 24.

---

## 2. Server Deployment (`YaroServer`)

### Build & Run
```bash
cd YaroServer
npm install
npm run build
npm start
```

### Environment Variables
Ensure the following variables are set in `.env`:
```ini
PORT=5000
MONGODB_URI=mongodb://localhost:27017/yaro_database
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=yaroapp:
JWT_SECRET=your_jwt_secret_key
CORS_ORIGIN=https://yaroapp.in
ALLOWED_GAME_ORIGINS=https://games.yaroapp.in,https://api.yaroapp.in
```

### Static Asset Hosting
Cocos Creator HTML5 Web Mobile builds are served from:
- Primary CDN/Web: `https://games.yaroapp.in/<gameId>/`
- Server Static Fallback: `https://api.yaroapp.in/games/<gameId>/index.html` (mapped to `YaroServer/public/games/<gameId>/`)

---

## 3. Cocos Creator 3.8.x Web Mobile Build Configuration

When exporting games from Cocos Creator 3.8.x:
1. **Platform**: `Web Mobile`
2. **Orientation**: `Portrait`
3. **Web Desktop**: `Disabled`
4. **Render Pipeline**: `Forward` or `Builtin`
5. **VConsole**: Disabled in production
6. **MD5 Cache**: Enabled
7. **Embed Scripts**: Enabled for lightweight packaging

Deploy the build output folder into the web root under `/food-game/`, `/greedy-baby/`, etc.

---

## 4. Android Native Build (`YaroApp`)

### AndroidManifest.xml
Verified permissions:
- `android.permission.INTERNET`
- `android.permission.RECORD_AUDIO`
- `android.permission.MODIFY_AUDIO_SETTINGS`
- `android:usesCleartextTraffic="false"` (strictly enforces HTTPS/WSS)

### Assemble Release APK
```powershell
cd YaroApp/android
./gradlew assembleRelease --no-daemon
```
Outputs:
`YaroApp/android/app/build/outputs/apk/release/app-release.apk`

### Install on Device via ADB
```powershell
adb -s "<device_id>" install -r app-release.apk
adb -s "<device_id>" shell am start -n yaro.vc.app/.MainActivity
```
