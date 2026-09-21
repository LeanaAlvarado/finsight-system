// Presentation only: the original, immutable audit rows are never changed.
const ENTITIES = {
  inventory: ['Inventory', 'inventory item'], material_catalog: ['Inventory', 'catalog material'],
  projects: ['Project Monitoring', 'project'], project_files: ['Project Monitoring', 'project file'],
  smart_contracts: ['Project Monitoring', 'contract'], expenses: ['Payroll & Expenses', 'expense'],
  payroll: ['Payroll & Expenses', 'payroll record'], feedback: ['Proposal / Quotation & Feedback', 'feedback'],
  users: ['User & Role Management', 'user account'], roles: ['User & Role Management', 'role'],
  cost_overrun_alerts: ['Dashboard', 'budget alert']
};
const PAGES = {
  'dashboard.html': 'Dashboard', 'owner-dashboard.html': 'Dashboard', 'inventory.html': 'Inventory',
  'expenses.html': 'Payroll & Expenses', 'payroll.html': 'Payroll & Expenses',
  'projects.html': 'Project Monitoring', 'revenue.html': 'Taxes & Revenue',
  'feedback.html': 'Proposal / Quotation & Feedback', 'reports-audit.html': 'Reports & Audit Logs',
  'user-role-management.html': 'User & Role Management', 'index.html': 'Sign in'
};
const STORAGE = {
  lemyu_saved_inventory: ['Inventory', 'inventory records'],
  lemyu_material_catalog: ['Inventory', 'material catalog'],
  lemyu_inventory_pictures: ['Inventory', 'material pictures'],
  lemyu_inventory_units: ['Inventory', 'material units'],
  lemyu_inventory_project_codes: ['Inventory', 'material project assignments'],
  lemyu_saved_projects: ['Project Monitoring', 'projects'],
  lemyu_smart_contracts: ['Project Monitoring', 'contracts'],
  lemyu_users: ['User & Role Management', 'user accounts'],
  lemyu_roles: ['User & Role Management', 'roles'],
  lemyu_user_status_overrides: ['User & Role Management', 'account status settings'],
  lemyu_quotation_items: ['Proposal / Quotation & Feedback', 'quotation items'],
  lemyu_client_names: ['Project Monitoring', 'client names'],
  lemyu_down_payments: ['Taxes & Revenue', 'down payments'],
  lemyu_project_billing: ['Taxes & Revenue', 'project billing']
};
// These keys are duplicate copies of business rows, not separate user actions.
const MIRROR_KEYS = new Set(['lemyu_saved_inventory', 'lemyu_material_catalog',
  'lemyu_inventory_pictures', 'lemyu_inventory_units', 'lemyu_inventory_project_codes',
  'lemyu_saved_projects', 'lemyu_smart_contracts', 'lemyu_users', 'lemyu_roles']);
const FIELD_NAMES = {
  qty: 'Quantity', stock_qty: 'Stock quantity', price: 'Unit price', name: 'Name', material_name: 'Material name',
  project_id: 'Project', project_code: 'Project code', project_title: 'Project title',
  unit: 'Unit', amount: 'Amount', salary_amount: 'Salary', deduction_amount: 'Deduction',
  payment_status: 'Payment status', employee_name: 'Employee name', pay_date: 'Pay date', work_days: 'Work days',
  progress_percentage: 'Progress', project_budget: 'Budget', contract_amount: 'Contract amount',
  down_payment: 'Down payment', tax_amount: 'Tax', initial_actual_cost: 'Initial actual cost',
  role: 'Role', role_name: 'Role', status: 'Status', account_status: 'Account status',
  full_name: 'Full name', permissions: 'Permissions', allowed_modules: 'Allowed modules',
  quotation_items: 'Quotation items', ppr_report_config: 'Progress report settings',
  is_visible_in_report: 'Visible in report', picture_url: 'Picture', file_url: 'File',
  storage_value: 'Saved values', storage_path: 'File location'
};
const TECHNICAL_FIELDS = new Set(['created_at', 'updated_at']);
const SECRET_FIELD = /password|passwd|secret|token|otp|api_key|authorization/i;
const MONEY_FIELD = /^(price|amount|salary_amount|deduction_amount|project_budget|contract_amount|down_payment|tax_amount|initial_actual_cost|balance_due|projected_profit|budget_amount|actual_expenses|exceeded_amount|purchase_order_amount|billing_down_payment_amount)$/;

