import { promisify } from "util";
import { execFile as execFileCallback } from "child_process";
import { createHmac, randomBytes } from "crypto";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { createReadStream, existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

type BackendKey = "docquest" | "pdfBrach" | "mobileApp";
type AccessRole = "owner" | "viewer";
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type BackendResult = {
  ok: boolean;
  statusCode: number;
  data?: JsonValue | Record<string, unknown> | null;
  error?: {
    code: string;
    message: string;
  };
};

type ProxyRoute = {
  method: string;
  pattern: string;
  backendKey: BackendKey;
  toBackendPath: (params: Record<string, string>) => string;
};

type SessionRecord = {
  token: string;
  role: AccessRole;
  email: string;
  createdAt: string;
};

type AdminAuthMode =
  | "shared_token"
  | "internal_admin_jwt"
  | "static_internal_jwt"
  | "legacy_access_jwt"
  | "auto";

type StandardBackendConfig = {
  label: string;
  baseUrl: string;
  adminAuthMode: AdminAuthMode;
  internalAdminJwtSecret: string;
  internalAdminJwtAudience: string;
  internalAdminJwt: string;
  adminToken: string;
};

type MobileBackendConfig = StandardBackendConfig & {
  legacyAccessJwtSecret: string;
  legacyAccessJwtUserId: number;
  legacyAccessJwtUsername: string;
  legacyAccessJwtRole: string;
  legacyAccessJwtTokenVersion: number;
  legacyAccessJwtEmailVerified: boolean;
};

type DatabaseSnapshot = {
  usersTotal: number;
  studentsTotal: number;
  superAdminsTotal: number;
  subscriptionsTotal: number;
  activeSubscriptions: number;
  activePlans: number;
  paymentsTotal: number;
  testsTotal: number;
  draftsTotal: number;
  jobsTotal: number;
  notificationsTotal: number;
  webhooksTotal: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../public");

loadEnv(path.resolve(__dirname, "../.env"));
const execFile = promisify(execFileCallback);

const config = {
  port: Number(process.env.PORT || 2000),
  databaseUrl: process.env.DATABASE_URL || "",
  psqlPath: process.env.PSQL_PATH || "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe",
  auth: {
    ownerEmail: process.env.OWNER_LOGIN_EMAIL || "",
    ownerPassword: process.env.OWNER_LOGIN_PASSWORD || "",
    viewerEmail: process.env.VIEWER_LOGIN_EMAIL || "",
    viewerPassword: process.env.VIEWER_LOGIN_PASSWORD || "",
  },
  backends: {
    docquest: {
      label: "Student App",
      baseUrl: normalizeBaseUrl(process.env.DOCQUEST_BASE_URL),
      adminAuthMode: (process.env.DOCQUEST_ADMIN_AUTH_MODE as AdminAuthMode) || "auto",
      internalAdminJwtSecret: process.env.DOCQUEST_INTERNAL_ADMIN_JWT_SECRET || "",
      internalAdminJwtAudience: process.env.DOCQUEST_INTERNAL_ADMIN_JWT_AUDIENCE || "docquest",
      internalAdminJwt: process.env.DOCQUEST_INTERNAL_ADMIN_JWT || "",
      adminToken: process.env.DOCQUEST_ADMIN_TOKEN || "",
    },
    mobileApp: {
      label: "Mobile App",
      baseUrl: normalizeBaseUrl(process.env.MOBILEAPP_BASE_URL || process.env.MODELAPP_BASE_URL),
      adminAuthMode: (process.env.MOBILEAPP_ADMIN_AUTH_MODE as AdminAuthMode) || "shared_token",
      internalAdminJwtSecret:
        process.env.MOBILEAPP_INTERNAL_ADMIN_JWT_SECRET || process.env.MODELAPP_INTERNAL_ADMIN_JWT_SECRET || process.env.DOCQUEST_INTERNAL_ADMIN_JWT_SECRET || "",
      internalAdminJwtAudience:
        process.env.MOBILEAPP_INTERNAL_ADMIN_JWT_AUDIENCE || process.env.MODELAPP_INTERNAL_ADMIN_JWT_AUDIENCE || "mobileapp",
      internalAdminJwt:
        process.env.MOBILEAPP_INTERNAL_ADMIN_JWT || process.env.MODELAPP_INTERNAL_ADMIN_JWT || "",
      adminToken: process.env.MOBILEAPP_ADMIN_TOKEN || process.env.MODELAPP_ADMIN_TOKEN || process.env.DOCQUEST_ADMIN_TOKEN || "",
      legacyAccessJwtSecret:
        process.env.MOBILEAPP_ACCESS_JWT_SECRET || process.env.JWT_SECRET || "",
      legacyAccessJwtUserId:
        Number(process.env.MOBILEAPP_ACCESS_JWT_USER_ID || 0),
      legacyAccessJwtUsername:
        process.env.MOBILEAPP_ACCESS_JWT_USERNAME || "superadmin",
      legacyAccessJwtRole:
        process.env.MOBILEAPP_ACCESS_JWT_ROLE || "admin",
      legacyAccessJwtTokenVersion:
        Number(process.env.MOBILEAPP_ACCESS_JWT_TOKEN_VERSION || 0),
      legacyAccessJwtEmailVerified:
        (process.env.MOBILEAPP_ACCESS_JWT_IS_EMAIL_VERIFIED || "true").toLowerCase() !== "false",
    },
    pdfBrach: {
      label: "SaaS Website",
      baseUrl: normalizeBaseUrl(process.env.PDFBRACH_BASE_URL),
      adminAuthMode: (process.env.PDFBRACH_ADMIN_AUTH_MODE as AdminAuthMode) || "auto",
      internalAdminJwtSecret: process.env.PDFBRACH_INTERNAL_ADMIN_JWT_SECRET || "",
      internalAdminJwtAudience: process.env.PDFBRACH_INTERNAL_ADMIN_JWT_AUDIENCE || "pdf-brach",
      internalAdminJwt: process.env.PDFBRACH_INTERNAL_ADMIN_JWT || "",
      adminToken: process.env.PDFBRACH_ADMIN_TOKEN || "",
    },
  },
};

function isMobileBackendConfig(value: StandardBackendConfig | MobileBackendConfig): value is MobileBackendConfig {
  return "legacyAccessJwtSecret" in value;
}

const sessions = new Map<string, SessionRecord>();

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const proxyRoutes: ProxyRoute[] = [
  route("GET", "/api/docquest/users", "docquest", () => "/admin/users"),
  route("GET", "/api/docquest/users/:id", "docquest", ({ id }) => `/admin/users/${id}`),
  route("PATCH", "/api/docquest/users/:id/block", "docquest", ({ id }) => `/admin/users/${id}/block`),
  route("PATCH", "/api/docquest/users/:id/unblock", "docquest", ({ id }) => `/admin/users/${id}/unblock`),
  route("POST", "/api/docquest/users/:id/force-logout", "docquest", ({ id }) => `/admin/users/${id}/force-logout`),
  route("GET", "/api/docquest/subscriptions", "docquest", () => "/admin/subscriptions"),
  route("GET", "/api/docquest/subscriptions/:id", "docquest", ({ id }) => `/admin/subscriptions/${id}`),
  route("PATCH", "/api/docquest/subscriptions/:id/pause", "docquest", ({ id }) => `/admin/subscriptions/${id}/pause`),
  route("PATCH", "/api/docquest/subscriptions/:id/resume", "docquest", ({ id }) => `/admin/subscriptions/${id}/resume`),
  route("PATCH", "/api/docquest/subscriptions/:id/cancel", "docquest", ({ id }) => `/admin/subscriptions/${id}/cancel`),
  route("PATCH", "/api/docquest/subscriptions/:id/change-plan", "docquest", ({ id }) => `/admin/subscriptions/${id}/change-plan`),
  route("GET", "/api/docquest/payments", "docquest", () => "/admin/payments"),
  route("GET", "/api/docquest/payments/:id", "docquest", ({ id }) => `/admin/payments/${id}`),
  route("POST", "/api/docquest/payments/:id/refund", "docquest", ({ id }) => `/admin/payments/${id}/refund`),
  route("POST", "/api/docquest/payments/:id/reconcile", "docquest", ({ id }) => `/admin/payments/${id}/reconcile`),
  route("GET", "/api/docquest/notifications", "mobileApp", () => "/admin/notifications"),
  route("POST", "/api/docquest/notifications", "mobileApp", () => "/admin/notifications"),
  route("POST", "/api/docquest/notifications/:id/cancel", "mobileApp", ({ id }) => `/admin/notifications/${id}/cancel`),
  route("GET", "/api/docquest/competitions", "mobileApp", () => "/admin/competitions"),
  route("POST", "/api/docquest/competitions", "mobileApp", () => "/admin/competitions"),
  route("PATCH", "/api/docquest/competitions/:id", "mobileApp", ({ id }) => `/admin/competitions/${id}`),
  route("POST", "/api/docquest/competitions/:id/cancel", "mobileApp", ({ id }) => `/admin/competitions/${id}/cancel`),
  route("POST", "/api/docquest/email/send", "docquest", () => "/admin/email/send"),
  route("GET", "/api/docquest/email/history", "docquest", () => "/admin/email/history"),
  route("GET", "/api/docquest/tests", "docquest", () => "/admin/tests"),
  route("PATCH", "/api/docquest/tests/:id/publish", "docquest", ({ id }) => `/admin/tests/${id}/publish`),
  route("PATCH", "/api/docquest/tests/:id/unpublish", "docquest", ({ id }) => `/admin/tests/${id}/unpublish`),
  route("PATCH", "/api/docquest/tests/:id/archive", "docquest", ({ id }) => `/admin/tests/${id}/archive`),
  route("GET", "/api/docquest/audit-log", "docquest", () => "/admin/audit-log"),
  route("GET", "/api/pdf/customers", "pdfBrach", () => "/admin/customers"),
  route("PATCH", "/api/pdf/customers/:id/block", "pdfBrach", ({ id }) => `/admin/customers/${id}/block`),
  route("PATCH", "/api/pdf/customers/:id/unblock", "pdfBrach", ({ id }) => `/admin/customers/${id}/unblock`),
  route("GET", "/api/pdf/subscriptions", "pdfBrach", () => "/admin/subscriptions"),
  route("PATCH", "/api/pdf/subscriptions/:id/pause", "pdfBrach", ({ id }) => `/admin/subscriptions/${id}/pause`),
  route("PATCH", "/api/pdf/subscriptions/:id/resume", "pdfBrach", ({ id }) => `/admin/subscriptions/${id}/resume`),
  route("PATCH", "/api/pdf/subscriptions/:id/cancel", "pdfBrach", ({ id }) => `/admin/subscriptions/${id}/cancel`),
  route("POST", "/api/pdf/email/send", "pdfBrach", () => "/admin/email/send"),
  route("GET", "/api/pdf/email/history", "pdfBrach", () => "/admin/email/history"),
  route("GET", "/api/pdf/drafts", "pdfBrach", () => "/admin/drafts"),
  route("GET", "/api/pdf/audit-log", "pdfBrach", () => "/admin/audit-log"),
];

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/login" && req.method === "POST") {
      return handleLogin(req, res);
    }
    if (requestUrl.pathname === "/api/logout" && req.method === "POST") {
      return handleLogout(req, res);
    }
    if (requestUrl.pathname === "/api/session" && req.method === "GET") {
      return handleSession(req, res);
    }

    const session = requestUrl.pathname.startsWith("/api/") ? getSessionFromRequest(req) : null;
    if (requestUrl.pathname.startsWith("/api/") && !session) {
      return sendJson(res, 401, {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Login required",
        },
      });
    }

    if (requestUrl.pathname.startsWith("/api/") && session && isOwnerOnlyRequest(req.method || "GET", requestUrl.pathname) && session.role !== "owner") {
      return sendJson(res, 403, {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Owner access required",
        },
      });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/config") {
      return sendJson(res, 200, { ok: true, data: { backends: summarizeBackends(), session } });
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/overview") {
      return handleOverview(res);
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      return handleHealth(res);
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/activity") {
      return handleActivity(res);
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/audit") {
      return handleAudit(res);
    }

    const handled = await handleProxy(req, res, requestUrl);
    if (handled) {
      return;
    }

    return serveStatic(requestUrl.pathname, res);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}).listen(config.port, () => {
  console.log(`Superadmin dashboard running on http://localhost:${config.port}`);
});

