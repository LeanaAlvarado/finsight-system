

import { supabase } from "./supabase.js?v=20260809-cctv-action-end-v142";
import {
  clearLoginLockout,
  getLockout,
  getLockoutMinutesRemaining,
  getRemainingLoginAttempts,
  hashPassword,
  recordFailedLogin,
  startSession,
  validateStrongPassword,
  verifyPassword
} from "./auth-security.js";

const loginForm = document.getElementById("loginForm");
const loginView = document.getElementById("loginView");
const otpView = document.getElementById("otpView");
const resetPasswordView = document.getElementById("resetPasswordView");
const otpMessage = document.getElementById("otpMessage");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const passwordToggle = document.getElementById("passwordToggle");
const passwordEyeIcon = document.getElementById("passwordEyeIcon");
const otpInput = document.getElementById("otp");
const resetPasswordForm = document.getElementById("resetPasswordForm");
const resetEmailInput = document.getElementById("resetEmail");
const resetPasswordInput = document.getElementById("resetPassword");
const resetConfirmPasswordInput = document.getElementById("resetConfirmPassword");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const resendOtpBtn = document.getElementById("resendOtpBtn");
const backToLoginBtn = document.getElementById("backToLoginBtn");
const sendOtpBtn = document.getElementById("sendOtpBtn");
const resetPasswordBtn = document.getElementById("resetPasswordBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const backToLoginFromResetBtn = document.getElementById("backToLoginFromResetBtn");

function setPasswordVisibility(isVisible) {
  passwordInput.type = isVisible ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(isVisible));
  passwordToggle.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
  passwordToggle.title = isVisible ? "Hide password" : "Show password";
  passwordEyeIcon.innerHTML = isVisible
    ? `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle>`
    : `<path d="m3 3 18 18"></path><path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-2.1 3.1"></path><path d="M6.6 6.6C3.6 8.6 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.1-.9"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>`;
}

passwordToggle.addEventListener("click", () => {
  setPasswordVisibility(passwordInput.type === "password");
  passwordInput.focus();
});

const OWNER_PERMISSIONS = [
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
  systemAdmin: "System Administrator",
  ownerManager: "Owner/Manager",
  financeOfficer: "Finance Officer/Accountant",
  projectManager: "Project Manager/Operations Staff",
  needsReview: "Needs Role Review"
};

const FINANCE_PERMISSIONS = [
  "Payroll & Expenses",
  "Taxes & Revenue",
  "Project Monitoring",
  "Reports & Audit Logs"
];

const OPERATIONS_PERMISSIONS = [
  "Project Monitoring",
  "Reports & Audit Logs"
];

function canonicalRoleLabel(roleName = "") {
  const normalized = String(roleName || "").trim().toLowerCase().replace(/\s*\/\s*/g, "/");
  if (["system administrator", "administrator", "admin", "system_admin"].includes(normalized)) return ROLE_LABELS.systemAdmin;
  if (["owner/manager", "owner", "manager", "owner_manager"].includes(normalized)) return ROLE_LABELS.ownerManager;
  if (["finance officer/accountant", "finance officer / accountant", "finance", "accountant", "accounting", "finance_officer"].includes(normalized)) return ROLE_LABELS.financeOfficer;
  if (["project manager/operations staff", "project manager / operations staff", "project manager", "operations", "operations staff", "project_manager"].includes(normalized)) return ROLE_LABELS.projectManager;
  return ROLE_LABELS.needsReview;
}

function isFinanceRole(roleName = "") {
  return canonicalRoleLabel(roleName) === ROLE_LABELS.financeOfficer;
}

function isOperationsRole(roleName = "") {
  return canonicalRoleLabel(roleName) === ROLE_LABELS.projectManager;
}

const FALLBACK_ACCOUNTS = [
  {
    username: "owner",
    email: "owner@lemyu.local",
    password: "owner123",
    role: ROLE_LABELS.ownerManager,
    status: "Active",
    fullName: "System Owner"
  },
  {
    username: "maria",
    email: "marialeanarutha@gmail.com",
    password: "July2026_eye",
    role: ROLE_LABELS.systemAdmin,
    status: "Active",
    fullName: "Maria Leana Ruth Alvarado"
  },
  {
    username: "anael",
    email: "anael081787@gmail.com",
    password: "July2026_eye",
    role: ROLE_LABELS.systemAdmin,
    status: "Active",
    fullName: "Anael"
  },
  {
    username: "dimplesouthluzon2",
    email: "dimplesouthluzon2@gmail.com",
    password: "July2026_eye",
    role: ROLE_LABELS.systemAdmin,
    status: "Active",
    fullName: "Dimplesouthluzon2"
  }
];

