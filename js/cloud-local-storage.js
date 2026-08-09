import { supabase } from "./supabase.js?v=20260809-cctv-action-end-v142";

const CLOUD_KEYS_PREFIX = "lemyu_";
const EXCLUDED_KEYS = new Set([
  "lemyu_is_authenticated",
  "lemyu_session_expires_at",
  "lemyu_user_role",
  "lemyu_user_role_label",
  "lemyu_user_name",
  "lemyu_username",
  "lemyu_user_email",
  "lemyu_role_permissions"
]);
const ARRAY_KEYS = new Set([
  "lemyu_saved_projects",
  "lemyu_saved_inventory",
  "lemyu_material_catalog",
  "lemyu_users",
  "lemyu_roles",
  "lemyu_smart_contracts"
]);
const OBJECT_KEYS = new Set([
  "lemyu_quotation_items",
  "lemyu_client_names",
  "lemyu_down_payments",
  "lemyu_project_billing",
  "lemyu_inventory_project_codes",
  "lemyu_inventory_units",
  "lemyu_inventory_pictures",
  "lemyu_user_status_overrides"
]);

const originalSetItem = Storage.prototype.setItem;
const originalRemoveItem = Storage.prototype.removeItem;
const originalClear = Storage.prototype.clear;

function shouldSyncKey(key = "") {
  return String(key).startsWith(CLOUD_KEYS_PREFIX)
    && !EXCLUDED_KEYS.has(String(key))
    && !String(key).startsWith("lemyu_lockout_");
}

function notifyLocalDataChanged(key) {
  if (!shouldSyncKey(key)) return;

  window.dispatchEvent(new CustomEvent("lemyu:local-data-changed", {
    detail: { key }
  }));
}

function parseStorageValue(value) {
  if (value === undefined) return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") return Object.keys(value).length === 0;
  return value === null || value === undefined || value === "";
}

function mergeArrayByKey(localValue = [], cloudValue = [], keyFields = ["id", "project_code", "email", "name"]) {
  const records = Array.isArray(localValue) ? [...localValue] : [];

  (Array.isArray(cloudValue) ? cloudValue : []).forEach(item => {
    const matchIndex = records.findIndex(record => {
      return keyFields.some(field => item?.[field] && record?.[field] && String(item[field]).toLowerCase() === String(record[field]).toLowerCase());
    });

    if (matchIndex >= 0) {
      records[matchIndex] = { ...item, ...records[matchIndex] };
    } else {
      records.push(item);
    }
  });

  return records;
}

function saveMergedArray(key, cloudRecords = [], keyFields) {
  if (!Array.isArray(cloudRecords) || !cloudRecords.length) return;
  const localRecords = parseStorageValue(localStorage.getItem(key)) || [];
  const mergedRecords = key === "lemyu_saved_inventory"
    ? mergeArrayByKey(cloudRecords, localRecords, keyFields)
    : mergeArrayByKey(localRecords, cloudRecords, keyFields);
  originalSetItem.call(localStorage, key, JSON.stringify(mergedRecords));
}

function mergeHydratedValue(key, localValue, cloudValue) {
  if (isEmptyValue(cloudValue)) return localValue;
  if (isEmptyValue(localValue)) return cloudValue;
  if (key === "lemyu_saved_inventory") return mergeArrayByKey(localValue, cloudValue, ["id"]);
  if (ARRAY_KEYS.has(key)) return mergeArrayByKey(localValue, cloudValue);
  if (OBJECT_KEYS.has(key)) return { ...(cloudValue || {}), ...(localValue || {}) };
  return localValue;
}

async function upsertCloudStorage(key, value) {
  if (!shouldSyncKey(key)) return;

  const { error } = await supabase
    .from("app_local_storage")
    .upsert({
      storage_key: key,
      storage_value: parseStorageValue(value),
      updated_at: new Date().toISOString()
    }, { onConflict: "storage_key" });

  if (error) {
    console.warn("Unable to sync localStorage key to Supabase:", key, error.message || error);
  }
}

async function deleteCloudStorage(key) {
  if (!shouldSyncKey(key)) return;

  const { error } = await supabase
    .from("app_local_storage")
    .delete()
    .eq("storage_key", key);

  if (error) {
    console.warn("Unable to remove localStorage key from Supabase:", key, error.message || error);
  }
}

export async function hydrateLocalStorageFromSupabase() {
  const { data, error } = await supabase
    .from("app_local_storage")
    .select("storage_key, storage_value");

  if (error) {
    console.warn("Unable to hydrate localStorage from Supabase:", error.message || error);
    return;
  }

  (data || []).forEach(item => {
    if (!shouldSyncKey(item.storage_key)) return;
    const localValue = parseStorageValue(localStorage.getItem(item.storage_key));
    const nextValue = mergeHydratedValue(item.storage_key, localValue, item.storage_value);
    originalSetItem.call(localStorage, item.storage_key, JSON.stringify(nextValue));
  });
}

