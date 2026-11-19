export const ALLOWED_GAME_ORIGINS = [
  'https://games.yaroapp.in',
  'https://api.yaroapp.in',
  'https://yaroapp.in',
];

export const MAX_BRIDGE_MESSAGE_BYTES = 16384; // 16 KB max

export interface IBridgeEventMessage<T = any> {
  version: number;
  type: string;
  requestId: string;
  sessionId: string;
  payload: T;
  timestamp?: number;
}

export const VALID_RN_TO_COCOS_EVENTS = new Set([
  'INIT_GAME',
  'JOIN_GAME',
  'EXIT_GAME',
  'PAUSE_GAME',
  'RESUME_GAME',
  'UPDATE_PLAYER',
  'UPDATE_SETTINGS',
]);

export const VALID_COCOS_TO_RN_EVENTS = new Set([
  'GAME_READY',
  'GAME_STARTED',
  'GAME_FINISHED',
  'GAME_MINIMIZED',
  'GAME_EXIT',
  'GAME_ERROR',
  'PLAYER_ACTION',
  'WALLET_REFRESH_REQUEST',
]);

export class GameValidator {
  public static validateOrigin(originUrl: string): boolean {
    if (!originUrl) return false;
    try {
      const url = new URL(originUrl);
      const host = `${url.protocol}//${url.host}`.toLowerCase();
      return ALLOWED_GAME_ORIGINS.some(allowed => host === allowed.toLowerCase() || host.endsWith('.yaroapp.in'));
    } catch {
      return false;
    }
  }

  public static validateBridgeMessage(raw: unknown): { valid: boolean; error?: string; message?: IBridgeEventMessage } {
    if (!raw) {
      return { valid: false, error: 'Empty message payload' };
    }

    let parsed: any;
    if (typeof raw === 'string') {
      if (raw.length > MAX_BRIDGE_MESSAGE_BYTES) {
        return { valid: false, error: `Message exceeds maximum allowed size (${MAX_BRIDGE_MESSAGE_BYTES} bytes)` };
      }
      try {
        parsed = JSON.parse(raw);
      } catch (err: any) {
        return { valid: false, error: `Malformed JSON: ${err.message}` };
      }
    } else if (typeof raw === 'object') {
      parsed = raw;
    } else {
      return { valid: false, error: 'Invalid message type format' };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, error: 'Message must be an object' };
    }

    if (parsed.version !== 1) {
      return { valid: false, error: 'Unsupported protocol version (expected 1)' };
    }

    if (typeof parsed.type !== 'string' || !parsed.type.trim()) {
      return { valid: false, error: 'Missing or invalid event type' };
    }

    if (!VALID_COCOS_TO_RN_EVENTS.has(parsed.type) && !VALID_RN_TO_COCOS_EVENTS.has(parsed.type)) {
      return { valid: false, error: `Unrecognized event type: ${parsed.type}` };
    }

    if (typeof parsed.requestId !== 'string' || !parsed.requestId.trim()) {
      return { valid: false, error: 'Missing requestId' };
    }

    if (typeof parsed.sessionId !== 'string' || !parsed.sessionId.trim()) {
      return { valid: false, error: 'Missing sessionId' };
    }

    if (parsed.payload === undefined || parsed.payload === null || typeof parsed.payload !== 'object') {
      return { valid: false, error: 'Payload must be an object' };
    }

    return {
      valid: true,
      message: {
        version: 1,
        type: parsed.type,
        requestId: parsed.requestId,
        sessionId: parsed.sessionId,
        payload: parsed.payload,
        timestamp: parsed.timestamp || Date.now(),
      },
    };
  }

  public static validateBetPlacement(params: {
    amount: number;
    betTarget: string;
    minBet?: number;
    maxBet?: number;
  }): { valid: boolean; error?: string } {
    const { amount, betTarget, minBet = 50, maxBet = 50000 } = params;

    if (!amount || typeof amount !== 'number' || isNaN(amount) || !Number.isInteger(amount)) {
      return { valid: false, error: 'Bet amount must be a positive whole integer' };
    }

    if (amount < minBet) {
      return { valid: false, error: `Minimum bet is ${minBet} diamonds` };
    }

    if (amount > maxBet) {
      return { valid: false, error: `Maximum bet is ${maxBet} diamonds` };
    }

    if (!betTarget || typeof betTarget !== 'string' || betTarget.trim().length === 0 || betTarget.length > 50) {
      return { valid: false, error: 'Invalid bet target' };
    }

    return { valid: true };
  }
}
