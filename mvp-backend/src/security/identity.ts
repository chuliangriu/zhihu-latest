import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config.js";
import type { AuthenticatedPrincipal, UserRole } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
      clientIpHash?: string;
    }
  }
}

const AUTH_WINDOW_MS = 60_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function requireInternalIdentity(config: AppConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!config.appApiToken || !config.identity.signingSecret) {
      response.status(503).json({ error: { code: "IDENTITY_SERVICE_UNAVAILABLE", message: "身份服务尚未配置" } });
      return;
    }

    const suppliedToken = readBearer(request.header("authorization"));
    if (!constantTimeEqual(suppliedToken, config.appApiToken)) {
      response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "缺少有效访问凭证" } });
      return;
    }

    const userId = request.header("x-unseen-user-id") ?? "";
    const sessionId = request.header("x-unseen-session-id") ?? "";
    const role = request.header("x-unseen-user-role") ?? "user";
    const status = request.header("x-unseen-user-status") ?? "active";
    const timestamp = request.header("x-unseen-auth-timestamp") ?? "";
    const signature = request.header("x-unseen-auth-signature") ?? "";
    const timestampMs = Number(timestamp);

    if (
      !ID_PATTERN.test(userId) ||
      !ID_PATTERN.test(sessionId) ||
      !isRole(role) ||
      status !== "active" ||
      !Number.isSafeInteger(timestampMs) ||
      Math.abs(Date.now() - timestampMs) > AUTH_WINDOW_MS
    ) {
      response.status(401).json({ error: { code: "INVALID_IDENTITY_ASSERTION", message: "登录状态无效或已过期" } });
      return;
    }

    const expected = signIdentityAssertion(config.identity.signingSecret, {
      method: request.method,
      path: request.path,
      userId,
      sessionId,
      role,
      status,
      timestampMs
    });
    if (!constantTimeEqual(signature, expected)) {
      response.status(401).json({ error: { code: "INVALID_IDENTITY_ASSERTION", message: "登录状态无效或已过期" } });
      return;
    }

    request.principal = { userId, sessionId, role, status: "active" };
    next();
  };
}

export function requireAdmin(config: AppConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    const principal = request.principal;
    if (!principal || principal.role !== "admin" || !config.identity.adminUserIds.includes(principal.userId)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "无权访问该接口" } });
      return;
    }
    next();
  };
}

export function signIdentityAssertion(
  secret: string,
  input: {
    method: string;
    path: string;
    userId: string;
    sessionId: string;
    role: UserRole;
    status: "active";
    timestampMs: number;
  }
): string {
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    input.userId,
    input.sessionId,
    input.role,
    input.status,
    input.timestampMs.toString()
  ].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function identityHeaders(
  secret: string,
  token: string,
  input: { method: string; path: string; userId: string; sessionId: string; role?: UserRole; timestampMs?: number }
): Record<string, string> {
  const timestampMs = input.timestampMs ?? Date.now();
  const role = input.role ?? "user";
  return {
    Authorization: `Bearer ${token}`,
    "X-Unseen-User-Id": input.userId,
    "X-Unseen-Session-Id": input.sessionId,
    "X-Unseen-User-Role": role,
    "X-Unseen-User-Status": "active",
    "X-Unseen-Auth-Timestamp": timestampMs.toString(),
    "X-Unseen-Auth-Signature": signIdentityAssertion(secret, {
      method: input.method,
      path: input.path,
      userId: input.userId,
      sessionId: input.sessionId,
      role,
      status: "active",
      timestampMs
    })
  };
}

export function hashIdentifier(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 24);
}

function readBearer(header: string | undefined): string {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) ? header.slice(prefix.length) : "";
}

function isRole(value: string): value is UserRole {
  return value === "user" || value === "reviewer" || value === "admin";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
