const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const LOCKOUT_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

const WEAK_PASSWORDS = new Set([
  "password",
  "password123",
  "admin",
  "admin123",
  "owner123",
  "123456",
  "12345678",
  "qwerty",
  "letmein",
  "welcome"
]);

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

export function validateStrongPassword(password, username = "", email = "") {
  const issues = [];
  const lowerPassword = String(password || "").toLowerCase();
  const lowerUsername = String(username || "").toLowerCase();
  const lowerEmailName = String(email || "").split("@")[0].toLowerCase();

  if (password.length < 10) issues.push("Use at least 10 characters.");
  if (!/[A-Z]/.test(password)) issues.push("Add an uppercase letter.");
  if (!/[a-z]/.test(password)) issues.push("Add a lowercase letter.");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("Add a symbol.");
  if (WEAK_PASSWORDS.has(lowerPassword)) issues.push("Choose a less common password.");
  if (lowerUsername && lowerPassword.includes(lowerUsername)) issues.push("Do not include the username.");
  if (lowerEmailName && lowerPassword.includes(lowerEmailName)) issues.push("Do not include the email name.");

  return {
    valid: issues.length === 0,
    issues
  };
}

export function getRemainingLoginAttempts(username) {
  const lockout = getLockout(username);
  return Math.max(MAX_LOGIN_ATTEMPTS - Number(lockout.attempts || 0), 0);
}

export function getLockoutMinutesRemaining(username) {
  const lockout = getLockout(username);
  const lockedUntil = Number(lockout.lockedUntil || 0);

  if (lockedUntil <= Date.now()) return 0;

  return Math.ceil((lockedUntil - Date.now()) / 60000);
}

export async function hashPassword(password) {
  const salt = randomHex();
  const hash = await sha256Hex(`${salt}:${password}`);
  return `sha256$${salt}$${hash}`;
}

export async function verifyPassword(password, storedPassword = "") {
  if (!storedPassword) return false;

  const parts = String(storedPassword).split("$");

  if (parts.length === 3 && parts[0] === "sha256") {
    const [, salt, expectedHash] = parts;
    const actualHash = await sha256Hex(`${salt}:${password}`);
    return actualHash === expectedHash;
  }

  return String(storedPassword) === String(password);
}

export function getLockout(username) {
  const key = `lemyu_lockout_${String(username || "").toLowerCase()}`;
  const record = JSON.parse(localStorage.getItem(key) || "null");

  if (!record) {
    return { attempts: 0, lockedUntil: 0 };
  }

  if (Number(record.lockedUntil || 0) <= Date.now()) {
    return { attempts: Number(record.attempts || 0), lockedUntil: 0 };
  }

  return record;
}

export function recordFailedLogin(username) {
  const key = `lemyu_lockout_${String(username || "").toLowerCase()}`;
  const current = getLockout(username);
  const attempts = Number(current.attempts || 0) + 1;
  const lockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0;
  const record = { attempts, lockedUntil };
  localStorage.setItem(key, JSON.stringify(record));
  return record;
}

export function clearLoginLockout(username) {
  localStorage.removeItem(`lemyu_lockout_${String(username || "").toLowerCase()}`);
}

export function createOtp() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
}

export function startSession(user, permissions = []) {
  const expiresAt = Date.now() + SESSION_TIMEOUT_MS;
  const roleLabel = user.role || "Owner/Manager";

  localStorage.setItem("lemyu_is_authenticated", "true");
  localStorage.setItem("lemyu_session_expires_at", String(expiresAt));
  localStorage.setItem("lemyu_user_role", String(roleLabel).toLowerCase());
  localStorage.setItem("lemyu_user_role_label", roleLabel);
  localStorage.setItem("lemyu_user_name", user.fullName || user.username || "User");
  localStorage.setItem("lemyu_username", user.username || user.email || "User");
  localStorage.setItem("lemyu_user_email", user.email || "");
  localStorage.setItem("lemyu_role_permissions", JSON.stringify(permissions));
}

export function isSessionActive() {
  return localStorage.getItem("lemyu_is_authenticated") === "true"
    && Number(localStorage.getItem("lemyu_session_expires_at") || 0) > Date.now();
}

export function refreshSession() {
  if (localStorage.getItem("lemyu_is_authenticated") === "true") {
    localStorage.setItem("lemyu_session_expires_at", String(Date.now() + SESSION_TIMEOUT_MS));
  }
}

export function endSession() {
  localStorage.removeItem("lemyu_is_authenticated");
  localStorage.removeItem("lemyu_session_expires_at");
  localStorage.removeItem("lemyu_user_role");
  localStorage.removeItem("lemyu_user_role_label");
  localStorage.removeItem("lemyu_user_name");
  localStorage.removeItem("lemyu_username");
  localStorage.removeItem("lemyu_user_email");
  localStorage.removeItem("lemyu_role_permissions");
}