let pendingEmail = "";
let pendingPasswordReset = null;
const DELETED_DEFAULT_USERS_KEY = "lemyu_deleted_default_users";

function getDeletedDefaultUsers() {
  return JSON.parse(localStorage.getItem(DELETED_DEFAULT_USERS_KEY) || "[]");
}

function getUserKey(user) {
  return String(user.email || user.username || user.id || "").toLowerCase();
}

function getErrorMessage(error) {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  if (error.error_description) return error.error_description;
  if (error.error) return error.error;

  try {
    const jsonMessage = JSON.stringify(error);
    if (jsonMessage && jsonMessage !== "{}") return jsonMessage;
  } catch {
    // Fall through to the generic message below.
  }

  return "Supabase did not return error details. Please check SMTP settings, email rate limit, and the browser Console.";
}

function showLoginView() {
  otpView.classList.add("is-hidden");
  resetPasswordView.classList.add("is-hidden");
  loginView.classList.remove("is-hidden");
  pendingPasswordReset = null;
  otpInput.value = "";
  passwordInput.focus();
}

function showOtpView(email, mode = "login") {
  loginView.classList.add("is-hidden");
  resetPasswordView.classList.add("is-hidden");
  otpView.classList.remove("is-hidden");
  otpMessage.textContent = mode === "reset"
    ? `We sent a password reset OTP number to ${email}. Please enter it below.`
    : `We sent an 8-digit OTP number to ${email}. Please enter it below.`;
  otpInput.value = "";
  otpInput.focus();
}

function showResetPasswordView() {
  loginView.classList.add("is-hidden");
  otpView.classList.add("is-hidden");
  resetPasswordView.classList.remove("is-hidden");
  resetEmailInput.value = emailInput.value.trim().toLowerCase();
  resetPasswordInput.value = "";
  resetConfirmPasswordInput.value = "";
  resetEmailInput.focus();
}

function normalizeUser(user) {
  const role = canonicalRoleLabel(user.role || user.role_name || ROLE_LABELS.ownerManager);
  return {
    username: user.username || "",
    email: user.email || user.user_email || "",
    password: user.password_hash || user.password || user.user_password || "",
    role,
    status: user.status || user.account_status || "Active",
    fullName: user.fullName || user.full_name || user.name || user.username || "User"
  };
}

function isActiveUser(user) {
  return String(user?.status || "Active").trim().toLowerCase() === "active";
}

function ensureFallbackAccounts(users) {
  return FALLBACK_ACCOUNTS.reduce((accounts, fallbackAccount) => {
    const hasAccount = accounts.some(user => {
      return String(user.username || "").toLowerCase() === fallbackAccount.username
        || String(user.email || "").toLowerCase() === fallbackAccount.email;
    });

    return hasAccount ? accounts : [...accounts, fallbackAccount];
  }, users);
}

function hasUserAccount(users, targetUser) {
  return users.some(user => {
    return String(user.username || "").toLowerCase() === String(targetUser.username || "").toLowerCase()
      || String(user.email || "").toLowerCase() === String(targetUser.email || "").toLowerCase();
  });
}