function route(
  method: string,
  pattern: string,
  backendKey: BackendKey,
  toBackendPath: (params: Record<string, string>) => string,
): ProxyRoute {
  return { method, pattern, backendKey, toBackendPath };
}

async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rawBody = await readRequestBody(req);
  const payload = parsePayload(rawBody);
  const body = isRecord(payload) ? payload : {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const role = resolveRole(email, password);
  if (!role) {
    return sendJson(res, 401, {
      ok: false,
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      },
    });
  }

  const token = randomBytes(24).toString("hex");
  const session: SessionRecord = {
    token,
    role,
    email,
    createdAt: new Date().toISOString(),
  };
  sessions.set(token, session);

  return sendJson(res, 200, { ok: true, data: { role, email } }, [
    serializeSessionCookie(token),
  ]);
}

function handleLogout(req: IncomingMessage, res: ServerResponse): boolean {
  const session = getSessionFromRequest(req);
  if (session) {
    sessions.delete(session.token);
  }
  return sendJson(res, 200, { ok: true, data: { loggedOut: true } }, [
    clearSessionCookie(),
  ]);
}

function handleSession(req: IncomingMessage, res: ServerResponse): boolean {
  const session = getSessionFromRequest(req);
  if (!session) {
    return sendJson(res, 401, {
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "No active session",
      },
    });
  }

  return sendJson(res, 200, {
    ok: true,
    data: {
      role: session.role,
      email: session.email,
      createdAt: session.createdAt,
    },
  });
}

