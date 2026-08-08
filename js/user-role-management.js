import { escapeHtml, formatDate, setText, supabase } from "./supabase.js?v=20260808-no-downpayment-comment-v129";
import { hashPassword, validateStrongPassword } from "./auth-security.js";

const MODULES = [
  "Dashboard",
  "Inventory",
  "Payroll & Expenses",
  "Taxes & Revenue",
  "Project Monitoring",
  "Proposal / Quotation & Feedback",
  "Reports & Audit Logs",
  "User & Role Management"
];

const ROLE_LABELS = {
  system_admin: "System Administrator",
  owner_manager: "Owner/Manager",
  finance_officer: "Finance Officer/Accountant",
  project_manager: "Project Manager/Operations Staff",
  needs_review: "Needs Role Review"
};

const APPROVED_ROLE_LABELS = [
  ROLE_LABELS.system_admin,
  ROLE_LABELS.owner_manager,
  ROLE_LABELS.finance_officer,
  ROLE_LABELS.project_manager
];

const ASSIGNABLE_ROLE_LABELS = [
  ROLE_LABELS.owner_manager,
  ROLE_LABELS.finance_officer,
  ROLE_LABELS.project_manager
];

const ROLE_PERMISSIONS = {
  [ROLE_LABELS.system_admin]: [...MODULES],
  [ROLE_LABELS.owner_manager]: [
    "Dashboard",
    "Inventory",
    "Payroll & Expenses",
    "Taxes & Revenue",
    "Project Monitoring",
    "Proposal / Quotation & Feedback",
    "Reports & Audit Logs"
  ],
  [ROLE_LABELS.finance_officer]: [
    "Payroll & Expenses",
    "Taxes & Revenue",
    "Project Monitoring"
  ],
  [ROLE_LABELS.project_manager]: [
    "Project Monitoring"
  ],
  [ROLE_LABELS.needs_review]: []
};

const DEFAULT_ROLES = [
  {
    id: "role-system-admin",
    name: ROLE_LABELS.system_admin,
    permissions: ROLE_PERMISSIONS[ROLE_LABELS.system_admin]
  },
  {
    id: "role-owner-manager",
    name: ROLE_LABELS.owner_manager,
    permissions: ROLE_PERMISSIONS[ROLE_LABELS.owner_manager]
  },
  {
    id: "role-finance-officer",
    name: ROLE_LABELS.finance_officer,
    permissions: ROLE_PERMISSIONS[ROLE_LABELS.finance_officer]
  },
  {
    id: "role-project-manager",
    name: ROLE_LABELS.project_manager,
    permissions: ROLE_PERMISSIONS[ROLE_LABELS.project_manager]
  },
  {
    id: "role-needs-review",
    name: ROLE_LABELS.needs_review,
    permissions: ROLE_PERMISSIONS[ROLE_LABELS.needs_review]
  }
];

const DEFAULT_USERS = [
  {
    id: "user-owner",
    fullName: "System Owner",
    username: "owner",
    email: "owner@lemyu.local",
    password: "owner123",
    role: ROLE_LABELS.owner_manager,
    status: "Active",
    createdAt: new Date().toISOString()
  },
  {
    id: "user-maria",
    fullName: "Maria Leana Ruth Alvarado",
    username: "maria",
    email: "marialeanarutha@gmail.com",
    password: "July2026_eye",
    role: ROLE_LABELS.system_admin,
    status: "Active",
    createdAt: new Date().toISOString()
  },
  {
    id: "user-anael",
    fullName: "Anael",
    username: "anael",
    email: "anael081787@gmail.com",
    password: "July2026_eye",
    role: ROLE_LABELS.system_admin,
    status: "Active",
    createdAt: new Date().toISOString()
  },
  {
    id: "user-dimplesouthluzon2",
    fullName: "Dimplesouthluzon2",
    username: "dimplesouthluzon2",
    email: "dimplesouthluzon2@gmail.com",
    password: "July2026_eye",
    role: ROLE_LABELS.system_admin,
    status: "Active",
    createdAt: new Date().toISOString()
  }
];

