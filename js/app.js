const pageModules = {
  "index.html": "./login.js",

  "dashboard.html": "./dashboard-page.js",
  "expenses.html": "./expenses-page.js",
  "inventory.html": "./inventory-page.js",
  "owner-dashboard.html": "./owner-dashboard.js",
  "payroll.html": "./payroll-page.js",
  "projects.html": "./project.js",
  "feedback.html": "./feedback-module.js",
  "reports-audit.html": "./reports-audit.js",
  "revenue.html": "./revenue-page.js",
  "user-role-management.html": "./user-role-management.js",

  "public-feedback.html": "./public-feedback-page.js"
};

const publicPages = new Set(["index.html", "public-feedback.html"]);
const pageName = window.location.pathname.split("/").pop() || "index.html";
const pageModule = pageModules[pageName];
const appVersion = "20260808-remove-billing-action-v118";
const approvedRoleLabels = new Set([
  "System Administrator",
  "Owner/Manager",
  "Finance Officer/Accountant",
  "Project Manager/Operations Staff",
  "Needs Role Review"
]);

function toTitleCase(value = "") {
  return String(value || "User")
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function getSavedUsers() {
  try {
    return JSON.parse(localStorage.getItem("lemyu_users") || "[]");
  } catch {
    return [];
  }
}

function syncCurrentAccountFromSavedUsers() {
  const sessionEmail = String(localStorage.getItem("lemyu_user_email") || "").toLowerCase();
  if (!sessionEmail) return;

  const currentUser = getSavedUsers().find(user => {
    return String(user.email || user.user_email || "").toLowerCase() === sessionEmail;
  });

  if (!currentUser) return;

  const fullName = currentUser.fullName || currentUser.full_name || currentUser.name;
  const role = currentUser.role || currentUser.role_name;

  if (fullName) {
    localStorage.setItem("lemyu_user_name", fullName);
  }

  if (role) {
    localStorage.setItem("lemyu_user_role", String(role).toLowerCase());
    localStorage.setItem("lemyu_user_role_label", role);
  }
}

function getCurrentAccount() {
  syncCurrentAccountFromSavedUsers();

  const accountName = localStorage.getItem("lemyu_user_name")
    || localStorage.getItem("lemyu_username")
    || localStorage.getItem("lemyu_user_email")
    || "User";
  const role = localStorage.getItem("lemyu_user_role_label")
    || localStorage.getItem("lemyu_user_role")
    || "User";

  return {
    username: toTitleCase(accountName),
    role: approvedRoleLabels.has(role) ? role : toTitleCase(role)
  };
}

function createAccountCard() {
  const card = document.createElement("div");
  card.className = "signed-user";
  card.setAttribute("aria-label", "Current user");
  card.innerHTML = `
    <small>Current Account</small>
    <div class="signed-user-row">
      <span>Account User</span>
      <strong id="dashboardUsername">User</strong>
    </div>
    <div class="signed-user-row">
      <span>Role</span>
      <strong id="dashboardRole">User</strong>
    </div>
  `;
  return card;
}

function renderCurrentAccountCard() {
  if (publicPages.has(pageName)) return;

  const hero = document.querySelector(".hero");
  if (!hero) return;

  let card = hero.querySelector(".signed-user");

  if (!card) {
    const existingChildren = [...hero.childNodes];
    const content = document.createElement("div");
    existingChildren.forEach(child => content.appendChild(child));

    const wrapper = document.createElement("div");
    wrapper.className = "dashboard-hero-head";
    wrapper.appendChild(content);
    wrapper.appendChild(createAccountCard());

    hero.appendChild(wrapper);
    card = wrapper.querySelector(".signed-user");
  }

  const account = getCurrentAccount();
  const usernameTarget = card.querySelector("#dashboardUsername");
  const roleTarget = card.querySelector("#dashboardRole");

  if (usernameTarget) usernameTarget.textContent = account.username;
  if (roleTarget) roleTarget.textContent = account.role;
}

function setCloudStatus(message, isError = false) {
  const statusBox = document.querySelector(".update-box");
  if (!statusBox) return;

  const text = statusBox.querySelector("p");
  if (text) {
    text.textContent = message;
    text.style.color = isError ? "#b42318" : "";
  }
}

let cloudReadyPromise = Promise.resolve();

if (!publicPages.has(pageName)) {
  await import(`./auth-guard.js?v=${appVersion}`);
  const cloudLocalStorage = await import(`./cloud-local-storage.js?v=${appVersion}`);
  const cloudSync = await import(`./cloud-sync.js?v=${appVersion}`);
  cloudLocalStorage.installCloudLocalStorageMirror();
  renderCurrentAccountCard();

  window.lemyuRestoreAndSync = async function() {
    setCloudStatus("Live updates are refreshing...");
    await cloudLocalStorage.hydrateLocalStorageFromSupabase();
    await cloudLocalStorage.restoreLocalBusinessDataFromSupabase();
    syncCurrentAccountFromSavedUsers();
    await cloudLocalStorage.syncExistingLocalStorageToSupabase();
    const syncSummary = await cloudSync.forceLocalDataSyncToSupabase();
    await cloudLocalStorage.restoreLocalBusinessDataFromSupabase();
    renderCurrentAccountCard();
    const report = await cloudLocalStorage.getCloudRecoveryReport();
    report.sync = syncSummary;
    if (syncSummary?.errors?.length) {
      report.errors.push(...syncSummary.errors.map(error => `${error.label}: ${error.message}`));
    }
    window.lemyuLastRecoveryReport = report;
    window.dispatchEvent(new CustomEvent("lemyu:data-sync-complete", { detail: report }));
    setCloudStatus(report.errors.length ? "Live updates need Supabase setup." : "Live updates active.");
    return report;
  };

  window.refreshCurrentAccountCard = renderCurrentAccountCard;

  setCloudStatus("Live updates connecting...");
  cloudReadyPromise = window.lemyuRestoreAndSync().catch(error => {
    console.warn("Automatic cloud sync did not finish:", error.message || error);
    setCloudStatus("Live updates need Supabase setup.", true);
  });
}

if (pageModule) {
  await import(`${pageModule}?v=${appVersion}`);
  cloudReadyPromise.then(() => {
    if (!window.lemyuLastRecoveryReport) return;
    window.dispatchEvent(new CustomEvent("lemyu:data-sync-complete", {
      detail: window.lemyuLastRecoveryReport
    }));
  });
}
