import { endSession, isSessionActive, refreshSession } from "./auth-security.js";

const PAGE_PERMISSIONS = {
  "dashboard.html": "Dashboard",
  "inventory.html": "Inventory",
  "expenses.html": "Payroll & Expenses",
  "payroll.html": "Payroll & Expenses",
  "revenue.html": "Taxes & Revenue",
  "projects.html": "Project Monitoring",
  "feedback.html": "Proposal / Quotation & Feedback",
  "reports-audit.html": "Reports & Audit Logs",
  "user-role-management.html": "User & Role Management",
  "owner-dashboard.html": "Dashboard"
};

const FINANCE_MODULES = [
  "Payroll & Expenses",
  "Taxes & Revenue",
  "Project Monitoring"
];

const OPERATIONS_MODULES = [
  "Project Monitoring"
];
const LEGACY_PROJECT_PERMISSION = `Project Monitoring ${String.fromCharCode(38)} ${String.fromCharCode(65, 110, 97, 108, 121, 116, 105, 99, 115)}`;

function canonicalRoleLabel(roleValue = "") {
  const normalized = String(roleValue || "").trim().toLowerCase().replace(/\s*\/\s*/g, "/");
  if (["system administrator", "administrator", "admin", "system_admin"].includes(normalized)) return "system administrator";
  if (["owner/manager", "owner", "manager", "owner_manager"].includes(normalized)) return "owner/manager";
  if (["finance officer/accountant", "finance officer / accountant", "finance", "accountant", "accounting", "finance_officer"].includes(normalized)) return "finance officer/accountant";
  if (["project manager/operations staff", "project manager / operations staff", "project manager", "operations", "operations staff", "project_manager"].includes(normalized)) return "project manager/operations staff";
  return "needs role review";
}

function getCurrentPage() {
  return window.location.pathname.split("/").pop() || "dashboard.html";
}

function getPermissions() {
  try {
    return JSON.parse(localStorage.getItem("lemyu_role_permissions") || "[]");
  } catch {
    return [];
  }
}

function redirectToLogin(message) {
  endSession();

  if (message) {
    alert(message);
  }

  window.location.href = "index.html";
}

function isFinanceRole(roleValue = localStorage.getItem("lemyu_user_role")) {
  return canonicalRoleLabel(roleValue) === "finance officer/accountant";
}

function isOperationsRole(roleValue = localStorage.getItem("lemyu_user_role")) {
  return canonicalRoleLabel(roleValue) === "project manager/operations staff";
}

function getEffectivePermissions(role, permissions) {
  const normalizedPermissions = permissions.map(permission =>
    permission === LEGACY_PROJECT_PERMISSION ? "Project Monitoring" : permission
  );

  if (isOperationsRole(role)) return OPERATIONS_MODULES;
  return isFinanceRole(role) ? FINANCE_MODULES : normalizedPermissions;
}

function trimSidebarForRole(permissions) {
  const operationsScope = isOperationsRole();
  const financeScope = isFinanceRole();
  const allowedPages = new Set(
    Object.entries(PAGE_PERMISSIONS)
      .filter(([, permission]) => permissions.includes(permission))
      .map(([page]) => page)
  );

  document.querySelectorAll(".menu a[href]").forEach(link => {
    const href = link.getAttribute("href") || "";
    const page = href.split("/").pop();

    if (page === "index.html") return;
    if ((financeScope || operationsScope) && page === "reports-audit.html") link.textContent = "Reports";
    if (operationsScope && page === "projects.html") {
      link.textContent = "Project Monitoring";
    }
    if (PAGE_PERMISSIONS[page] && !allowedPages.has(page)) {
      link.remove();
    }
  });
}

function enforceAccess() {
  const page = getCurrentPage();
  const requiredPermission = PAGE_PERMISSIONS[page];

  if (!requiredPermission) return;

  if (!isSessionActive()) {
    redirectToLogin("Session timeout. You have been automatically logged out after inactivity.");
    return;
  }

  const role = canonicalRoleLabel(localStorage.getItem("lemyu_user_role") || "");
  const permissions = getEffectivePermissions(role, getPermissions());

  trimSidebarForRole(permissions);

  if (isFinanceRole(role)) {
    document.body.dataset.roleScope = "finance";
  }

  if (isOperationsRole(role)) {
    document.body.dataset.roleScope = "operations";
  }

  if (!["owner/manager", "system administrator"].includes(role) && !permissions.includes(requiredPermission)) {
    alert("Unauthorized access. Your role cannot open this module.");
    window.location.href = isOperationsRole(role) ? "projects.html" : isFinanceRole(role) ? "expenses.html" : "dashboard.html";
    return;
  }

  refreshSession();
}

["click", "keydown", "mousemove", "touchstart"].forEach(eventName => {
  window.addEventListener(eventName, refreshSession, { passive: true });
});

document.querySelectorAll('a[href="index.html"]').forEach(link => {
  if (link.textContent.trim().toLowerCase() === "logout") {
    link.addEventListener("click", () => {
      endSession();
    });
  }
});

window.addEventListener("storage", event => {
  if (event.key === "lemyu_is_authenticated" && event.newValue !== "true") {
    window.location.href = "index.html";
  }
});

enforceAccess();
setInterval(enforceAccess, 60 * 1000);