function mergeUsers(primaryUsers, secondaryUsers) {
  return secondaryUsers.reduce((records, user) => {
    const existingIndex = records.findIndex(record => {
      return String(record.username || "").toLowerCase() === String(user.username || "").toLowerCase()
        || String(record.email || "").toLowerCase() === String(user.email || "").toLowerCase();
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
      role: canonicalRoleLabel(existing.role || user.role || ROLE_LABELS.ownerManager),
      fullName: existing.fullName || user.fullName || existing.username || user.username || "User"
    };

    return records.map((record, index) => index === existingIndex ? merged : record);
  }, primaryUsers);
}

function getLocalUsers() {
  const users = JSON.parse(localStorage.getItem("lemyu_users") || "[]");
  return ensureFallbackAccounts(users.length ? users.map(normalizeUser) : []);
}

function getFallbackAccount(email) {
  return FALLBACK_ACCOUNTS.find(account => {
    return String(account.email || "").toLowerCase() === String(email || "").toLowerCase();
  });
}

async function getUsers() {
  const { data, error } = await supabase.from("users").select("*");

  if (!error && Array.isArray(data) && data.length) {
    const supabaseUsers = data.map(normalizeUser);
    const localUsers = getLocalUsers();
    const users = ensureFallbackAccounts(mergeUsers(supabaseUsers, localUsers));
    localStorage.setItem("lemyu_users", JSON.stringify(users));
    return users;
  }

  return getLocalUsers();
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

function normalizeRole(role) {
  const roleName = canonicalRoleLabel(role.name || role.role_name || role.role || "");
  return {
    name: roleName,
    permissions: parsePermissions(role.permissions || role.allowed_modules || role.modules)
  };
}

async function getRoles() {
  const { data, error } = await supabase.from("roles").select("*");

  if (!error && Array.isArray(data) && data.length) {
    const roles = data.map(normalizeRole);
    localStorage.setItem("lemyu_roles", JSON.stringify(roles));
    return roles;
  }

  return JSON.parse(localStorage.getItem("lemyu_roles") || "[]").map(normalizeRole);
}

async function findAppUser(email) {
  const normalizedEmail = String(email || "").toLowerCase();

  const users = await getUsers();
  const savedUser = users.find(user => String(user.email || "").toLowerCase() === normalizedEmail);

  if (savedUser?.password) {
    return savedUser;
  }

  const localUser = getLocalUsers().find(user => {
    return String(user.email || "").toLowerCase() === normalizedEmail;
  });

  if (localUser?.password) {
    return localUser;
  }

  const fallbackAccount = getFallbackAccount(email);
  return fallbackAccount ? normalizeUser(fallbackAccount) : savedUser;
}

function updateLocalUserPassword(email, passwordHash) {
  const normalizedEmail = String(email || "").toLowerCase();
  const currentUsers = JSON.parse(localStorage.getItem("lemyu_users") || "[]").map(normalizeUser);
  const hasUser = currentUsers.some(user => String(user.email || "").toLowerCase() === normalizedEmail);
  const nextUsers = currentUsers.map(user => {
    if (String(user.email || "").toLowerCase() !== normalizedEmail) return user;
    return {
      ...user,
      password: passwordHash,
      password_hash: passwordHash
    };
  });

  if (!hasUser) {
    const fallbackAccount = getFallbackAccount(email);
    if (fallbackAccount) {
      nextUsers.push({
        ...fallbackAccount,
        password: passwordHash,
        password_hash: passwordHash
      });
    }
  }

  localStorage.setItem("lemyu_users", JSON.stringify(ensureFallbackAccounts(nextUsers)));
}

async function updateSupabaseUserPassword(email, passwordHash) {
  const passwordColumns = ["password_hash", "password", "user_password"];
  let lastError = null;

  for (const passwordColumn of passwordColumns) {
    const { data, error } = await supabase
      .from("users")
      .update({ [passwordColumn]: passwordHash })
      .eq("email", email)
      .select("*")
      .maybeSingle();

    if (!error && data) return normalizeUser(data);

    if (!error && !data) {
      lastError = new Error("No user account was found with this email.");
      continue;
    }

    lastError = error;
    if (!/column|schema cache/i.test(getErrorMessage(error))) break;
  }

  throw lastError || new Error("Unable to reset password.");
}

async function sendPasswordResetOtp(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true
    }
  });

  if (error) throw error;
}

async function resetPassword() {
  const email = resetEmailInput.value.trim().toLowerCase();
  const newPassword = resetPasswordInput.value.trim();
  const confirmPassword = resetConfirmPasswordInput.value.trim();

  if (!email || !newPassword || !confirmPassword) {
    alert("Please complete all reset password fields.");
    return;
  }

  if (newPassword !== confirmPassword) {
    alert("New password and confirm password do not match.");
    return;
  }

  const appUser = await findAppUser(email);
  if (!appUser || !isActiveUser(appUser)) {
    alert("No active account found for this email.");
    return;
  }

  const strength = validateStrongPassword(newPassword, appUser.username || appUser.fullName || "", email);
  if (!strength.valid) {
    alert("Password requirement alert:\n" + strength.issues.join("\n"));
    return;
  }

  resetPasswordBtn.disabled = true;
  resetPasswordBtn.textContent = "Sending Code...";

  try {
    const passwordHash = await hashPassword(newPassword);
    await sendPasswordResetOtp(email);
    pendingEmail = email;
    pendingPasswordReset = { email, passwordHash };
    alert("Password reset OTP sent. Please check your email.");
    showOtpView(email, "reset");
  } catch (error) {
    console.error("Unable to reset password:", error);
    alert("Unable to send password reset OTP: " + getErrorMessage(error));
  } finally {
    resetPasswordBtn.disabled = false;
    resetPasswordBtn.textContent = "Save New Password";
  }
}