let rolesCache = [];
let usersCache = [];
let userTableColumns = new Set();
let usingLocalRolesFallback = false;
let usingLocalUsersFallback = false;
const DELETED_DEFAULT_USERS_KEY = "lemyu_deleted_default_users";
const USER_STATUS_OVERRIDES_KEY = "lemyu_user_status_overrides";

function getErrorMessage(error) {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  if (error.details) return error.details;
  if (error.hint) return error.hint;

  try {
    const jsonMessage = JSON.stringify(error);
    if (jsonMessage && jsonMessage !== "{}") return jsonMessage;
  } catch {
    // Use the generic message below.
  }

  return "Supabase did not return error details.";
}

function parsePermissions(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }
}

function canonicalRoleLabel(roleValue = "") {
  const normalized = String(roleValue || "").trim().toLowerCase().replace(/\s*\/\s*/g, "/");

  if (["system_admin", "system administrator", "administrator", "admin"].includes(normalized)) {
    return ROLE_LABELS.system_admin;
  }

  if (["owner_manager", "owner/manager", "owner", "manager"].includes(normalized)) {
    return ROLE_LABELS.owner_manager;
  }

  if (["finance_officer", "finance officer/accountant", "finance officer / accountant", "finance", "accountant", "accounting"].includes(normalized)) {
    return ROLE_LABELS.finance_officer;
  }

  if (["project_manager", "project manager/operations staff", "project manager / operations staff", "operations", "operation", "operations staff"].includes(normalized)) {
    return ROLE_LABELS.project_manager;
  }

  if (["viewer", "staff", "needs_review", "needs role review"].includes(normalized)) {
    return ROLE_LABELS.needs_review;
  }

  return APPROVED_ROLE_LABELS.includes(roleValue) ? roleValue : ROLE_LABELS.needs_review;
}

function getRolePermissions(roleName = "") {
  return ROLE_PERMISSIONS[canonicalRoleLabel(roleName)] || [];
}

function isAssignableRole(roleName = "") {
  return ASSIGNABLE_ROLE_LABELS.includes(canonicalRoleLabel(roleName));
}

