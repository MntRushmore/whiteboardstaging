/**
 * Type declarations for scripts/lib/routes.mjs (see snapshotAssets.d.mts for why `.d.mts`).
 */

export type RouteAuth = "user" | "public";
export type RouteBody = "zod" | "none";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface ApiRoute {
  path: string;
  file: string;
  methods: readonly HttpMethod[];
  auth: RouteAuth;
  limit: string;
  body: RouteBody;
  purpose: string;
  status: string;
  /** Public routes only: statuses an unauthenticated probe may receive (smoke test). */
  withoutTokenStatus?: readonly number[];
}

export interface RouteProbe {
  method: HttpMethod;
  path: string;
  route: ApiRoute;
}

export declare const PUBLIC_ROUTES: readonly string[];
/** Reason each PUBLIC_ROUTES file may skip requireUser. */
export declare const PUBLIC_ROUTE_REASONS: Readonly<Record<string, string>>;
export declare const NO_BODY_ROUTES: readonly string[];
export declare const API_ROUTES: readonly ApiRoute[];

export declare function protectedRoutes(routes?: readonly ApiRoute[]): ApiRoute[];
export declare function routeProbes(routes?: readonly ApiRoute[]): RouteProbe[];
export declare function routeFileToPath(file: string): string;