function resolveRole(email: string, password: string): AccessRole | null {
  if (email === config.auth.ownerEmail.toLowerCase() && password === config.auth.ownerPassword) {
    return "owner";
  }
  if (email === config.auth.viewerEmail.toLowerCase() && password === config.auth.viewerPassword) {
    return "viewer";
  }
  return null;
}

function getSessionFromRequest(req: IncomingMessage): SessionRecord | null {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.docforge_session;
  if (!token) {
    return null;
  }
  return sessions.get(token) || null;
}

function parseCookies(header: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key) {
      output[key] = decodeURIComponent(value);
    }
  }
  return output;
}

function serializeSessionCookie(token: string): string {
  return `docforge_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax`;
}

function clearSessionCookie(): string {
  return "docforge_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax";
}

function isOwnerOnlyRequest(method: string, pathname: string): boolean {
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  if (method !== "GET") {
    return true;
  }

  const ownerPrefixes = [
    "/api/docquest/users",
    "/api/docquest/subscriptions",
    "/api/docquest/payments",
    "/api/docquest/email",
    "/api/docquest/notifications",
    "/api/docquest/competitions",
    "/api/docquest/tests",
    "/api/pdf/subscriptions",
    "/api/pdf/email",
    "/api/pdf/customers",
  ];

  return ownerPrefixes.some((prefix) => pathname.startsWith(prefix));
}

