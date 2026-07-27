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
  "Dashboard",
  "Payroll & Expenses",
  "Taxes & Revenue",
  "Project Monitoring"
];

const FINANCE_ROLE_PATTERN = /(finance|accountant|accounting)/i;
const OPERATIONS_MODULES = [
  "Payroll & Expenses",
  "Project Monitoring",
  "Reports & Audit Logs"
];
const OPERATIONS_ROLE_PATTERN = /(project\s*manager|operations?\s*staff|operations?)/i;
const LEGACY_PROJECT_PERMISSION = `Project Monitoring ${String.fromCharCode(38)} ${String.fromCharCode(65, 110, 97, 108, 121, 116, 105, 99, 115)}`;

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
  return FINANCE_ROLE_PATTERN.test(String(roleValue || ""));
}

function isOperationsRole(roleValue = localStorage.getItem("lemyu_user_role")) {
  return OPERATIONS_ROLE_PATTERN.test(String(roleValue || ""));
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
    if (financeScope && page === "reports-audit.html") {
      link.remove();
      return;
    }
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

  const role = String(localStorage.getItem("lemyu_user_role") || "").toLowerCase();
  const permissions = getEffectivePermissions(role, getPermissions());

  trimSidebarForRole(permissions);

  if (isFinanceRole(role)) {
    document.body.dataset.roleScope = "finance";
  }

  if (isOperationsRole(role)) {
    document.body.dataset.roleScope = "operations";
  }

  if (!["owner", "administrator", "admin"].includes(role) && !permissions.includes(requiredPermission)) {
    alert("Unauthorized access. Your role cannot open this module.");
    window.location.href = isOperationsRole(role) ? "projects.html" : "dashboard.html";
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
