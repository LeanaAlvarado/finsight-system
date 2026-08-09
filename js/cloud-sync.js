import { supabase } from "./supabase.js?v=20260809-remove-expense-export-v164";

const LOCAL_PROJECTS_KEY = "lemyu_saved_projects";
const LOCAL_INVENTORY_KEY = "lemyu_saved_inventory";
const MATERIAL_CATALOG_KEY = "lemyu_material_catalog";
const SYNC_DONE_KEY = "lemyu_cloud_sync_completed_v1";
const SYNC_PENDING_KEY = "lemyu_cloud_sync_pending_v1";
const USER_KEYS = ["lemyu_users", "lemyu_roles"];
const LOCAL_SMART_CONTRACTS_KEY = "lemyu_smart_contracts";
const MAP_KEYS = [
  "lemyu_quotation_items",
  "lemyu_client_names",
  "lemyu_down_payments",
  "lemyu_inventory_project_codes",
  "lemyu_inventory_units",
  "lemyu_inventory_pictures",
  "lemyu_deleted_default_users",
  "lemyu_user_status_overrides"
];

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function stripLocalId(record = {}) {
  const next = { ...record };
  if (String(next.id || "").startsWith("local-")) delete next.id;
  if (String(next.id || "").startsWith("local-inventory-")) delete next.id;
  delete next.local_only;
  return next;
}

function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function createUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, char => {
    return (Number(char) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(char) / 4).toString(16);
  });
}

