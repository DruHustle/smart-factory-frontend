import { COOKIE_NAME } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { sessionRevoked, revokeSession } from "../accountAccess";
import { demoAccountsEnabled } from "../../shared/demo-accounts";
import { sharedDemoIdentity } from "../../shared/access-policy";

// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  email?: string;
  role?: string;
  sessionId?: string;
  authVersion?: number;
  expiresAt?: number;
  credentialChange?: boolean;
};

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET must be configured in production");
    }
    const secret = ENV.cookieSecret || "default-secret-for-local-dev";
    if (process.env.NODE_ENV === "production" && Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("JWT_SECRET must contain at least 32 bytes in production");
    }
    return new TextEncoder().encode(secret);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Create a session token for a user
   */
  async createSessionToken(
    user: User,
    options: { expiresInMs?: number; sessionId?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId: user.openId,
        appId: ENV.appId || "default-app",
        name: user.name || "User",
        email: user.email || undefined,
        role: user.role,
        authVersion: user.authVersion ?? 0,
        credentialChange: user.passwordChangeRequired === true,
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number; sessionId?: string } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? 8 * 60 * 60 * 1000;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      sid: options.sessionId ?? payload.sessionId ?? randomUUID(),
      sv: payload.authVersion ?? 0,
      pc: payload.credentialChange === true,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("smart-factory-iot")
      .setAudience("smart-factory-iot-api")
      .setSubject(payload.openId)
      .setIssuedAt(Math.floor(issuedAt / 1000))
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    token: string | undefined | null
  ): Promise<SessionPayload | null> {
    if (!token) {
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(token, secretKey, {
        algorithms: ["HS256"],
        issuer: "smart-factory-iot",
        audience: "smart-factory-iot-api",
      });
      const { openId, appId, name, email, role } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        return null;
      }

      return {
        openId,
        appId,
        name,
        email: typeof email === "string" ? email : undefined,
        role: typeof role === "string" ? role : undefined,
        sessionId: typeof payload.sid === "string" ? payload.sid : undefined,
        authVersion: typeof payload.sv === "number" ? payload.sv : undefined,
        expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : undefined,
        credentialChange: payload.pc === true,
      };
    } catch (error) {
      return null;
    }
  }

  requestToken(req: Pick<Request, "headers">): string | undefined {
    // Check Authorization header first
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else {
      // Fallback to cookie
      const cookies = this.parseCookies(req.headers.cookie);
      token = cookies.get(COOKIE_NAME);
    }

    return token;
  }

  async authenticateRequestWithSession(req: Request): Promise<{ user: User; session: SessionPayload }> {
    const session = await this.verifySession(this.requestToken(req));

    if (!session || !session.sessionId || !/^[0-9a-f-]{36}$/.test(session.sessionId) ||
        !Number.isSafeInteger(session.authVersion) || !session.expiresAt) {
      throw ForbiddenError("Invalid or missing authentication");
    }

    const user = await db.getUserByOpenId(session.openId);
    if (!user || user.disabledAt || session.authVersion !== user.authVersion ||
        (user.passwordChangeRequired && (!session.credentialChange || !user.temporaryCredentialExpiresAt || user.temporaryCredentialExpiresAt.getTime() <= Date.now())) ||
        (sharedDemoIdentity(user) && !demoAccountsEnabled()) || await sessionRevoked(session.sessionId)) {
      throw ForbiddenError("Session is no longer active");
    }
    return { user, session };
  }

  async authenticateRequest(req: Request): Promise<User> {
    return (await this.authenticateRequestWithSession(req)).user;
  }

  async revokeRequestSession(req: Request): Promise<string | null> {
    const session = await this.verifySession(this.requestToken(req));
    if (!session?.sessionId || !session.expiresAt) return null;
    await revokeSession(session.sessionId, session.openId, session.expiresAt);
    return session.sessionId;
  }
}

export const sdk = new SDKServer();
