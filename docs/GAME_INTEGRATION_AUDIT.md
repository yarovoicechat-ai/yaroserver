# YARO Production-Ready Cocos Creator 3.8 Multiplayer Game Integration Audit

**Date:** 2026-11-19  
**Target:** Voice Room Half-Screen Cocos Creator Game Integration  
**Apps Under Audit:** `YaroApp` (React Native CLI), `YaroServer` (Node.js/TypeScript/Express/Socket.IO/MongoDB/Redis)

---

## 1. Executive Summary & Audit Matrix

| Audit Area | Status | Findings / Risk Assessment |
|------------|--------|----------------------------|
| **1. Voice Room Screen Architecture** | PARTIALLY_IMPLEMENTED | `VoiceRoom.js` renders voice chat and seats. Currently renders game in an overlay container with fixed `height: height * 0.58` rather than a responsive 50%/50% vertical split. |
| **2. Room Navigation & Lifecycle** | IMPLEMENTED | Room navigation managed via React Navigation (`VoiceRoom.js`, `RoomListScreen.js`, `LiveListScreen.js`). State preserved when navigating between child modals. |
| **3. Agora Voice Engine Lifecycle** | IMPLEMENTED | Managed in `VoiceRoomContext.js` (`createAgoraRtcEngine`). Must be kept completely decoupled from game WebView lifecycle so games can open, close, resize, or crash without resetting Agora. |
| **4. Socket.IO Connection Management** | IMPLEMENTED | Singleton managed in `YaroApp/src/sockets/index.js` using `socket.io-client`. Uses JWT auth and automatic token refresh on expiry. Needs game-specific event handlers. |
| **5. Authentication & Token Refresh** | IMPLEMENTED | JWT with refresh tokens stored in `AsyncStorage`. Handled in `apiUtil.js` and `AuthProvider.js`. Single-use game launch tickets are MISSING. |
| **6. Beans & Diamonds Wallet Architecture** | PARTIALLY_IMPLEMENTED | Wallet holds `diamonds` (purchased coins) and `coins` (earned withdrawable beans). Client currently tries to modify balance locally (`onUpdateCoinBalance`). Server-authoritative game wallet service is MISSING. |
| **7. Server Game Modules (`YaroServer`)** | MISSING | `YaroServer` has zero game controllers, routes, models, or session validators. All game logic was previously mocked on client. |
| **8. Cocos Game Projects & Multiplayer** | PARTIALLY_IMPLEMENTED | HTML/JS games exist under `E:\Games\Greedy` and `E:\Games\Ludo 1`. Cocos Creator 3.8.x Web Mobile integration bridge and multiplayer socket synchronization are MISSING. |
| **9. Native Manifest & Permissions** | IMPLEMENTED | `AndroidManifest.xml` has `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, and `usesCleartextTraffic="false"` (strictly HTTPS/WSS). `react-native-webview` is installed (`^14.0.1`). |
| **10. Existing Game Integration Attempts** | BROKEN | `LiveRoomGameView.js` used a hardcoded mockup HTML template string, insecure client-side coin addition/subtraction, no typed bridge, and no backend session validation. |

---

## 2. In-Depth Component Classification

### A. Room Screen & Navigation
- **`src/screens/user/VoiceRoom.js`**:
  - *Classification*: `PARTIALLY_IMPLEMENTED`
  - *Audit*: `VoiceRoom.js` contains full audio room functionality (seats, mic control, gifts, chat, participants). Currently mounts `LiveRoomGameView` as an absolute overlay `styles.voiceGameAreaContainer` (`height * 0.58`).
  - *Required Fix*: Convert layout into a responsive flexbox/percentage layout where Voice Room occupies the upper 50% and Game Container occupies the lower 50% when a game is active.

### B. Agora Engine & Audio Coexistence
- **`src/context/VoiceRoomContext.js` & `src/services/agoraService.js`**:
  - *Classification*: `IMPLEMENTED` / `NEEDS_DEVICE_TEST`
  - *Audit*: `VoiceRoomContext.js` initializes `agoraEngineRef` via `createAgoraRtcEngine()`. Audio profile is set to speech/communication.
  - *Requirement*: Opening or closing the game WebView, minimizing, or toggling fullscreen MUST NEVER touch or reinitialize `agoraEngineRef`. Game audio must default to muted and remain independently controllable so Agora VoIP streams are never interrupted.

### C. Socket.IO Connection
- **`src/sockets/index.js` (App) & `src/sockets/index.ts` (Server)**:
  - *Classification*: `IMPLEMENTED`
  - *Audit*: Unified Socket.IO connection is established with JWT auth.
  - *Missing*: Game-specific namespace or event handlers (`game:join`, `game:action`, `game:round_start`, `game:round_result`, `game:balance_update`) must be registered on the existing socket.

### D. Authentication & Security Bridge
- **Single-Use Game Launch Ticket**:
  - *Classification*: `MISSING`
  - *Audit*: `LiveRoomGameView.js` passed no secure credentials or passed tokens in plaintext.
  - *Requirement*: Server must issue short-lived (e.g. 60-second TTL), single-use launch tickets (`POST /api/games/session`) bound to `userId`, `roomId`, and `gameId`. Game client authenticates with this ticket over WSS/HTTPS.

### E. Wallet Economics & Transactions
- **`diamonds` vs `beans`**:
  - *Classification*: `PARTIALLY_IMPLEMENTED`
  - *Audit*: In `YaroServer`, `User.diamonds` represents in-app game/gift currency (10 diamonds = ₹1 approx), while `User.coins` represents earned beans withdrawable via UPI.
  - *Broken Behavior*: Previous `LiveRoomGameView.js` allowed the client to emit `WIN` with an arbitrary amount and directly added diamonds on the client.
  - *Required Fix*: Complete server-authoritative wallet service (`game.wallet.service.ts`). The Cocos client only emits player actions. Server validates round results, deducts entry bets atomically with `$gte` balance check, credits winnings, and records idempotent transactions.

### F. Cocos Creator 3.8.x Web Integration
- **`src/components/game/`**:
  - *Classification*: `MISSING`
  - *Audit*: Existing `LiveRoomGameView.js` had an embedded HTML string mockup.
  - *Requirement*: Build modular, typed TypeScript components:
    - `GameContainer.tsx` (50% half-screen / fullscreen / minimize responsive layout)
    - `GameWebView.tsx` (sandboxed, secure origin, optimized `react-native-webview`)
    - `GameHeader.tsx` (game title, live balance, audio toggle, minimize, fullscreen, exit)
    - `GameControls.tsx` (action controls)
    - `GameLoading.tsx` & `GameError.tsx` (smooth loading state and reconnect/retry handling)
    - `GameBridge.ts` & `GameBridgeTypes.ts` (typed bidirectional protocol)
    - `GameSessionManager.ts` (state machine: CREATING_SESSION -> LOADING -> PLAYING -> MINIMIZED -> EXITING)

### G. Backend Game Module (`YaroServer`)
- **`src/modules/games/`**:
  - *Classification*: `MISSING`
  - *Audit*: No game module existed in `YaroServer`.
  - *Requirement*:
    - `game.model.ts` (game registry, status, minBet, maxBet, assetUrl)
    - `gameSession.model.ts` (active sessions, player list, host, room association)
    - `gameTransaction.model.ts` (audit log of bets, wins, refunds with idempotency)
    - `game.controller.ts` & `game.routes.ts` (REST endpoints)
    - `game.session.service.ts` & `game.wallet.service.ts` (atomic wallet & presence)
    - `game.socket.ts` (Socket.IO events with Redis session state)

---

## 3. Risk Mitigation Plan

1. **Agora VoIP Audio Degradation Risk**:
   - WebView media playback might compete for audio focus on Android.
   - *Mitigation*: Mute WebView audio by default (`mediaPlaybackRequiresUserAction={true}` or injected JS `HTMLAudioElement.muted = true`). Game audio settings strictly respect user toggle without calling Android AudioManager focus change.
2. **Double Spending / Balance Manipulation Risk**:
   - Cocos JavaScript running in WebView can be modified or inspected.
   - *Mitigation*: The backend is the single source of truth. No balance or win amount from WebView is trusted. Every bet or win goes through atomic MongoDB transactions (`User.findOneAndUpdate({ _id, diamonds: { $gte: bet } })`) with Redis idempotency keys.
3. **Screen Layout Jitter Risk**:
   - Resizing or entering fullscreen might trigger component re-mounting and reload the WebView or reset Agora.
   - *Mitigation*: Use responsive percentage styling (`height: '50%'` / `height: '100%'`) and keep the WebView component mounted continuously during half-screen, fullscreen, and minimize transitions.

---
Audit complete. Moving to Phase 2 (React Native Components), Phase 4 (Bridge), Phase 5 (Session Manager), Phase 6 (Backend Module), Phase 7 (Wallet Security), and Phase 8-12 (Testing & Verification).