function remapObjectKeys(key, idMap) {
  const value = readJson(key, null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return;

  let didChange = false;
  const nextValue = { ...value };

  idMap.forEach((newId, oldId) => {
    if (!Object.prototype.hasOwnProperty.call(nextValue, oldId)) return;
    nextValue[newId] = nextValue[oldId];
    delete nextValue[oldId];
    didChange = true;
  });

  if (didChange) {
    localStorage.setItem(key, JSON.stringify(nextValue));
  }
}

function normalizeLocalInventoryIds(records = []) {
  const idMap = new Map();
  let didChange = false;

  const normalizedRecords = records.map(record => {
    const currentId = String(record?.id || "");
    if (!currentId || isUuid(currentId)) return record;

    const newId = createUuid();
    idMap.set(currentId, newId);
    didChange = true;
    return { ...record, id: newId };
  });

  if (didChange) {
    localStorage.setItem(LOCAL_INVENTORY_KEY, JSON.stringify(normalizedRecords));
    [
      "lemyu_inventory_project_codes",
      "lemyu_inventory_units",
      "lemyu_inventory_pictures"
    ].forEach(key => remapObjectKeys(key, idMap));
  }

  return normalizedRecords;
}

async function upsertProject(localProject = {}) {
  const projectCode = String(localProject.project_code || "").trim();
  const record = stripLocalId({
    project_code: projectCode,
    project_title: localProject.project_title || "",
    client_name: localProject.client_name || "",
    client_contact_name: localProject.client_contact_name || "",
    contact_number: localProject.contact_number || "",
    client_email: localProject.client_email || "",
    location: localProject.location || "",
    start_date: localProject.start_date || null,
    target_completion: localProject.target_completion || null,
    completed_date: localProject.completed_date || null,
    status: localProject.status || "Pending",
    project_budget: Number(localProject.project_budget || 0),
    contract_amount: Number(localProject.contract_amount || 0),
    down_payment: Number(localProject.down_payment || 0),
    tax_amount: localProject.tax_amount === "" ? null : localProject.tax_amount,
    ppr_prepared_by: localProject.ppr_prepared_by || "",
    ppr_noted_by: localProject.ppr_noted_by || "",
    remarks: localProject.remarks || "",
    quotation_type: localProject.quotation_type || "manpower",
    quotation_items: Array.isArray(localProject.quotation_items) ? localProject.quotation_items : [],
    purchase_order_number: localProject.purchase_order_number || "",
    purchase_order_amount: Number(localProject.purchase_order_amount || 0),
    purchase_order_file_name: localProject.purchase_order_file_name || "",
    purchase_order_file_url: localProject.purchase_order_file_url || "",
    billing_down_payment_amount: Number(localProject.billing_down_payment_amount || 0),
    billing_down_payment_percent: Number(localProject.billing_down_payment_percent || 0),
    billing_progress_percent: Number(localProject.billing_progress_percent || 0),
    contract_file_name: localProject.contract_file_name || "",
    contract_file_url: localProject.contract_file_url || ""
  });

  if (!projectCode) return { skipped: true };

  const existing = await supabase
    .from("projects")
    .select("id")
    .eq("project_code", projectCode)
    .maybeSingle();

  if (existing.error) return { error: existing.error };

  if (existing.data?.id) {
    return supabase.from("projects").update(record).eq("id", existing.data.id);
  }

  return supabase.from("projects").insert([record]);
}

async function insertInventory(record = {}) {
  const materialName = record.material_name || record.name || record.material || record.description || "Unnamed Material";
  const normalized = {
    id: isUuid(record.id) ? record.id : undefined,
    project_code: record.project_code || "",
    material_name: materialName,
    name: materialName,
    description: record.description || "",
    qty: Number(record.qty || 0),
    stock_qty: Number(record.stock_qty ?? record.qty ?? 0),
    unit: record.unit || "",
    price: Number(record.price || 0),
    picture_name: record.picture_name || "",
    picture_url: record.picture_url || ""
  };

  if (!normalized.name && !normalized.description) return { skipped: true };

  if (normalized.id) {
    const existingById = await supabase
      .from("inventory")
      .select("id")
      .eq("id", normalized.id)
      .maybeSingle();

    if (existingById.error) return { error: existingById.error };
    if (existingById.data?.id) return supabase.from("inventory").update(normalized).eq("id", normalized.id);
    return supabase.from("inventory").insert([normalized]);
  } else {
    delete normalized.id;
  }

  let existingQuery = supabase
    .from("inventory")
    .select("id")
    .eq("project_code", normalized.project_code)
    .eq("material_name", normalized.material_name)
    .eq("description", normalized.description)
    .eq("qty", normalized.qty)
    .eq("unit", normalized.unit)
    .eq("price", normalized.price);

  const existing = await existingQuery.limit(1);

  if (existing.error) return { error: existing.error };
  if (existing.data?.[0]?.id) return supabase.from("inventory").update(normalized).eq("id", existing.data[0].id);
  return supabase.from("inventory").insert([normalized]);
}

async function insertCatalog(record = {}) {
  const normalized = stripLocalId({
    name: record.name || "",
    description: record.description || "",
    unit: record.unit || "",
    price: Number(record.price || 0),
    picture_name: record.picture_name || "",
    picture_url: record.picture_url || ""
  });

  if (!normalized.name) return { skipped: true };

  const existing = await supabase
    .from("material_catalog")
    .select("id")
    .eq("name", normalized.name)
    .limit(1);

  if (existing.error) return { error: existing.error };
  if (existing.data?.[0]?.id) return supabase.from("material_catalog").update(normalized).eq("id", existing.data[0].id);
  return supabase.from("material_catalog").insert([normalized]);
}

function getMissingColumnName(error) {
  const message = String(error?.message || "");
  return message.match(/'([^']+)' column/)?.[1]
    || message.match(/column ["']?([A-Za-z0-9_]+)["']? does not exist/i)?.[1]
    || "";
}

function isDuplicateError(error) {
  return error?.code === "23505" || /duplicate key value/i.test(error?.message || "");
}

function getUserRecordCandidates(user = {}) {
  const fullName = user.fullName || user.full_name || user.name || user.username || "";
  const username = user.username || user.user_name || "";
  const email = String(user.email || user.user_email || "").trim().toLowerCase();
  const password = user.password_hash || user.password || user.user_password || "";
  const role = user.role || user.role_name || "User";
  const status = user.status || user.account_status || "Active";

  return ["password_hash", "user_password", "password"].map(passwordColumn => ({
    full_name: fullName,
    name: fullName,
    username,
    email,
    [passwordColumn]: password,
    role,
    role_name: role,
    status,
    account_status: status
  }));
}

async function writeUserWithOptionalColumns(user, write) {
  let lastError = null;

  for (const candidate of getUserRecordCandidates(user)) {
    let record = { ...candidate };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const { data, error } = await write(record);
      if (!error) return data || null;

      lastError = error;
      const missingColumn = getMissingColumnName(error);

      if (!missingColumn || !Object.prototype.hasOwnProperty.call(record, missingColumn)) break;
      if (["email", "password_hash", "user_password", "password"].includes(missingColumn)) break;

      record = { ...record };
      delete record[missingColumn];
    }
  }

  return { error: lastError };
}

async function upsertUser(record = {}) {
  const normalized = getUserRecordCandidates(record)[0];

  if (!normalized.email && !normalized.username) return { skipped: true };

  const filters = [
    ["email", normalized.email],
    ["username", normalized.username]
  ];

  for (const [column, value] of filters) {
    if (!value) continue;
    const existing = await supabase.from("users").select("id").eq(column, value).limit(1);
    if (existing.error) continue;
    if (existing.data?.[0]?.id) {
      return writeUserWithOptionalColumns(record, payload => supabase.from("users").update(payload).eq("id", existing.data[0].id).select("*").maybeSingle());
    }
  }

  const inserted = await writeUserWithOptionalColumns(record, payload => supabase.from("users").insert([payload]).select("*").single());
  if (!inserted?.error || !isDuplicateError(inserted.error)) return inserted;

  for (const [column, value] of filters) {
    if (!value) continue;
    const existing = await supabase.from("users").select("id").eq(column, value).limit(1);
    if (!existing.error && existing.data?.[0]?.id) {
      return writeUserWithOptionalColumns(record, payload => supabase.from("users").update(payload).eq("id", existing.data[0].id).select("*").maybeSingle());
    }
  }

  return inserted;
}

async function upsertRole(record = {}) {
  const normalized = {
    name: record.name || record.role_name || record.role || "",
    permissions: Array.isArray(record.permissions) ? record.permissions : []
  };

  if (!normalized.name) return { skipped: true };

  const roleCandidates = [
    { name: normalized.name, permissions: normalized.permissions },
    { role_name: normalized.name, permissions: normalized.permissions },
    { name: normalized.name, allowed_modules: normalized.permissions },
    { role_name: normalized.name, allowed_modules: normalized.permissions }
  ];

  const existingByName = await supabase.from("roles").select("id").eq("name", normalized.name).limit(1);
  const existingByRoleName = existingByName.error
    ? await supabase.from("roles").select("id").eq("role_name", normalized.name).limit(1)
    : { data: [] };
  const existingId = existingByName.data?.[0]?.id || existingByRoleName.data?.[0]?.id;

  let lastError = existingByName.error && existingByRoleName.error ? existingByRoleName.error : null;

  for (const candidate of roleCandidates) {
    const result = existingId
      ? await supabase.from("roles").update(candidate).eq("id", existingId)
      : await supabase.from("roles").insert([candidate]);

    if (!result.error) return result;
    lastError = result.error;
  }

  return { error: lastError };
}

async function upsertSmartContract(record = {}) {
  const id = record.id || `SC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return supabase.from("smart_contracts").upsert({
    id,
    project_id: record.project_id || "",
    project_code: record.project_code || "",
    project_title: record.project_title || "",
    client_name: record.client_name || "",
    contact_number: record.contact_number || "",
    contract_amount: record.contract_amount || "",
    down_payment: record.down_payment || "",
    balance_due: record.balance_due || "",
    projected_profit: record.projected_profit || "",
    status: record.status || "",
    project_status: record.project_status || "",
    smart_status: record.smart_status || "",
    rules: Array.isArray(record.rules) ? record.rules : [],
    created_at: record.created_at || new Date().toISOString()
  }, { onConflict: "id" });
}

async function syncRawLocalStorageKey(key) {
  const value = localStorage.getItem(key);
  if (value === null) return { skipped: true };

  let parsed = value;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }

  return supabase.from("app_local_storage").upsert({
    storage_key: key,
    storage_value: parsed,
    updated_at: new Date().toISOString()
  }, { onConflict: "storage_key" });
}

async function syncList(records, syncFn, label = "records") {
  let synced = 0;
  let failed = 0;
  const errors = [];

  for (const record of records) {
    const result = await syncFn(record);
    if (result?.error) {
      failed++;
      const message = result.error.message || result.error.details || String(result.error);
      const errorRecord = { label, message, record };
      errors.push(errorRecord);
      console.warn(`Cloud sync failed for ${label}:`, result.error, record);
    } else if (!result?.skipped) {
      synced++;
    }
  }

  return { synced, failed, errors };
}

export async function syncLocalDataToSupabase({ force = false } = {}) {
  const localProjects = readJson(LOCAL_PROJECTS_KEY, []);
  const localInventory = normalizeLocalInventoryIds(readJson(LOCAL_INVENTORY_KEY, []));
  const localCatalog = readJson(MATERIAL_CATALOG_KEY, []);
  const localUsers = readJson("lemyu_users", []);
  const localRoles = readJson("lemyu_roles", []);
  const localSmartContracts = readJson(LOCAL_SMART_CONTRACTS_KEY, []);

  if (!force && localStorage.getItem(SYNC_DONE_KEY) === "true" && localStorage.getItem(SYNC_PENDING_KEY) !== "true") {
    const hasAnyLocalData = localProjects.length
      || localInventory.length
      || localCatalog.length
      || localUsers.length
      || localRoles.length
      || localSmartContracts.length
      || [...USER_KEYS, ...MAP_KEYS].some(key => localStorage.getItem(key) !== null);

    if (!hasAnyLocalData) return;
  }

  if (!localProjects.length && !localInventory.length && !localCatalog.length && !localUsers.length && !localRoles.length && !localSmartContracts.length) {
    await syncList([...USER_KEYS, ...MAP_KEYS], syncRawLocalStorageKey, "localStorage mirror");
    localStorage.setItem(SYNC_DONE_KEY, "true");
    return;
  }

  const projectResult = await syncList(localProjects, upsertProject, "projects");
  const inventoryResult = await syncList(localInventory, insertInventory, "inventory");
  const catalogResult = await syncList(localCatalog, insertCatalog, "material catalog");
  const userResult = await syncList(localUsers, upsertUser, "users");
  const roleResult = await syncList(localRoles, upsertRole, "roles");
  const smartContractResult = await syncList(localSmartContracts, upsertSmartContract, "smart contracts");
  const rawKeyResult = await syncList([...USER_KEYS, ...MAP_KEYS, LOCAL_SMART_CONTRACTS_KEY], syncRawLocalStorageKey, "localStorage mirror");

  const failed = projectResult.failed + inventoryResult.failed + catalogResult.failed + userResult.failed + roleResult.failed + smartContractResult.failed + rawKeyResult.failed;
  const synced = projectResult.synced + inventoryResult.synced + catalogResult.synced + userResult.synced + roleResult.synced + smartContractResult.synced + rawKeyResult.synced;

  const auditResult = await supabase.from("cloud_sync_audit").insert([{
    source_key: "browser-local-storage",
    synced_count: synced,
    error_count: failed
  }]);

  if (auditResult.error) {
    console.warn("Cloud sync audit was not saved:", auditResult.error.message || auditResult.error);
  }

  const errors = [
    ...projectResult.errors,
    ...inventoryResult.errors,
    ...catalogResult.errors,
    ...userResult.errors,
    ...roleResult.errors,
    ...smartContractResult.errors,
    ...rawKeyResult.errors
  ];
  const summary = { synced, failed, errors };

  if (!failed) {
    localStorage.removeItem(SYNC_PENDING_KEY);
    localStorage.setItem(SYNC_DONE_KEY, "true");
  } else {
    localStorage.setItem(SYNC_PENDING_KEY, "true");
    window.lemyuLastSyncErrors = errors;
    console.table(errors.map(error => ({ area: error.label, error: error.message })));
    console.warn("Some local records could not sync to Supabase yet. Run supabase/cloud_required_schema.sql in Supabase SQL Editor, then reload this page.");
  }

  window.lemyuLastSyncSummary = summary;
  return summary;
}

export async function forceLocalDataSyncToSupabase() {
  localStorage.removeItem(SYNC_DONE_KEY);
  localStorage.setItem(SYNC_PENDING_KEY, "true");
  return syncLocalDataToSupabase({ force: true });
}
