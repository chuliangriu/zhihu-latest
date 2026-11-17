import type { RequestHandler } from "express";
import type { AuthenticatedPrincipal } from "./types.js";

export type SessionResolver = (cookie: string, signal: AbortSignal) => Promise<AuthenticatedPrincipal | null>;
export function requireSessionIdentity(resolve: SessionResolver | undefined, origins: string[]): RequestHandler {
  return async (request, response, next) => {
    // Cookie authentication requires an explicit same-origin caller for mutations.
    if (!["GET", "HEAD"].includes(request.method) && (!request.headers.origin || !origins.includes(request.headers.origin))) {
      response.status(403).json({ error: { code: "ORIGIN_FORBIDDEN" } }); return;
    }
    if (!resolve) { response.status(503).json({ error: { code: "IDENTITY_SERVICE_UNAVAILABLE" } }); return; }
    try {
      const principal = await resolve(request.headers.cookie ?? "", AbortSignal.timeout(5000));
      if (!principal) { response.status(401).json({ error: { code: "NOT_LOGGED_IN" } }); return; }
      request.principal = principal; next();
    } catch { response.status(503).json({ error: { code: "IDENTITY_SERVICE_UNAVAILABLE" } }); }
  };
}