function words(value = '') {
  return String(value).replace(/^lemyu_/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ').trim();
}
function fieldName(key) {
  const name = FIELD_NAMES[key] || words(key);
  return name.charAt(0).toUpperCase() + name.slice(1);
}
function tableName(log) { return String(log.table_name || '').replace(/^public\./, ''); }
function storageKey(log) { return log.new_data?.storage_key || log.old_data?.storage_key || log.record_id || ''; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}
function same(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
function valueText(value, key) {
  if (SECRET_FIELD.test(key)) return '[REDACTED]';
  if (value === undefined) return 'not recorded';
  if (value === null || value === '') return 'not set';
  if (/_url$|storage_path/.test(key)) return 'attached'; // Never display signed URLs/tokens.
  if (MONEY_FIELD.test(key) && Number.isFinite(Number(value))) {
    return `PHP ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value.every(item => typeof item === 'string') ? value.join(', ') || 'none' : `${value.length} item(s)`;
  }
  if (typeof value === 'object') return 'configured';
  return String(value);
}
function describeChange(before, after, key, label = fieldName(key), depth = 0) {
  if (same(before, after) || SECRET_FIELD.test(key)) return [];
  if (/_url$|storage_path/.test(key)) return [`${label} changed`];
  const isObject = value => value && typeof value === 'object';
  const stringList = value => Array.isArray(value) && value.every(item => typeof item === 'string');
  if (isObject(before) || isObject(after)) {
    if (stringList(before) && stringList(after)) {
      return [`${label} changed from ${valueText(before, key)} to ${valueText(after, key)}`];
    }
    if (depth >= 6) return [`${label} changed`];
    const oldValue = isObject(before) ? before : {};
    const newValue = isObject(after) ? after : {};
    const array = Array.isArray(before) || Array.isArray(after);
    const details = [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].flatMap(child => {
      if (TECHNICAL_FIELDS.has(child)) return [];
      const childLabel = array ? `Item ${Number(child) + 1}` : fieldName(child);
      return describeChange(oldValue[child], newValue[child], child, `${label} / ${childLabel}`, depth + 1);
    });
    return details.length ? details : [`${label} changed`];
  }
  return [`${label} changed from ${valueText(before, key)} to ${valueText(after, key)}`];
}
function changes(log) {
  const before = log.old_data || {};
  const after = log.new_data || {};
  const result = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (TECHNICAL_FIELDS.has(key) || SECRET_FIELD.test(key) || same(before[key], after[key])) continue;
    result.push(...describeChange(before[key], after[key], key));
  }
  if (log.metadata?.credential_fields_changed || [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .some(key => SECRET_FIELD.test(key) && !same(before[key], after[key]))) result.push('Account credentials changed');
  return result;
}

export function getAuditModuleName(log = {}) {
  const table = tableName(log);
  if (table.startsWith('page:')) return table.slice(5);
  if (table === 'app_local_storage') return STORAGE[storageKey(log)]?.[0] || 'System';
  if (table === 'reports') return 'Reports & Audit Logs';
  if (table === 'authentication') return 'Authentication';
  return ENTITIES[table]?.[0] || 'System';
}
export function getAuditReference(log = {}) {
  const row = log.new_data || log.old_data || {};
  const table = tableName(log);
  if (table === 'app_local_storage') return STORAGE[storageKey(log)]?.[1] || words(storageKey(log)) || 'Saved settings';
  const fields = {
    inventory: ['name', 'material_name'], material_catalog: ['name'], projects: ['project_title', 'project_code'],
    payroll: ['employee_name'], expenses: ['description', 'category'], feedback: ['client_name'],
    users: ['full_name', 'name', 'username', 'email'], roles: ['name', 'role_name'],
    project_files: ['file_name', 'photo_title'], smart_contracts: ['project_title', 'project_code'],
    cost_overrun_alerts: ['project_id']
  }[table] || [];
  return fields.map(field => row[field]).find(value => value !== null && value !== undefined && value !== '')
    || PAGES[log.record_id] || log.record_id || PAGES[log.metadata?.page]
    || row.name || log.metadata?.email || 'System event';
}
function eventDescription(log, moduleName) {
  const metadata = log.metadata || {};
  const event = String(metadata.event || 'System event recorded');
  if (event === 'Module opened') return { activity: `Opened ${moduleName}`, category: 'activity' };
  if (event.startsWith('Control activated:') || event.startsWith('Clicked:') || event.startsWith('Download requested:')) {
    const label = metadata.label || event.slice(event.indexOf(':') + 1).trim();
    const download = event.startsWith('Download requested:');
    return { activity: `${download ? 'Requested download' : 'Clicked'} “${label}” in ${moduleName}`, category: 'interaction' };
  }
  if (event === 'Form submission attempted') {
    return { activity: `Submitted ${metadata.form_label || words(metadata.form) || moduleName} for saving (attempt)`, category: 'interaction' };
  }
  if (event === 'Field or filter changed') {
    return { activity: `Changed ${metadata.field_label || words(metadata.control) || 'a field or filter'} in ${moduleName} (before saving)`, category: 'interaction' };
  }
  const named = {
    'Successful login': 'Signed in to the system', 'User logout': 'Signed out of the system',
    'Session expired': 'Signed out after the session expired',
    'Module access denied': `Attempted to open ${PAGES[log.record_id] || log.record_id || 'a restricted module'}; access denied`,
    'Print dialog requested': `Opened the print dialog for ${moduleName}`,
    'Printed management summary': 'Requested printing of the management summary'
  };
  return { activity: named[event] || event, category: 'activity' };
}

export function describeAuditLog(log = {}) {
  const table = tableName(log);
  const action = String(log.action || 'EVENT').toUpperCase();
  const moduleName = getAuditModuleName(log);
  const reference = String(getAuditReference(log));
  const base = { moduleName, reference, details: [], category: 'activity' };
  if (action === 'EVENT') return { ...base, ...eventDescription(log, moduleName) };
  if (table === 'cloud_sync_audit') {
    const row = log.new_data || log.old_data || {};
    return { ...base, category: 'background', activity: `Recorded cloud synchronization: ${row.synced_count ?? 0} record(s), ${row.error_count ?? 0} error(s)` };
  }
  if (table === 'app_local_storage') {
    const key = storageKey(log);
    const unchanged = action === 'UPDATE' && same(log.old_data?.storage_value, log.new_data?.storage_value);
    const category = MIRROR_KEYS.has(key) || unchanged || !STORAGE[key] ? 'background' : 'activity';
    const verb = action === 'DELETE' ? 'Removed' : action === 'INSERT' ? 'Saved' : 'Updated';
    const details = category === 'activity' ? describeChange(log.old_data?.storage_value, log.new_data?.storage_value, 'storage_value', reference) : [];
    return { ...base, category, details, activity: `${verb} saved ${reference}${unchanged ? ' (no saved values changed)' : ''}${details.length ? `: ${details.slice(0, 3).join('; ')}${details.length > 3 ? ` (+${details.length - 3} more changes)` : ''}` : ''}` };
  }
  const entity = ENTITIES[table]?.[1] || words(table) || 'record';
  const subject = `${entity} “${reference}”`;
  if (action === 'UPDATE') {
    if (!log.old_data || !log.new_data) return { ...base, activity: `Updated ${subject} (before-and-after details unavailable)` };
    const details = changes(log);
    if (!details.length) return { ...base, category: 'background', activity: `Refreshed ${subject} (no business values changed)` };
    return { ...base, details, activity: `Updated ${subject}: ${details.slice(0, 3).join('; ')}${details.length > 3 ? ` (+${details.length - 3} more changes)` : ''}` };
  }
  const row = log.new_data || log.old_data || {};
  const contextFields = {
    inventory: ['qty', 'unit', 'project_code'], material_catalog: ['unit', 'price'],
    expenses: ['amount', 'project_code'], payroll: ['salary_amount', 'pay_date'],
    projects: ['project_code', 'status'], users: ['role'], feedback: ['rating']
  }[table] || [];
  const context = contextFields.filter(key => row[key] !== undefined && row[key] !== null && row[key] !== '')
    .map(key => `${fieldName(key)}: ${valueText(row[key], key)}`).join('; ');
  const verb = action === 'DELETE' ? 'Deleted' : action === 'INSERT' ? 'Added' : 'Recorded';
  return { ...base, activity: `${verb} ${subject}${context ? ` (${context})` : ''}` };
}

export function buildAuditEvents(logs = []) {
  return logs.map(log => ({
    ...describeAuditLog(log), id: log.id,
    dateValue: log.occurred_at || log.created_at || '',
    actor: log.metadata?.actor_email || log.actor_id || 'System / public activity',
    activityType: String(log.action || 'event').toLowerCase()
  })).sort((a, b) => new Date(b.dateValue) - new Date(a.dateValue));
}
export function matchesAuditView(event, view = 'activity') {
  return view === 'all' || event.category === view;
}