async function handleOverview(res: ServerResponse): Promise<boolean> {
  const [docquest, pdfBrach, database] = await Promise.all([
    requestBackend("docquest", "/admin/overview"),
    requestBackend("pdfBrach", "/admin/overview"),
    getDatabaseSnapshot(),
  ]);
  return sendJson(res, 200, {
    ok: true,
    data: {
      docquest,
      pdfBrach,
      database,
      totals: { connectedBackends: [docquest, pdfBrach].filter((item) => item.ok).length, totalBackends: 2 },
    },
  });
}

async function handleHealth(res: ServerResponse): Promise<boolean> {
  const [docquest, pdfBrach] = await Promise.all([
    requestBackend("docquest", "/admin/health-summary"),
    requestBackend("pdfBrach", "/admin/health-summary"),
  ]);
  return sendJson(res, 200, {
    ok: true,
    data: { docquest, pdfBrach, overall: docquest.ok && pdfBrach.ok ? "healthy" : "degraded" },
  });
}

async function handleActivity(res: ServerResponse): Promise<boolean> {
  const [notifications, competitions, subscriptions, customers, drafts] = await Promise.all([
    requestBackend("mobileApp", "/admin/notifications"),
    requestBackend("mobileApp", "/admin/competitions"),
    requestBackend("docquest", "/admin/subscriptions"),
    requestBackend("pdfBrach", "/admin/customers"),
    requestBackend("pdfBrach", "/admin/drafts"),
  ]);
  return sendJson(res, 200, {
    ok: true,
    data: { notifications, competitions, subscriptions, customers, drafts },
  });
}