async function sendLoginOtp() {
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    alert("Please enter your email address and password.");
    return;
  }

  const lockout = getLockout(email);
  if (Number(lockout.lockedUntil || 0) > Date.now()) {
    alert(`Account locked for ${getLockoutMinutesRemaining(email)} minute(s). Please try again later.`);
    return;
  }

  const appUser = await findAppUser(email);

  if (!appUser || !isActiveUser(appUser) || !await verifyPassword(password, appUser.password)) {
    const failedLogin = recordFailedLogin(email);
    const remainingAttempts = getRemainingLoginAttempts(email);

    if (Number(failedLogin.lockedUntil || 0) > Date.now()) {
      alert("Invalid email/password or account is inactive.\nAccount locked for 10 minutes.");
    } else {
      alert(`Invalid email/password or account is inactive.\nRemaining login attempt(s): ${remainingAttempts}`);
    }

    return;
  }

  sendOtpBtn.disabled = true;
  sendOtpBtn.textContent = "Sending OTP...";

  let error = null;

  try {
    const result = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true
      }
    });

    error = result.error;
  } catch (caughtError) {
    error = caughtError;
  } finally {
    sendOtpBtn.disabled = false;
    sendOtpBtn.textContent = "Login";
  }

  if (error) {
    console.error("Unable to send OTP:", error);
    alert("Unable to send OTP: " + getErrorMessage(error));
    return;
  }

  pendingEmail = email;
  showOtpView(email);
}

async function completeLogin(appUser) {
  const roles = await getRoles();
  const role = roles.find(item => String(item.name || "").toLowerCase() === String(appUser.role || "").toLowerCase());
  const permissions = isOperationsRole(appUser.role)
    ? OPERATIONS_PERMISSIONS
    : isFinanceRole(appUser.role)
    ? FINANCE_PERMISSIONS
    : role?.permissions?.length
      ? role.permissions
      : OWNER_PERMISSIONS;

  clearLoginLockout(pendingEmail);
  startSession(appUser, permissions);
  alert("Login successful.");
  window.location.href = isOperationsRole(appUser.role)
    ? "projects.html"
    : isFinanceRole(appUser.role)
      ? "expenses.html"
      : "dashboard.html";
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  await sendLoginOtp();
});

resetPasswordForm.addEventListener("submit", async event => {
  event.preventDefault();
  await resetPassword();
});

verifyOtpBtn.addEventListener("click", async () => {
  const token = otpInput.value.trim();

  if (!pendingEmail) {
    alert("Please send an OTP first.");
    return;
  }

  if (!/^[0-9]{8}$/.test(token)) {
    alert("Please enter the 8-digit OTP number.");
    return;
  }

  const { error } = await supabase.auth.verifyOtp({
    email: pendingEmail,
    token,
    type: "email"
  });

  if (error) {
    console.error("Invalid or expired OTP:", error);
    const failedLogin = recordFailedLogin(pendingEmail);
    const remainingAttempts = getRemainingLoginAttempts(pendingEmail);

    if (Number(failedLogin.lockedUntil || 0) > Date.now()) {
      alert("Invalid or expired OTP: " + getErrorMessage(error) + "\nAccount locked for 10 minutes.");
      showLoginView();
    } else {
      alert("Invalid or expired OTP: " + getErrorMessage(error) + `\nRemaining login attempt(s): ${remainingAttempts}`);
    }

    return;
  }

  if (pendingPasswordReset) {
    try {
      await updateSupabaseUserPassword(pendingPasswordReset.email, pendingPasswordReset.passwordHash);
      updateLocalUserPassword(pendingPasswordReset.email, pendingPasswordReset.passwordHash);
      clearLoginLockout(pendingPasswordReset.email);
      emailInput.value = pendingPasswordReset.email;
      passwordInput.value = "";
      pendingPasswordReset = null;
      await supabase.auth.signOut();
      alert("Password reset successful. You can now log in with your new password.");
      showLoginView();
    } catch (resetError) {
      console.error("Unable to save reset password:", resetError);
      alert("Unable to save reset password: " + getErrorMessage(resetError));
    }

    return;
  }

  const appUser = await findAppUser(pendingEmail);

  if (!appUser || !isActiveUser(appUser)) {
    alert("Account profile is missing or inactive.");
    await supabase.auth.signOut();
    return;
  }

  await completeLogin(appUser);
});

resendOtpBtn.addEventListener("click", async () => {
  if (!pendingPasswordReset) {
    await sendLoginOtp();
    return;
  }

  try {
    await sendPasswordResetOtp(pendingPasswordReset.email);
    alert("Password reset OTP resent. Please check your email.");
  } catch (error) {
    console.error("Unable to resend password reset OTP:", error);
    alert("Unable to resend password reset OTP: " + getErrorMessage(error));
  }
});

backToLoginBtn.addEventListener("click", showLoginView);

forgotPasswordBtn.addEventListener("click", showResetPasswordView);

backToLoginFromResetBtn.addEventListener("click", showLoginView);
