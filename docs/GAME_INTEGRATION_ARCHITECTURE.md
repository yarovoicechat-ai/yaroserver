# YARO Production-Ready Cocos Creator 3.8.x Multiplayer Game Integration Architecture

## 1. System Overview

This architecture integrates high-performance HTML5 Web Mobile games built with **Cocos Creator 3.8.x** inside the existing **YARO Voice Chat Room** using `react-native-webview`.

```
+-------------------------------------------------------------------------+
|                        YARO Voice Room Screen                           |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  | Upper 50%: Voice Room UI & Agora Voice Engine (Active & Live)     |  |
|  | - Room Header, Contributors, Seat Grid, Chat Messages, Controls   |  |
|  | - Agora RTC Engine continuous streaming (Microphone & Speaker)    |  |
|  +-------------------------------------------------------------------+  |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  | Lower 50%: Reusable GameContainer Component                       |  |
|  | - GameHeader: Title, Coins Balance, Mute Audio, Minimize, Full    |  |
|  | - GameWebView: Sandboxed Cocos 3.8.x Runtime                      |  |
|  | - Typed Native Bridge: Secure postMessage & JSON schemas          |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

---

## 2. Component Hierarchy (`src/components/game/`)

```
src/components/game/
|-- GameBridgeTypes.ts       # Typed bidirectional protocol definitions (Protocol v1)
|-- GameBridge.ts            # Message dispatcher, request deduplication, rate limiter
|-- GameSessionManager.ts    # State machine (CREATING -> LOADING -> PLAYING -> MINIMIZED)
|-- GameHeader.tsx           # Game title, Coins display, Audio mute, Minimize, Fullscreen
|-- GameControls.tsx         # Clear bets, balance sync, action triggers
|-- GameLoading.tsx          # Smooth loading indicator with status text
|-- GameError.tsx            # Network retry and graceful error handling
|-- GameWebView.tsx          # Production react-native-webview with hardware acceleration
|-- GameContainer.tsx        # Responsive 50% split container with fullscreen support
|-- index.ts                 # Unified exports
```

---

## 3. Strict Official Currency Economy Rules

The integration strictly enforces YARO's official two-currency segregation:

1. **COINS (Spending Currency)**:
   - Coins (`User.diamonds` in the database, 🪙 in the UI) are the **ONLY** currency accepted for spending.
   - All Cocos game entry fees and bets are debited in Coins.
   - All game winnings are credited in Coins.
   - All gifts, VIP/SVIP, store items, and frames use Coins.
2. **BEANS (Conversion & Withdrawal Currency)**:
   - Beans (`User.coins` in the database) are earned through hosting, gifting, and referrals.
   - Beans have **ONLY TWO** permitted operations:
     1. Convert to Coins (`BEANS -> COINS`).
     2. Withdraw to UPI / Bank Account.
   - Beans are **STRICTLY PROHIBITED** from direct purchase of gifts, games, entry fees, or store items.
3. **Database Ledgers & Transactions**:
   - `GameTransaction` audit logs record `BET`, `WIN`, and `REFUND` with idempotency keys.
   - Atomic database modifications (`User.findOneAndUpdate({ _id, diamonds: { $gte: bet } })`) prevent double spending or negative balances.

---

## 4. Agora Voice Engine Isolation & Audio Coexistence

1. **Decoupled Lifecycle**:
   - Agora RTC Engine is initialized and managed exclusively by `VoiceRoomContext.js`.
   - Opening, minimizing, resizing, or closing the game WebView **NEVER** touches or reinitializes the Agora engine.
2. **Audio Focus & Muting**:
   - Game media is muted by default (`HTMLAudioElement.muted = true`).
   - The user can toggle game sound in `GameHeader.tsx` without triggering Android `AudioManager` focus changes that would mute Agora voice chat.
   - Agora microphone and speakerphone continue streaming throughout gameplay.

---

## 5. Bidirectional Typed Native Bridge Protocol (v1)

### Message Schema
```json
{
  "version": 1,
  "type": "EVENT_NAME",
  "requestId": "req_1732049182_a8f9d1",
  "sessionId": "sess_891e4a-4b92",
  "payload": {},
  "timestamp": 1732049182000
}
```

### Supported Events
- **React Native to Cocos**:
  - `INIT_GAME`: Sends game session ID, single-use launch ticket, user Coins balance, dimensions.
  - `JOIN_GAME`: Joins multiplayer round.
  - `EXIT_GAME`: Notifies game to stop animation loops and teardown.
  - `PAUSE_GAME`: Pauses timers when minimized or app goes to background.
  - `RESUME_GAME`: Resumes gameplay when restored.
  - `UPDATE_PLAYER`: Updates live Coins balance.
  - `UPDATE_SETTINGS`: Clears bets or updates sound preferences.
- **Cocos to React Native**:
  - `GAME_READY`: Game engine initialized and ready for user input.
  - `GAME_STARTED`: Game round initiated.
  - `GAME_FINISHED`: Round result calculated by server.
  - `GAME_MINIMIZED`: User requested minimize from within game.
  - `GAME_EXIT`: User requested exit from within game.
  - `GAME_ERROR`: Runtime or network error reported.
  - `PLAYER_ACTION`: Bet placement, chip selection, spin request.
  - `WALLET_REFRESH_REQUEST`: Requests backend Coins balance sync.

---

## 6. Backend Game Module (`YaroServer`)

Located in `YaroServer/src/modules/games/`:
- `game.models/game.model.ts`: Game catalog registry and limits.
- `game.models/gameSession.model.ts`: Active multiplayer sessions, presence, and round states.
- `game.models/gameTransaction.model.ts`: Financial ledger with strict idempotency.
- `game.validator.ts`: Schema, message size, and origin validation.
- `game.wallet.service.ts`: Atomic Coins debit, credit, and refund.
- `game.session.service.ts`: Cryptographically secure single-use launch tickets (60s TTL).
- `game.service.ts`: Server-authoritative outcomes and payouts.
- `game.socket.ts`: Real-time Socket.IO multiplayer synchronization.
- `game.controller.ts`: REST API endpoints.
- `game.routes.ts`: Express routes under `/api/games`.

---

## 7. Responsive Viewport Adaptation

Cocos Creator Web Mobile canvas automatically adapts to:
1. **Half-Screen (50%)**: `height: '50%'` alongside the upper 50% Voice Room.
2. **Fullscreen (100%)**: `StyleSheet.absoluteFillObject` when expanded.
3. **Minimized**: Collapsed into floating pill with restore toggle.
4. **Android Back Button**: Fullscreen -> Half-screen -> Minimize -> Exit.