async function handleAudit(res: ServerResponse): Promise<boolean> {
  const [docquest, pdfBrach] = await Promise.all([
    requestBackend("docquest", "/admin/audit-log"),
    requestBackend("pdfBrach", "/admin/audit-log"),
  ]);
  return sendJson(res, 200, { ok: true, data: { docquest, pdfBrach } });
}

async function handleProxy(req: IncomingMessage, res: ServerResponse, requestUrl: URL): Promise<boolean> {
  const current = proxyRoutes.find((item) => item.method === (req.method || "GET") && pathMatches(item.pattern, requestUrl.pathname));
  if (!current) {
    return false;
  }

  const params = extractParams(current.pattern, requestUrl.pathname);
  const upstreamPath = current.toBackendPath(params);
  const result = await requestBackend(current.backendKey, upstreamPath, {
    method: req.method || "GET",
    body: await readRequestBody(req),
  });
  const upstreamRequestId =
    result.ok &&
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data) &&
    "meta" in result.data &&
    result.data.meta &&
    typeof result.data.meta === "object" &&
    result.data.meta &&
    "requestId" in result.data.meta
      ? String(result.data.meta.requestId)
      : null;

  return sendJson(res, result.ok ? 200 : result.statusCode || 502, {
    ok: result.ok,
    data: result.ok ? result.data ?? null : null,
    error: result.ok ? null : result.error,
    meta: {
      backend: current.backendKey,
      upstreamPath,
      statusCode: result.statusCode || null,
      upstreamRequestId,
    },
  });
}

function pathMatches(pattern: string, pathname: string): boolean {
  const a = pattern.split("/").filter(Boolean);
  const b = pathname.split("/").filter(Boolean);
  return a.length === b.length && a.every((part, index) => part.startsWith(":") || part === b[index]);
}

function extractParams(pattern: string, pathname: string): Record<string, string> {
  const params: Record<string, string> = {};
  const a = pattern.split("/").filter(Boolean);
  const b = pathname.split("/").filter(Boolean);
  a.forEach((part, index) => {
    if (part.startsWith(":")) {
      params[part.slice(1)] = b[index] || "";
    }
  });
  return params;
}

