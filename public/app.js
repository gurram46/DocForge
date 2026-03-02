"use strict";
const elements = {
    loginShell: document.querySelector("#login-shell"),
    loginForm: document.querySelector("#login-form"),
    loginError: document.querySelector("#login-error"),
    appShell: document.querySelector("#app-shell"),
    backendStatus: document.querySelector("#backend-status"),
    kpiGrid: document.querySelector("#kpi-grid"),
    healthGrid: document.querySelector("#health-grid"),
    activityFeed: document.querySelector("#activity-feed"),
    auditFeed: document.querySelector("#audit-feed"),
    emailForm: document.querySelector("#email-form"),
    emailResult: document.querySelector("#email-result"),
    notificationForm: document.querySelector("#notification-form"),
    notificationResult: document.querySelector("#notification-result"),
    competitionForm: document.querySelector("#competition-form"),
    competitionResult: document.querySelector("#competition-result"),
    userList: document.querySelector("#user-list"),
    subscriptionList: document.querySelector("#subscription-list"),
    refreshAll: document.querySelector("#refresh-all"),
    logoutButton: document.querySelector("#logout-button"),
    roleBadge: document.querySelector("#role-badge"),
    roleCopy: document.querySelector("#role-copy"),
    sessionEmail: document.querySelector("#session-email"),
};
let currentSession = null;
bindEvents();
void bootstrap();
function bindEvents() {
    elements.loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void handleLoginSubmit();
    });
    elements.logoutButton.addEventListener("click", () => void handleLogout());
    elements.refreshAll.addEventListener("click", () => void refreshAll());
    getButton('[data-action="refresh-health"]').addEventListener("click", () => void loadHealth());
    getButton('[data-action="refresh-activity"]').addEventListener("click", () => void loadActivity());
    getButton('[data-action="refresh-audit"]').addEventListener("click", () => void loadAudit());
    getButton('[data-action="load-users"]').addEventListener("click", () => void loadUsers());
    getButton('[data-action="load-subscriptions"]').addEventListener("click", () => void loadSubscriptions());
    elements.emailForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void handleEmailSubmit();
    });
    elements.notificationForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void handleNotificationSubmit();
    });
    elements.competitionForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void handleCompetitionSubmit();
    });
}
function getButton(selector) {
    return document.querySelector(selector);
}
async function bootstrap() {
    const session = await fetchSession();
    if (!session) {
        showLogin();
        return;
    }
    currentSession = session;
    applyRoleMode();
    showApp();
    await refreshAll();
}
async function fetchSession() {
    const result = await api("/api/session");
    if (!result.ok || !result.data) {
        return null;
    }
    return result.data;
}
function showLogin(message = "") {
    currentSession = null;
    document.body.classList.remove("is-viewer");
    elements.loginShell.classList.remove("hidden");
    elements.appShell.classList.add("hidden");
    elements.loginError.textContent = message;
}
function showApp() {
    elements.loginShell.classList.add("hidden");
    elements.appShell.classList.remove("hidden");
}
function isOwner() {
    return currentSession?.role === "owner";
}
function applyRoleMode() {
    if (!currentSession) {
        return;
    }
    const isViewer = currentSession.role === "viewer";
    document.body.classList.toggle("is-viewer", isViewer);
    elements.roleBadge.textContent = isViewer ? "Viewer" : "Owner";
    elements.roleCopy.textContent = isViewer
        ? "Read-only investor visibility. Analytics, health, activity, and audit remain visible."
        : "Privileged operator access. Control actions are enabled for live administration.";
    elements.sessionEmail.textContent = currentSession.email;
    renderViewerBanner(isViewer);
}
function renderViewerBanner(isViewer) {
    const existing = document.querySelector("#viewer-banner");
    if (existing) {
        existing.remove();
    }
    if (!isViewer) {
        return;
    }
    const banner = document.createElement("div");
    banner.id = "viewer-banner";
    banner.className = "viewer-banner";
    banner.textContent = "Viewer access is active. This workspace is read-only and control actions are intentionally hidden.";
    const mainPanel = document.querySelector(".main-panel");
    if (mainPanel) {
        mainPanel.prepend(banner);
    }
}
async function handleLoginSubmit() {
    const form = new FormData(elements.loginForm);
    const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
            email: form.get("email"),
            password: form.get("password"),
        }),
    });
    if (!result.ok || !result.data) {
        elements.loginError.textContent = result.error?.message || "Login failed";
        return;
    }
    currentSession = result.data;
    elements.loginForm.reset();
    elements.loginError.textContent = "";
    applyRoleMode();
    showApp();
    await refreshAll();
}
async function handleLogout() {
    await api("/api/logout", { method: "POST" });
    showLogin("Signed out.");
}
async function refreshAll() {
    await Promise.all([
        loadConfig(),
        loadOverview(),
        loadHealth(),
        loadActivity(),
        loadAudit(),
        isOwner() ? loadUsers() : clearOwnerLists(),
        isOwner() ? loadSubscriptions() : clearOwnerLists(),
    ]);
}
function clearOwnerLists() {
    elements.userList.innerHTML = "";
    elements.subscriptionList.innerHTML = "";
}
async function loadConfig() {
    const result = await api("/api/config");
    if (!result.ok || !result.data) {
        elements.backendStatus.innerHTML = errorCard("Config unavailable", result.error?.message);
        return;
    }
    if (!currentSession && result.data.session) {
        currentSession = result.data.session;
        applyRoleMode();
    }
    elements.backendStatus.innerHTML = result.data.backends
        .map((backend) => `
        <div class="item-card">
          <strong>${escapeHtml(backend.label)}</strong>
          <div>${escapeHtml(backend.baseUrl || "Not configured")}</div>
          <div class="${backend.jwtConfigured ? "status-ok" : "status-warn"}">
            ${backend.jwtConfigured ? "Internal admin JWT configured" : "Internal admin JWT missing"}
          </div>
          <div class="${backend.tokenConfigured ? "status-ok" : "status-warn"}">
            ${backend.tokenConfigured ? "Admin token configured" : "Admin token missing"}
          </div>
        </div>
      `)
        .join("");
}
async function loadOverview() {
    const result = await api("/api/overview");
    if (!result.ok || !result.data) {
        elements.kpiGrid.innerHTML = errorCard("Overview unavailable", result.error?.message);
        return;
    }
    const { docquest, pdfBrach, database, totals } = result.data;
    const cards = [
        {
            label: "Users",
            value: database.ok && database.data ? formatNumber(database.data.usersTotal) : "Unavailable",
        },
        {
            label: "Active Subs",
            value: database.ok && database.data
                ? `${formatNumber(database.data.activeSubscriptions)}/${formatNumber(database.data.subscriptionsTotal)}`
                : "Unavailable",
        },
        {
            label: "Tests",
            value: database.ok && database.data ? formatNumber(database.data.testsTotal) : "Unavailable",
        },
        {
            label: "Jobs",
            value: database.ok && database.data ? formatNumber(database.data.jobsTotal) : "Unavailable",
        },
        { label: "Connected Backends", value: `${totals.connectedBackends}/${totals.totalBackends}` },
        { label: "Student API", value: docquest.ok ? summarize(docquest.data) : "Unavailable" },
        { label: "SaaS API", value: pdfBrach.ok ? summarize(pdfBrach.data) : "Unavailable" },
        { label: "Executive View", value: currentSession?.role === "viewer" ? "Read only" : "Operational" },
    ];
    elements.kpiGrid.innerHTML = cards
        .map((card) => `
        <article class="kpi-card">
          <p class="kpi-label">${escapeHtml(card.label)}</p>
          <p class="kpi-value">${escapeHtml(card.value)}</p>
        </article>
      `)
        .join("");
}
async function loadHealth() {
    const result = await api("/api/health");
    if (!result.ok || !result.data) {
        elements.healthGrid.innerHTML = errorCard("Health unavailable", result.error?.message);
        return;
    }
    const items = [
        ["Student App", result.data.docquest],
        ["SaaS Website", result.data.pdfBrach],
    ];
    elements.healthGrid.innerHTML = items
        .map(([label, item]) => `
        <div class="item-card">
          <strong>${escapeHtml(label)}</strong>
          <div class="${item.ok ? "status-ok" : "status-danger"}">${item.ok ? "Healthy" : "Degraded"}</div>
          <div>${escapeHtml(item.ok ? shortJson(item.data) : item.error?.message || "No details")}</div>
        </div>
      `)
        .join("");
}
async function loadActivity() {
    const result = await api("/api/activity");
    if (!result.ok || !result.data) {
        elements.activityFeed.innerHTML = errorCard("Activity unavailable", result.error?.message);
        return;
    }
    const blocks = [
        ["Notifications", result.data.notifications],
        ["Competitions", result.data.competitions],
        ["Subscriptions", result.data.subscriptions],
        ["Customers", result.data.customers],
        ["Drafts", result.data.drafts],
    ];
    elements.activityFeed.innerHTML = blocks
        .map(([label, item]) => `
        <div class="item-card">
          <strong>${escapeHtml(label)}</strong>
          <div class="${item.ok ? "status-ok" : "status-warn"}">${item.ok ? "Loaded" : "Waiting on backend"}</div>
          <div>${escapeHtml(item.ok ? shortJson(item.data) : item.error?.message || "No details")}</div>
        </div>
      `)
        .join("");
}
async function loadAudit() {
    const result = await api("/api/audit");
    if (!result.ok || !result.data) {
        elements.auditFeed.innerHTML = errorCard("Audit unavailable", result.error?.message);
        return;
    }
    const blocks = [
        ["Student App Audit", result.data.docquest],
        ["SaaS Audit", result.data.pdfBrach],
    ];
    elements.auditFeed.innerHTML = blocks.map(([label, item]) => renderAuditBlock(label, item)).join("");
}
function renderAuditBlock(label, item) {
    if (!item.ok) {
        return `
      <div class="item-card">
        <strong>${escapeHtml(label)}</strong>
        <div class="status-warn">${escapeHtml(item.error?.message || "Unavailable")}</div>
      </div>
    `;
    }
    const rows = inferItems(item.data).slice(0, 5);
    if (!rows.length) {
        return `
      <div class="item-card">
        <strong>${escapeHtml(label)}</strong>
        <div>No audit rows returned yet.</div>
        <div>${escapeHtml(shortJson(item.data))}</div>
      </div>
    `;
    }
    return `
    <div class="item-card">
      <strong>${escapeHtml(label)}</strong>
      ${rows
        .map((row) => {
        const action = firstString(row, ["action", "action_name", "event"]) || "event";
        const target = firstString(row, ["target", "target_entity_type", "target_type"]) || "resource";
        const stamp = firstString(row, ["created_at", "timestamp", "logged_at"]) || "time unavailable";
        return `
            <div class="item-card">
              <strong>${escapeHtml(action)}</strong>
              <div>${escapeHtml(target)}</div>
              <div>${escapeHtml(stamp)}</div>
            </div>
          `;
    })
        .join("")}
    </div>
  `;
}
async function loadUsers() {
    const result = await api("/api/docquest/users");
    if (!result.ok) {
        elements.userList.innerHTML = errorCard("Users unavailable", result.error?.message);
        return;
    }
    const items = inferItems(result.data).slice(0, 8);
    if (!items.length) {
        elements.userList.innerHTML = '<div class="item-card">No user rows returned yet.</div>';
        return;
    }
    elements.userList.innerHTML = items
        .map((user) => {
        const id = firstScalar(user, ["user_id", "id", "userId"]) || "unknown";
        const label = firstString(user, ["email", "name"]) || `User ${id}`;
        return `
        <div class="item-card">
          <strong>${escapeHtml(label)}</strong>
          <div>ID: ${escapeHtml(String(id))}</div>
          <div class="item-actions">
            <button type="button" data-user-action="block" data-user-id="${escapeHtml(String(id))}">Block</button>
            <button type="button" data-user-action="unblock" data-user-id="${escapeHtml(String(id))}">Unblock</button>
            <button type="button" data-user-action="force-logout" data-user-id="${escapeHtml(String(id))}">Force Logout</button>
          </div>
        </div>
      `;
    })
        .join("");
    document.querySelectorAll("[data-user-action]").forEach((button) => {
        button.addEventListener("click", async () => {
            const element = button;
            const id = element.getAttribute("data-user-id");
            const action = element.getAttribute("data-user-action");
            if (!id || !action) {
                return;
            }
            const method = action === "force-logout" ? "POST" : "PATCH";
            const result = await api(`/api/docquest/users/${id}/${action}`, { method });
            window.alert(result.ok ? `${action} succeeded` : `${action} failed: ${result.error?.message || "Unknown error"}`);
        });
    });
}
async function loadSubscriptions() {
    const [docquest, pdf] = await Promise.all([
        api("/api/docquest/subscriptions"),
        api("/api/pdf/subscriptions"),
    ]);
    elements.subscriptionList.innerHTML = [
        renderSubscriptionGroup("Student App", docquest, "docquest"),
        renderSubscriptionGroup("SaaS Website", pdf, "pdf"),
    ].join("");
    document.querySelectorAll("[data-sub-action]").forEach((button) => {
        button.addEventListener("click", async () => {
            const element = button;
            const system = element.getAttribute("data-system");
            const id = element.getAttribute("data-sub-id");
            const action = element.getAttribute("data-sub-action");
            if (!system || !id || !action) {
                return;
            }
            const result = await api(`/api/${system}/subscriptions/${id}/${action}`, { method: "PATCH" });
            window.alert(result.ok ? `${action} succeeded` : `${action} failed: ${result.error?.message || "Unknown error"}`);
        });
    });
}
async function handleEmailSubmit() {
    const form = new FormData(elements.emailForm);
    const endpoint = form.get("target") === "pdf" ? "/api/pdf/email/send" : "/api/docquest/email/send";
    const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
            subject: form.get("subject"),
            body: form.get("body"),
            audience: form.get("audience"),
        }),
    });
    elements.emailResult.textContent = JSON.stringify(result, null, 2);
}
async function handleNotificationSubmit() {
    const form = new FormData(elements.notificationForm);
    const ids = String(form.get("userIds") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    const result = await api("/api/docquest/notifications", {
        method: "POST",
        body: JSON.stringify({
            title: form.get("title"),
            body: form.get("body"),
            deepLink: form.get("deepLink"),
            target: form.get("target"),
            userIds: ids,
        }),
    });
    elements.notificationResult.textContent = JSON.stringify(result, null, 2);
    await loadActivity();
}
async function handleCompetitionSubmit() {
    const form = new FormData(elements.competitionForm);
    const result = await api("/api/docquest/competitions", {
        method: "POST",
        body: JSON.stringify({
            title: form.get("title"),
            testId: Number(form.get("testId")),
            startsAt: toIso(form.get("startsAt")),
            endsAt: toIso(form.get("endsAt")),
            joinDeadline: toIso(form.get("joinDeadline")),
            durationMinutes: Number(form.get("durationMinutes")),
            description: form.get("description"),
        }),
    });
    elements.competitionResult.textContent = JSON.stringify(result, null, 2);
    await loadActivity();
}
function renderSubscriptionGroup(label, result, system) {
    if (!result.ok) {
        return `
      <div class="item-card">
        <strong>${escapeHtml(label)}</strong>
        <div class="status-warn">${escapeHtml(result.error?.message || "Unavailable")}</div>
      </div>
    `;
    }
    const items = inferItems(result.data).slice(0, 6);
    if (!items.length) {
        return `
      <div class="item-card">
        <strong>${escapeHtml(label)}</strong>
        <div>No subscription rows returned yet.</div>
      </div>
    `;
    }
    return `
    <div class="item-card">
      <strong>${escapeHtml(label)}</strong>
      ${items
        .map((item) => {
        const id = firstScalar(item, ["id", "subscription_id", "subscriptionId"]) || "unknown";
        const line = firstString(item, ["plan", "plan_name", "status"]) || `Subscription ${String(id)}`;
        return `
            <div class="item-card">
              <strong>${escapeHtml(line)}</strong>
              <div>ID: ${escapeHtml(String(id))}</div>
              <div class="item-actions">
                <button type="button" data-system="${escapeHtml(system)}" data-sub-id="${escapeHtml(String(id))}" data-sub-action="pause">Pause</button>
                <button type="button" data-system="${escapeHtml(system)}" data-sub-id="${escapeHtml(String(id))}" data-sub-action="resume">Resume</button>
                <button type="button" data-system="${escapeHtml(system)}" data-sub-id="${escapeHtml(String(id))}" data-sub-action="cancel">Cancel</button>
              </div>
            </div>
          `;
    })
        .join("")}
    </div>
  `;
}
async function api(url, options = {}) {
    try {
        const response = await fetch(url, {
            method: options.method || "GET",
            headers: { "Content-Type": "application/json" },
            body: options.body,
            credentials: "same-origin",
        });
        const payload = (await response.json());
        if (response.status === 401 && url !== "/api/session" && url !== "/api/login") {
            showLogin("Your session expired. Log in again.");
        }
        return payload;
    }
    catch (error) {
        return {
            ok: false,
            error: { message: error instanceof Error ? error.message : "Request failed" },
        };
    }
}
function inferItems(payload) {
    if (Array.isArray(payload)) {
        return payload.filter(isRecordLike);
    }
    if (!isRecordLike(payload)) {
        return [];
    }
    if (Array.isArray(payload.items)) {
        return payload.items.filter(isRecordLike);
    }
    if (Array.isArray(payload.data)) {
        return payload.data.filter(isRecordLike);
    }
    if (isRecordLike(payload.data) && Array.isArray(payload.data.items)) {
        return payload.data.items.filter(isRecordLike);
    }
    return [];
}
function isRecordLike(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function summarize(payload) {
    const base = unwrapData(payload);
    if (!isRecordLike(base)) {
        return "Connected";
    }
    const keys = Object.keys(base).slice(0, 2);
    if (!keys.length) {
        return "Connected";
    }
    return keys.map((key) => `${key}:${formatValue(base[key])}`).join(" ");
}
function shortJson(value) {
    return JSON.stringify(unwrapData(value)).slice(0, 180);
}
function unwrapData(value) {
    if (isRecordLike(value) && "data" in value) {
        return value.data;
    }
    return value;
}
function firstString(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value) {
            return value;
        }
    }
    return null;
}
function firstScalar(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
            return value;
        }
    }
    return null;
}
function formatValue(value) {
    if (typeof value === "number") {
        return value.toLocaleString();
    }
    if (typeof value === "string") {
        return value;
    }
    if (isRecordLike(value)) {
        const nestedKey = Object.keys(value)[0];
        return nestedKey ? formatValue(value[nestedKey]) : "object";
    }
    if (Array.isArray(value)) {
        return `${value.length}`;
    }
    return String(value);
}
function formatNumber(value) {
    return value.toLocaleString();
}
function errorCard(title, detail) {
    return `
    <div class="item-card">
      <strong>${escapeHtml(title)}</strong>
      <div class="status-danger">${escapeHtml(detail || "Unknown error")}</div>
    </div>
  `;
}
function toIso(value) {
    return value ? new Date(String(value)).toISOString() : null;
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