export async function restoreLocalBusinessDataFromSupabase() {
  const [projectsResult, inventoryResult, catalogResult, usersResult, rolesResult, smartContractsResult] = await Promise.all([
    supabase.from("projects").select("*"),
    supabase.from("inventory").select("*"),
    supabase.from("material_catalog").select("*"),
    supabase.from("users").select("*"),
    supabase.from("roles").select("*"),
    supabase.from("smart_contracts").select("*")
  ]);

  if (!projectsResult.error && (projectsResult.data || []).length) {
    saveMergedArray("lemyu_saved_projects", projectsResult.data || [], ["id", "project_code"]);
  }

  if (!inventoryResult.error && (inventoryResult.data || []).length) {
    const normalizedInventory = (inventoryResult.data || []).map(item => ({
      ...item,
      name: item.name || item.material_name || item.description || "Unnamed Material",
      material_name: item.material_name || item.name || item.description || "Unnamed Material"
    }));
    saveMergedArray("lemyu_saved_inventory", normalizedInventory, ["id"]);
  }

  if (!catalogResult.error && (catalogResult.data || []).length) {
    saveMergedArray("lemyu_material_catalog", catalogResult.data || [], ["id", "name"]);
  }

  if (!usersResult.error && (usersResult.data || []).length) {
    const normalizedUsers = (usersResult.data || []).map(user => ({
      ...user,
      fullName: user.fullName || user.full_name || user.name || user.username || "",
      role: user.role || user.role_name || "User"
    }));
    saveMergedArray("lemyu_users", normalizedUsers, ["id", "email", "username"]);
  }

  if (!rolesResult.error && (rolesResult.data || []).length) {
    saveMergedArray("lemyu_roles", rolesResult.data || [], ["id", "name"]);
  }

  if (!smartContractsResult.error && (smartContractsResult.data || []).length) {
    saveMergedArray("lemyu_smart_contracts", smartContractsResult.data || [], ["id", "project_code"]);
  }
}

export async function syncExistingLocalStorageToSupabase() {
  const entries = [];

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!shouldSyncKey(key)) continue;

    entries.push({
      storage_key: key,
      storage_value: parseStorageValue(localStorage.getItem(key)),
      updated_at: new Date().toISOString()
    });
  }

  if (!entries.length) return;

  const { error } = await supabase
    .from("app_local_storage")
    .upsert(entries, { onConflict: "storage_key" });

  if (error) {
    console.warn("Unable to sync existing localStorage to Supabase:", error.message || error);
  }
}

export async function getCloudRecoveryReport() {
  const localCounts = {
    projects: (parseStorageValue(localStorage.getItem("lemyu_saved_projects")) || []).length,
    inventory: (parseStorageValue(localStorage.getItem("lemyu_saved_inventory")) || []).length,
    materialCatalog: (parseStorageValue(localStorage.getItem("lemyu_material_catalog")) || []).length,
    users: (parseStorageValue(localStorage.getItem("lemyu_users")) || []).length,
    roles: (parseStorageValue(localStorage.getItem("lemyu_roles")) || []).length,
    smartContracts: (parseStorageValue(localStorage.getItem("lemyu_smart_contracts")) || []).length
  };

  const [
    projectsResult,
    inventoryResult,
    catalogResult,
    usersResult,
    rolesResult,
    smartContractsResult,
    mirrorResult
  ] = await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }),
    supabase.from("inventory").select("id", { count: "exact", head: true }),
    supabase.from("material_catalog").select("id", { count: "exact", head: true }),
    supabase.from("users").select("id", { count: "exact", head: true }),
    supabase.from("roles").select("id", { count: "exact", head: true }),
    supabase.from("smart_contracts").select("id", { count: "exact", head: true }),
    supabase.from("app_local_storage").select("storage_key", { count: "exact", head: true })
  ]);

  return {
    local: localCounts,
    supabase: {
      projects: projectsResult.count ?? 0,
      inventory: inventoryResult.count ?? 0,
      materialCatalog: catalogResult.count ?? 0,
      users: usersResult.count ?? 0,
      roles: rolesResult.count ?? 0,
      smartContracts: smartContractsResult.count ?? 0,
      localStorageMirror: mirrorResult.count ?? 0
    },
    errors: [
      projectsResult.error,
      inventoryResult.error,
      catalogResult.error,
      usersResult.error,
      rolesResult.error,
      smartContractsResult.error,
      mirrorResult.error
    ].filter(Boolean).map(error => error.message || String(error))
  };
}

export function installCloudLocalStorageMirror() {
  if (window.__lemyuCloudLocalStorageMirrorInstalled) return;
  window.__lemyuCloudLocalStorageMirrorInstalled = true;

  Storage.prototype.setItem = function(key, value) {
    originalSetItem.call(this, key, value);

    if (this === localStorage) {
      notifyLocalDataChanged(key);
      void upsertCloudStorage(key, value);
    }
  };

  Storage.prototype.removeItem = function(key) {
    originalRemoveItem.call(this, key);

    if (this === localStorage) {
      notifyLocalDataChanged(key);
      void deleteCloudStorage(key);
    }
  };

  Storage.prototype.clear = function() {
    const keys = [];

    if (this === localStorage) {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (shouldSyncKey(key)) keys.push(key);
      }
    }

    originalClear.call(this);
    keys.forEach(key => {
      notifyLocalDataChanged(key);
      void deleteCloudStorage(key);
    });
  };
}