async function requestBackend(
  backendKey: BackendKey,
  resourcePath: string,
  options: { method?: string; body?: string } = {},
): Promise<BackendResult> {
  const backend = config.backends[backendKey];
  if (!backend.baseUrl) {
    return {
      ok: true,
      statusCode: 200,
      data: {
        status: "not_configured",
        backend: backendKey,
      },
    };
  }

  const hasAuth =
    Boolean(backend.internalAdminJwt) ||
    Boolean(backend.internalAdminJwtSecret) ||
    Boolean(backend.adminToken) ||
    (backendKey === "mobileApp" &&
      isMobileBackendConfig(backend) &&
      Boolean(backend.legacyAccessJwtSecret) &&
      Number.isFinite(backend.legacyAccessJwtUserId) &&
      backend.legacyAccessJwtUserId > 0);

  if (!hasAuth) {
    return {
      ok: true,
      statusCode: 200,
      data: {
        status: "missing_auth",
        backend: backendKey,
      },
    };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  applyAdminAuthHeaders(backendKey, backend, headers);
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(`${backend.baseUrl}${resourcePath}`, {
      method: options.method || "GET",
      headers,
      body: options.body || undefined,
    });
    const text = await response.text();
    const parsed = parsePayload(text);
    const parsedObject =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const upstreamError =
      parsedObject && typeof parsedObject.error === "object" && parsedObject.error
        ? (parsedObject.error as { code: string; message: string })
        : undefined;
    const upstreamMessage =
      parsedObject && typeof parsedObject.message === "string"
        ? parsedObject.message
        : text;

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        error: upstreamError || {
          code: "UPSTREAM_ERROR",
          message: upstreamMessage || `Upstream error ${response.status}`,
        },
      };
    }

    return { ok: true, statusCode: response.status, data: parsed };
  } catch (error) {
    return backendError("UPSTREAM_UNREACHABLE", error instanceof Error ? error.message : "Failed to reach backend", 502);
  }
}

function applyAdminAuthHeaders(
  backendKey: BackendKey,
  backend: StandardBackendConfig | MobileBackendConfig,
  headers: Record<string, string>,
): void {
  const mode = backend.adminAuthMode;

  const applySharedToken = () => {
    if (backend.adminToken) {
      headers["X-Admin-Token"] = backend.adminToken;
      // Fallback for gateways that strip custom headers.
      headers.Authorization = `Bearer ${backend.adminToken}`;
      return true;
    }
    return false;
  };

  const applyStaticInternalJwt = () => {
    if (backend.internalAdminJwt) {
      headers.Authorization = `Bearer ${backend.internalAdminJwt}`;
      return true;
    }
    return false;
  };

  const applyGeneratedInternalJwt = () => {
    if (backend.internalAdminJwtSecret) {
      headers.Authorization = `Bearer ${generateInternalAdminJwt(
        backend.internalAdminJwtSecret,
        backend.internalAdminJwtAudience,
      )}`;
      return true;
    }
    return false;
  };

  const applyLegacyAccessJwt = () => {
    if (
      backendKey === "mobileApp" &&
      isMobileBackendConfig(backend) &&
      backend.legacyAccessJwtSecret &&
      Number.isFinite(backend.legacyAccessJwtUserId) &&
      backend.legacyAccessJwtUserId > 0
    ) {
      headers.Authorization = `Bearer ${generateLegacyAccessJwt({
        secret: backend.legacyAccessJwtSecret,
        userId: backend.legacyAccessJwtUserId,
        username: backend.legacyAccessJwtUsername,
        role: backend.legacyAccessJwtRole,
        tokenVersion: backend.legacyAccessJwtTokenVersion,
        isEmailVerified: backend.legacyAccessJwtEmailVerified,
      })}`;
      return true;
    }
    return false;
  };

  if (mode === "shared_token") {
    applySharedToken();
    return;
  }
  if (mode === "static_internal_jwt") {
    applyStaticInternalJwt();
    return;
  }
  if (mode === "internal_admin_jwt") {
    applyGeneratedInternalJwt();
    return;
  }
  if (mode === "legacy_access_jwt") {
    applyLegacyAccessJwt();
    return;
  }

  // auto mode fallback order (most secure first).
  if (applyStaticInternalJwt()) return;
  if (applyGeneratedInternalJwt()) return;
  if (applySharedToken()) return;
  applyLegacyAccessJwt();
}

function backendError(code: string, message: string, statusCode: number): BackendResult {
  return { ok: false, statusCode, error: { code, message } };
}

function parsePayload(text: string): JsonValue | Record<string, unknown> | null {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as JsonValue | Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(publicDir, requested);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    const hasExtension = path.extname(requested) !== "";
    if (!hasExtension) {
      filePath = path.resolve(publicDir, "index.html");
    }
  }

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Resource not found" } });
  }

  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
  return true;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
  extraCookies: string[] = [],
): boolean {
  const headers: Record<string, string | string[]> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (extraCookies.length) {
    headers["Set-Cookie"] = extraCookies;
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload, null, 2));
  return true;
}

