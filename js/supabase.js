import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const SUPABASE_URL = "https://azjmgkxyciynpiowqfii.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_0o9Z_0yCe1oV0y31fjVpvA_IR9Xylzt";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});

export function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function peso(value) {
  return "PHP " + number(value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(value, fallback = "-") {
  if (!value) return fallback;

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "2-digit"
      });
}

export function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

export async function readTable(tableName, options = {}) {
  let query = supabase.from(tableName).select(options.columns || "*");

  if (options.eq) {
    Object.entries(options.eq).forEach(([column, value]) => {
      query = query.eq(column, value);
    });
  }

  if (options.orderBy) {
    query = query.order(options.orderBy, {
      ascending: options.ascending ?? false
    });
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data = [], error } = await query;
  return { data: data || [], error };
}

function insertQuery(tableName, record, returnRecord) {
  const query = supabase.from(tableName).insert([record]);
  return returnRecord ? query.select("*").single() : query;
}

function updateQuery(tableName, record, matchColumn, matchValue, returnRecord) {
  const query = supabase.from(tableName).update(record).eq(matchColumn, matchValue);
  return returnRecord ? query.select("*").single() : query;
}

function getMissingColumnFromError(error) {
  const message = error?.message || "";
  return message.match(/'([^']+)'\s+column/i)?.[1]
    || message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+of/i)?.[1]
    || "";
}

async function runWithOptionalColumnFallback(record, optionalColumns, runQuery) {
  const optionalSet = new Set(optionalColumns);
  const strippedColumns = new Set();
  let currentRecord = { ...record };
  let result = await runQuery(currentRecord);

  while (result.error) {
    const missingColumn = getMissingColumnFromError(result.error);

    if (!missingColumn || !optionalSet.has(missingColumn) || strippedColumns.has(missingColumn)) {
      break;
    }

    strippedColumns.add(missingColumn);
    delete currentRecord[missingColumn];
    result = await runQuery(currentRecord);
  }

  return result;
}

export async function insertWithOptionalColumns(tableName, record, optionalColumns = [], options = {}) {
  return runWithOptionalColumnFallback(record, optionalColumns, currentRecord => {
    return insertQuery(tableName, currentRecord, options.returnRecord);
  });
}

export async function updateWithOptionalColumns(tableName, record, matchColumn, matchValue, optionalColumns = [], options = {}) {
  return runWithOptionalColumnFallback(record, optionalColumns, currentRecord => {
    return updateQuery(tableName, currentRecord, matchColumn, matchValue, options.returnRecord);
  });
}