function normalizeRole(role) {
  const roleName = canonicalRoleLabel(role.name || role.role_name || role.role || "");
  return {
    id: role.id || `role-${roleName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: roleName,
    permissions: getRolePermissions(roleName).length
      ? getRolePermissions(roleName)
      : parsePermissions(role.permissions || role.allowed_modules || role.modules),
    source: role
  };
}

function createStableUserId(user) {
  const key = user.id || user.email || user.user_email || user.username || user.name || user.full_name || Date.now();
  return `user-${String(key).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function isActiveUser(user) {
  return String(user?.status || "Active").trim().toLowerCase() === "active";
}

function firstValue(...values) {
  return values.find(value => String(value || "").trim()) || "";
}

function normalizeUser(user) {
  const role = canonicalRoleLabel(firstValue(user.role, user.role_name, user.user_role));
  return {
    id: user.id || createStableUserId(user),
    fullName: firstValue(user.fullName, user.full_name, user.name, user.fullname, user.display_name, user.username, "User"),
    username: firstValue(user.username, user.user_name, user.name),
    email: firstValue(user.email, user.user_email, user.email_address, user.mail),
    password: firstValue(user.password_hash, user.user_password, user.password),
    role,
    status: role === ROLE_LABELS.needs_review ? "Inactive" : (user.status || user.account_status || "Active"),
    createdAt: user.createdAt || user.created_at || user.created || new Date().toISOString(),
    source: user
  };
}

function mergeLoginReadyUser(baseUser, savedUser = {}) {
  const hasSavedUser = savedUser && Object.keys(savedUser).length > 0;
  const normalizedSavedUser = hasSavedUser ? normalizeUser(savedUser) : {};

  return {
    ...baseUser,
    id: firstValue(normalizedSavedUser.id, baseUser.id),
    fullName: firstValue(normalizedSavedUser.fullName, baseUser.fullName),
    username: firstValue(normalizedSavedUser.username, baseUser.username),
    email: firstValue(normalizedSavedUser.email, baseUser.email),
    password: firstValue(normalizedSavedUser.password, baseUser.password),
    role: firstValue(normalizedSavedUser.role, baseUser.role),
    status: firstValue(normalizedSavedUser.status, baseUser.status, "Active"),
    createdAt: firstValue(normalizedSavedUser.createdAt, baseUser.createdAt),
    source: savedUser.source || savedUser || baseUser.source || baseUser
  };
}

function getLocalRoles() {
  const saved = JSON.parse(localStorage.getItem("lemyu_roles") || "null");
  const roles = Array.isArray(saved) && saved.length ? saved : DEFAULT_ROLES;
  return ensureDefaultRoles(roles.map(normalizeRole));
}

function saveLocalRoles(roles) {
  localStorage.setItem("lemyu_roles", JSON.stringify(roles));
}

function getLocalUsers() {
  const saved = JSON.parse(localStorage.getItem("lemyu_users") || "null");
  const users = Array.isArray(saved) && saved.length ? saved : DEFAULT_USERS;
  return ensureDefaultUsers(users.map(normalizeUser));
}

function saveLocalUsers(users) {
  localStorage.setItem("lemyu_users", JSON.stringify(users));
  syncActiveSessionUser(users);
}

function syncActiveSessionUser(users) {
  const sessionEmail = String(localStorage.getItem("lemyu_user_email") || "").toLowerCase();
  if (!sessionEmail) return;

  const currentUser = users.find(user => {
    return String(user.email || "").toLowerCase() === sessionEmail;
  });

  if (!currentUser) return;

  if (currentUser.fullName) {
    localStorage.setItem("lemyu_user_name", currentUser.fullName);
  }

  if (currentUser.role) {
    localStorage.setItem("lemyu_user_role", String(currentUser.role).toLowerCase());
    localStorage.setItem("lemyu_user_role_label", currentUser.role);
  }

  if (typeof window.refreshCurrentAccountCard === "function") {
    window.refreshCurrentAccountCard();
  }
}

function getDeletedDefaultUsers() {
  return JSON.parse(localStorage.getItem(DELETED_DEFAULT_USERS_KEY) || "[]");
}

function saveDeletedDefaultUsers(users) {
  localStorage.setItem(DELETED_DEFAULT_USERS_KEY, JSON.stringify(users));
}

function getUserStatusOverrides() {
  return JSON.parse(localStorage.getItem(USER_STATUS_OVERRIDES_KEY) || "{}");
}

function saveUserStatusOverrides(overrides) {
  localStorage.setItem(USER_STATUS_OVERRIDES_KEY, JSON.stringify(overrides));
}

function getUserKey(user) {
  return String(user.email || user.username || user.id || "").toLowerCase();
}

function isDefaultUser(user) {
  const userKey = getUserKey(user);
  return DEFAULT_USERS.some(defaultUser => getUserKey(defaultUser) === userKey);
}

function isDeletedDefaultUser(user) {
  const deletedUsers = getDeletedDefaultUsers();
  return deletedUsers.includes(getUserKey(user));
}

function rememberDeletedDefaultUser(user) {
  const deletedUsers = getDeletedDefaultUsers();
  const userKey = getUserKey(user);

  if (!deletedUsers.includes(userKey)) {
    saveDeletedDefaultUsers([...deletedUsers, userKey]);
  }
}

function applyUserStatusOverrides(users) {
  const overrides = getUserStatusOverrides();

  return users.map(user => {
    const overrideStatus = overrides[getUserKey(user)];
    return overrideStatus ? { ...user, status: overrideStatus } : user;
  });
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function hasUserAccount(users, targetUser) {
  const targetUsername = String(targetUser.username || "").toLowerCase();
  const targetEmail = String(targetUser.email || "").toLowerCase();

  return users.some(user => {
    const username = String(user.username || "").toLowerCase();
    const email = String(user.email || "").toLowerCase();

    return Boolean(targetEmail && email && email === targetEmail)
      || Boolean(targetUsername && username && username === targetUsername);
  });
}

function mergeUsers(primaryUsers, secondaryUsers) {
  return secondaryUsers.reduce((records, user) => {
    const userUsername = String(user.username || "").toLowerCase();
    const userEmail = String(user.email || "").toLowerCase();
    const existingIndex = records.findIndex(record => {
      const recordUsername = String(record.username || "").toLowerCase();
      const recordEmail = String(record.email || "").toLowerCase();

      return Boolean(userEmail && recordEmail && recordEmail === userEmail)
        || Boolean(userUsername && recordUsername && recordUsername === userUsername);
    });

    if (existingIndex < 0) {
      return [...records, user];
    }

    const existing = records[existingIndex];
    const merged = {
      ...user,
      ...existing,
      password: existing.password || user.password,
      status: existing.status || user.status || "Active",
      role: canonicalRoleLabel(existing.role || user.role || ROLE_LABELS.owner_manager),
      fullName: existing.fullName || user.fullName || existing.username || user.username || "User"
    };

    return records.map((record, index) => index === existingIndex ? merged : record);
  }, primaryUsers);
}

function hasRoleRecord(roles, targetRole) {
  return roles.some(role => {
    return canonicalRoleLabel(role.name) === canonicalRoleLabel(targetRole.name);
  });
}

function uniqueRoles(roles) {
  const seen = new Set();

  return roles.filter(role => {
    const key = canonicalRoleLabel(role.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureDefaultRoles(roles) {
  return uniqueRoles(DEFAULT_ROLES.reduce((records, defaultRole) => {
    return hasRoleRecord(records, defaultRole) ? records : [...records, defaultRole];
  }, roles));
}

function ensureDefaultUsers(users) {
  return DEFAULT_USERS.reduce((records, defaultUser) => {
    if (isDeletedDefaultUser(defaultUser)) return records;
    return hasUserAccount(records, defaultUser) ? records : [...records, defaultUser];
  }, users);
}

async function readSupabaseTable(tableName) {
  const result = await supabase.from(tableName).select("*");
  return result;
}

async function loadRoles() {
  const { data, error } = await readSupabaseTable("roles");

  if (error) {
    usingLocalRolesFallback = true;
    rolesCache = getLocalRoles();
    return rolesCache;
  }

  usingLocalRolesFallback = false;
  rolesCache = ensureDefaultRoles((data || []).map(normalizeRole).filter(role => role.name));

  const missingDefaultRoles = DEFAULT_ROLES.filter(role => !hasRoleRecord((data || []).map(normalizeRole), role));

  for (const role of missingDefaultRoles) {
    await insertRoleToSupabase(role).catch(() => null);
  }

  saveLocalRoles(rolesCache);
  return rolesCache;
}

async function loadUsers() {
  const { data, error } = await readSupabaseTable("users");

  if (error) {
    usingLocalUsersFallback = true;
    usersCache = getLocalUsers();
    return usersCache;
  }

  usingLocalUsersFallback = false;
  userTableColumns = new Set(Object.keys((data || [])[0] || {}));
  const supabaseUsers = (data || [])
    .map(normalizeUser)
    .filter(user => (user.username || user.email) && !isDeletedDefaultUser(user));
  const localUsers = getLocalUsers().filter(user => user.username || user.email);
  usersCache = applyUserStatusOverrides(mergeUsers(supabaseUsers, localUsers));

  const usersToSeed = DEFAULT_USERS.filter(user => {
    return !isDeletedDefaultUser(user) && !hasUserAccount(usersCache, user);
  });

  const localUsersToSync = localUsers.filter(user => {
    return !isDeletedDefaultUser(user) && !hasUserAccount(supabaseUsers, user);
  });

  for (const user of [...usersToSeed, ...localUsersToSync]) {
    const seededUser = {
      ...user,
      password: String(user.password || "").startsWith("sha256$")
        ? user.password
        : await hashPassword(user.password)
    };

    try {
      let savedUser;

      try {
        savedUser = await insertUserToSupabase(seededUser);
      } catch (error) {
        if (!isDuplicateUserError(error)) throw error;
        savedUser = await updateExistingUserInSupabase(seededUser);
      }

      const loginReadyUser = mergeLoginReadyUser(seededUser, savedUser);

      usersCache = usersCache.map(cachedUser => {
        return hasUserAccount([cachedUser], loginReadyUser) ? loginReadyUser : cachedUser;
      });
    } catch (error) {
      console.error("Unable to sync default user to Supabase:", error);
    }
  }

  saveLocalUsers(usersCache);
  return usersCache;
}

async function insertRoleToSupabase(role) {
  const attempts = [
    { name: role.name, permissions: role.permissions },
    { role_name: role.name, permissions: role.permissions },
    { name: role.name, allowed_modules: role.permissions },
    { role_name: role.name, allowed_modules: role.permissions }
  ];

  let lastError = null;

  for (const record of attempts) {
    const { data, error } = await supabase.from("roles").insert([record]).select("*").single();
    if (!error) return normalizeRole(data);
    lastError = error;
  }

  throw lastError;
}

function getMissingColumnName(error) {
  const message = String(error?.message || "");
  return message.match(/'([^']+)' column/)?.[1]
    || message.match(/column ["']?([A-Za-z0-9_]+)["']? does not exist/i)?.[1]
    || "";
}

function getFirstKnownColumn(columnNames) {
  return columnNames.find(column => userTableColumns.has(column)) || "";
}

function getKnownSchemaUserRecord({ fullName, username, email, password, role, status }) {
  if (!userTableColumns.size) return null;

  const emailColumn = getFirstKnownColumn(["email"]);
  const passwordColumn = getFirstKnownColumn(["password_hash", "user_password", "password"]);

  if (!emailColumn || !passwordColumn) return null;

  const record = {
    [emailColumn]: email,
    [passwordColumn]: password
  };
  const usernameColumn = getFirstKnownColumn(["username"]);
  const fullNameColumn = getFirstKnownColumn(["full_name", "name"]);
  const roleColumn = getFirstKnownColumn(["role", "role_name"]);
  const statusColumn = getFirstKnownColumn(["status", "account_status"]);

  if (usernameColumn && username) record[usernameColumn] = username;
  if (fullNameColumn) record[fullNameColumn] = fullName;
  if (roleColumn) record[roleColumn] = role;
  if (statusColumn) record[statusColumn] = status;

  return record;
}

function getUserRecordCandidates(user) {
  const fullName = user.fullName || user.full_name || user.name || "";
  const email = String(user.email || user.user_email || "").trim().toLowerCase();
  const password = user.password || user.password_hash || user.user_password || "";
  const role = user.role || user.role_name || "";
  const status = user.status || user.account_status || "Active";

  return ["password_hash", "user_password", "password"].map(passwordColumn => ({
      full_name: fullName,
      name: fullName,
      email,
      [passwordColumn]: password,
      role,
      status
    }));
}

function shouldTryNextUserRecordCandidate(missingColumn) {
  return [
    "email",
    "password",
    "password_hash",
    "user_password",
    "role",
    "role_name",
    "status",
    "account_status"
  ].includes(String(missingColumn || "").toLowerCase());
}

async function writeUserWithOptionalColumns(operation) {
  let lastError = null;

  for (const candidate of getUserRecordCandidates(operation.user)) {
    let record = { ...candidate };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { data, error } = await operation.write(record);

      if (!error) return data ? normalizeUser(data) : null;

      lastError = error;
      const missingColumn = getMissingColumnName(error);

      if (!missingColumn || !Object.prototype.hasOwnProperty.call(record, missingColumn)) {
        break;
      }

      if (["email", "password_hash", "user_password", "password"].includes(missingColumn)) {
        break;
      }

      record = { ...record };
      delete record[missingColumn];
    }
  }

  throw lastError;
}

async function insertUserToSupabase(user) {
  return writeUserWithOptionalColumns({
    user,
    write(record) {
      return supabase.from("users").insert([record]).select("*").single();
    }
  });
}

function isDuplicateUserError(error) {
  return error?.code === "23505"
    || /duplicate key value/i.test(error?.message || "")
    || /users_email_key|users_username_key/i.test(error?.message || "");
}

async function updateExistingUserInSupabase(user) {
  const filters = [
    ["email", user.email],
    ["username", user.username]
  ];
  let lastError = null;

  for (const [column, value] of filters) {
    if (!value) continue;

    try {
      const savedUser = await writeUserWithOptionalColumns({
        user,
        write(record) {
          return supabase
            .from("users")
            .update(record)
            .eq(column, value)
            .select("*")
            .maybeSingle();
        }
      });

      if (savedUser) {
        return savedUser;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("A user with this email already exists, but the existing account could not be updated.");
}

async function updateUserStatusInSupabase(userId, status) {
  const user = usersCache.find(item => item.id == userId);
  const source = user?.source || {};
  const statusColumn = Object.prototype.hasOwnProperty.call(source, "status")
    ? "status"
    : Object.prototype.hasOwnProperty.call(source, "account_status")
      ? "account_status"
      : "";

  if (!statusColumn) {
    throw new Error("The users table needs a status or account_status column before accounts can be activated/deactivated.");
  }

  const filters = [
    ["email", user?.email],
    ["username", user?.username]
  ];

  if (source.id && !String(source.id).startsWith("user-")) {
    filters.unshift(["id", source.id]);
  }

  let lastError = null;

  for (const [column, value] of filters) {
    if (!value || !Object.prototype.hasOwnProperty.call(source, column)) continue;

    const { error } = await supabase
      .from("users")
      .update({ [statusColumn]: status })
      .eq(column, value);
    if (!error) return;
    lastError = error;
  }

  throw lastError || new Error("Unable to match user in Supabase.");
}

async function deleteUserFromSupabase(user) {
  const source = user.source || {};
  const filters = [
    ["email", user.email],
    ["username", user.username]
  ];

  if (source.id && !String(source.id).startsWith("user-")) {
    filters.unshift(["id", source.id]);
  }

  let lastError = null;

  for (const [column, value] of filters) {
    if (!value || !Object.prototype.hasOwnProperty.call(source, column)) continue;
    const { error } = await supabase.from("users").delete().eq(column, value);
    if (!error) return;
    lastError = error;
  }

  throw lastError || new Error("Unable to match user in Supabase.");
}

async function deleteRoleFromSupabase(role) {
  const attempts = [
    ["id", role.id],
    ["name", role.name],
    ["role_name", role.name],
    ["role", role.name]
  ];

  let lastError = null;

  for (const [column, value] of attempts) {
    if (!value) continue;
    const { error } = await supabase.from("roles").delete().eq(column, value);
    if (!error) return;
    lastError = error;
  }

  throw lastError || new Error("Unable to match role in Supabase.");
}

function renderPermissionOptions() {
  const grid = document.getElementById("permissionGrid");
  if (!grid) return;

  grid.innerHTML = MODULES.map(moduleName => `
    <label class="permission-option">
      <input type="checkbox" value="${escapeHtml(moduleName)}" checked>
      <span>${escapeHtml(moduleName)}</span>
    </label>
  `).join("");
}

function renderRoleSelect(roles = rolesCache) {
  user_role.innerHTML = roles
    .filter(role => ASSIGNABLE_ROLE_LABELS.includes(canonicalRoleLabel(role.name)))
    .map(role => `<option value="${escapeHtml(role.name)}">${escapeHtml(role.name)}</option>`)
    .join("");
}

function getDisplayUsername(user) {
  const username = String(user.username || "").trim();
  if (username) return username;

  const emailName = String(user.email || "").split("@")[0].trim();
  return emailName || "-";
}

function renderUsers() {
  const users = usersCache;
  const roles = rolesCache;

  setText("totalUsers", users.length);
  setText("activeUsers", users.filter(isActiveUser).length);
  setText("roleCount", APPROVED_ROLE_LABELS.length);
  setText("adminUsers", users.filter(user => canonicalRoleLabel(user.role) === ROLE_LABELS.system_admin).length);

  userTable.innerHTML = users.length ? users.map(user => `
    <tr>
      <td>${escapeHtml(user.fullName)}</td>
      <td>${escapeHtml(getDisplayUsername(user))}</td>
      <td>${escapeHtml(user.email || "-")}</td>
      <td>${escapeHtml(canonicalRoleLabel(user.role))}</td>
      <td><span class="badge ${isActiveUser(user) ? "Paid" : "Pending"}">${escapeHtml(user.status)}</span></td>
      <td>${formatDate(user.createdAt)}</td>
      <td class="action-links">
        <a href="#" onclick="toggleUserStatus('${escapeHtml(user.id)}'); return false;">${isActiveUser(user) ? "Deactivate" : "Activate"}</a>
        <a href="#" onclick="deleteUser('${escapeHtml(user.id)}'); return false;">Delete</a>
      </td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="7" style="text-align:center;">No user records yet.</td>
    </tr>
  `;
}

function renderRoles() {
  const roles = rolesCache;

  if (typeof roleTable !== "undefined" && roleTable) {
    roleTable.innerHTML = roles.map(role => `
      <tr>
        <td>${escapeHtml(role.name)}</td>
        <td>${role.permissions.map(permission => `<span class="permission-pill">${escapeHtml(permission)}</span>`).join("")}</td>
        <td class="action-links">
          <a href="#" onclick="deleteRole('${role.id}')">Delete</a>
        </td>
      </tr>
    `).join("");
  }

  renderRoleSelect(roles);
  renderUsers();
}

userForm.addEventListener("submit", async event => {
  event.preventDefault();

  const users = usersCache;
  const emailValue = user_email.value.trim().toLowerCase();
  const selectedRole = canonicalRoleLabel(user_role.value);

  if (!isValidEmail(emailValue)) {
    alert("Please enter a valid email address.");
    user_email.focus();
    return;
  }

  if (!isAssignableRole(selectedRole)) {
    alert("Please select a valid FinSight user role.");
    user_role.focus();
    return;
  }

  const existingUser = users.find(user => {
    return String(user.email || "").toLowerCase() === emailValue;
  });

  if (existingUser && canonicalRoleLabel(existingUser.role) === ROLE_LABELS.system_admin) {
    alert("System Administrator accounts cannot be changed through the business-user role form.");
    return;
  }

  const passwordCheck = validateStrongPassword(user_password.value, "", emailValue);

  if (!passwordCheck.valid) {
    alert("Weak password blocked:\n- " + passwordCheck.issues.join("\n- "));
    return;
  }

  const userRecord = {
    id: createId("user"),
    fullName: full_name.value.trim(),
    username: "",
    email: emailValue,
    password: await hashPassword(user_password.value),
    role: selectedRole,
    status: user_status.value,
    createdAt: new Date().toISOString()
  };

  if (existingUser) {
    let repairedUser = {
      ...existingUser,
      fullName: userRecord.fullName || existingUser.fullName,
      username: userRecord.username || existingUser.username,
      email: userRecord.email || existingUser.email,
      password: userRecord.password,
      role: userRecord.role || existingUser.role,
      status: userRecord.status || "Active"
    };

    if (!usingLocalUsersFallback) {
      try {
        const savedUser = await updateExistingUserInSupabase(repairedUser);
        repairedUser = mergeLoginReadyUser(repairedUser, savedUser);
      } catch (error) {
        alert("Unable to sync updated user to Supabase: " + getErrorMessage(error));
        return;
      }
    }

    usersCache = usersCache.map(user => {
      return user.id == existingUser.id ? repairedUser : user;
    });

    const overrides = getUserStatusOverrides();
    overrides[getUserKey(repairedUser)] = repairedUser.status;
    saveUserStatusOverrides(overrides);
    saveLocalUsers(usersCache);
    userForm.reset();
    renderUsers();
    alert("Existing user account updated and activated successfully.");
    return;
  }

  try {
    if (usingLocalUsersFallback) {
      throw new Error("Cannot save user because Supabase users table is not reachable.");
    }

    let savedUser;

    try {
      savedUser = await insertUserToSupabase(userRecord);
    } catch (error) {
      if (!isDuplicateUserError(error)) throw error;
      savedUser = await updateExistingUserInSupabase(userRecord);
    }

    const loginReadyUser = mergeLoginReadyUser(userRecord, savedUser);

    const existingIndex = usersCache.findIndex(user => hasUserAccount([user], loginReadyUser));
    usersCache = existingIndex >= 0
      ? usersCache.map((user, index) => index === existingIndex ? loginReadyUser : user)
      : [loginReadyUser, ...usersCache];
    saveLocalUsers(usersCache);
    renderUsers();
    await loadUsers();
  } catch (error) {
    alert("Unable to save user to Supabase: " + getErrorMessage(error));
    return;
  }

  userForm.reset();
  renderUsers();
});

const roleFormElement = document.getElementById("roleForm");

roleFormElement?.addEventListener("submit", async event => {
  event.preventDefault();

  const roles = rolesCache;
  const roleName = document.getElementById("role_name")?.value.trim() || "";
  const permissions = [...(document.getElementById("permissionGrid")?.querySelectorAll("input:checked") || [])].map(input => input.value);

  if (roles.some(role => role.name.toLowerCase() === roleName.toLowerCase())) {
    alert("Role already exists.");
    return;
  }

  if (!permissions.length) {
    alert("Select at least one module permission.");
    return;
  }

  const roleRecord = {
    id: createId("role"),
    name: roleName,
    permissions
  };

  try {
    if (usingLocalRolesFallback) {
      throw new Error("Cannot save role because Supabase roles table is not reachable.");
    }

    const savedRole = await insertRoleToSupabase(roleRecord);

    rolesCache = [savedRole, ...rolesCache];
    saveLocalRoles(rolesCache);
  } catch (error) {
    alert("Unable to save role to Supabase: " + getErrorMessage(error));
    return;
  }

  roleFormElement.reset();
  renderPermissionOptions();
  renderRoles();
});

window.toggleUserStatus = async function(userId) {
  const currentUser = usersCache.find(user => user.id == userId);
  if (!currentUser) {
    alert("User record was not found. Please refresh the page and try again.");
    return;
  }

  const nextStatus = isActiveUser(currentUser) ? "Inactive" : "Active";

  if (canonicalRoleLabel(currentUser.role) === ROLE_LABELS.system_admin && nextStatus === "Inactive") {
    const activeAdmins = usersCache.filter(user => {
      return canonicalRoleLabel(user.role) === ROLE_LABELS.system_admin && isActiveUser(user);
    });

    if (activeAdmins.length <= 1) {
      alert("The last active System Administrator cannot be deactivated.");
      return;
    }
  }

  if (!usingLocalUsersFallback) {
    try {
      await updateUserStatusInSupabase(userId, nextStatus);
    } catch (error) {
      console.error("Unable to update user status in Supabase:", error);
    }
  }

  const users = usersCache.map(user => {
    if (user.id != userId) return user;
    return {
      ...user,
      status: nextStatus
    };
  });

  usersCache = users;
  const overrides = getUserStatusOverrides();
  overrides[getUserKey(currentUser)] = nextStatus;
  saveUserStatusOverrides(overrides);
  saveLocalUsers(usersCache);
  renderUsers();
};

window.deleteUser = async function(userId) {
  const user = usersCache.find(item => item.id == userId);
  if (!user) {
    alert("User record was not found. Please refresh the page and try again.");
    return;
  }

  if (!confirm("Delete this user account?")) return;

  if (canonicalRoleLabel(user.role) === ROLE_LABELS.system_admin) {
    const activeAdmins = usersCache.filter(item => {
      return canonicalRoleLabel(item.role) === ROLE_LABELS.system_admin && isActiveUser(item);
    });

    if (activeAdmins.length <= 1) {
      alert("The last active System Administrator cannot be deleted.");
      return;
    }
  }

  if (!usingLocalUsersFallback) {
    try {
      await deleteUserFromSupabase(user);
    } catch (error) {
      console.error("Unable to delete user from Supabase:", error);
    }
  }

  rememberDeletedDefaultUser(user);
  usersCache = usersCache.filter(user => user.id != userId);
  saveLocalUsers(usersCache);
  renderUsers();
};

window.deleteRole = async function(roleId) {
  const roles = rolesCache;
  const role = roles.find(item => item.id == roleId);

  if (!role) return;

  if (APPROVED_ROLE_LABELS.includes(canonicalRoleLabel(role.name))) {
    alert("Approved FinSight roles cannot be deleted.");
    return;
  }

  if (!confirm("Delete this role? Existing users will keep their role label until reassigned.")) return;

  if (usingLocalRolesFallback) {
    alert("Cannot delete role because Supabase roles table is not reachable.");
    return;
  }

  try {
    await deleteRoleFromSupabase(role);
  } catch (error) {
    alert("Unable to delete role from Supabase: " + getErrorMessage(error));
    return;
  }

  rolesCache = roles.filter(item => item.id != roleId);
  saveLocalRoles(rolesCache);
  renderRoles();
};

renderPermissionOptions();
await loadRoles();
await loadUsers();
renderRoles();