function normalizeBaseUrl(value: string | undefined): string {
  return value ? value.replace(/\/+$/, "") : "";
}

function summarizeBackends(): Array<Record<string, string | boolean>> {
  const backends = Object.entries(config.backends).map(([key, backend]) => ({
    key,
    label: backend.label,
    baseUrl: backend.baseUrl,
    jwtConfigured: Boolean(backend.internalAdminJwt || backend.internalAdminJwtSecret),
    tokenConfigured: Boolean(backend.adminToken),
  }));

  backends.push({
    key: "database",
    label: "Primary Database",
    baseUrl: config.databaseUrl ? "Connected via DATABASE_URL" : "",
    jwtConfigured: Boolean(config.databaseUrl),
    tokenConfigured: existsSync(config.psqlPath),
  });

  return backends;
}

function generateInternalAdminJwt(secret: string, audience: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    adminId: "docforge-superadmin",
    adminRole: "superadmin",
    sub: "docforge-superadmin",
    role: "owner",
    iss: "docforge-superadmin",
    aud: audience,
    sourceSystem: "superadmin",
    iat: now,
    exp: now + 300,
    jti: randomBytes(8).toString("hex"),
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function generateLegacyAccessJwt(input: {
  secret: string;
  userId: number;
  username: string;
  role: string;
  tokenVersion: number;
  isEmailVerified: boolean;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    id: input.userId,
    username: input.username,
    role: input.role,
    is_email_verified: input.isEmailVerified,
    tokenVersion: input.tokenVersion,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", input.secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function loadEnv(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  const source = readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const existing = process.env[key];
    if (key && (existing === undefined || existing === "")) {
      process.env[key] = value;
    }
  }
}

async function getDatabaseSnapshot(): Promise<BackendResult> {
  if (!config.databaseUrl) {
    return backendError("DATABASE_NOT_CONFIGURED", "DATABASE_URL is not configured", 500);
  }
  if (!existsSync(config.psqlPath)) {
    return backendError("PSQL_NOT_FOUND", "psql executable not found", 500);
  }

  const sql = [
    "SELECT json_build_object(",
    "'usersTotal', (SELECT COUNT(*) FROM users),",
    "'studentsTotal', (SELECT COUNT(*) FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'student'),",
    "'superAdminsTotal', (SELECT COUNT(*) FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = 'super_admin'),",
    "'subscriptionsTotal', (SELECT COUNT(*) FROM subscriptions),",
    "'activeSubscriptions', (SELECT COUNT(*) FROM subscriptions WHERE is_active = true),",
    "'activePlans', (SELECT COUNT(*) FROM plans WHERE is_active = true),",
    "'paymentsTotal', (SELECT COUNT(*) FROM payments),",
    "'testsTotal', (SELECT COUNT(*) FROM tests),",
    "'draftsTotal', (SELECT COUNT(*) FROM paper_drafts),",
    "'jobsTotal', (SELECT COUNT(*) FROM jobs),",
    "'notificationsTotal', (SELECT COUNT(*) FROM notifications),",
    "'webhooksTotal', (SELECT COUNT(*) FROM webhook_events)",
    ");",
  ].join(" ");

  try {
    const { stdout } = await execFile(config.psqlPath, [config.databaseUrl, "-t", "-A", "-c", sql], {
      windowsHide: true,
      timeout: 15000,
    });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return backendError("DATABASE_EMPTY", "Database query returned no data", 502);
    }

    const parsed = JSON.parse(trimmed) as DatabaseSnapshot;
    return {
      ok: true,
      statusCode: 200,
      data: parsed,
    };
  } catch (error) {
    return backendError(
      "DATABASE_QUERY_FAILED",
      error instanceof Error ? error.message : "Database query failed",
      502,
    );
  }
}
