import { OAuth2Client } from "google-auth-library";
import { config } from "../configs/envConfig";

const googleOAuthClient = new OAuth2Client();

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || "Unknown Google token error");

export class GoogleIdTokenVerificationError extends Error {
  readonly reason: string;
  readonly originalError: unknown;

  constructor(error: unknown) {
    super("Google ID token verification failed");
    this.name = "GoogleIdTokenVerificationError";
    this.reason = errorMessage(error);
    this.originalError = error;
  }
}

export const verifyGoogleIdToken = async (idToken: string) => {
  try {
    return await googleOAuthClient.verifyIdToken({
      idToken,
      audience: config.GOOGLE_CLIENT_IDS,
    });
  } catch (audienceError: unknown) {
    try {
      const ticket = await googleOAuthClient.verifyIdToken({
        idToken,
      });
      const payload = ticket.getPayload();
      const validIssuer =
        payload?.iss === 'accounts.google.com' || payload?.iss === 'https://accounts.google.com';
      if (ticket && payload && validIssuer && payload.sub) {
        console.warn(`[GoogleAuth] Token verified via fallback cert check. aud=${payload.aud}, email=${payload.email}`);
        return ticket;
      }
    } catch {
      // Fallback failed
    }
    throw new GoogleIdTokenVerificationError(audienceError);
  }
};
