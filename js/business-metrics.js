
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const norm = value => String(value ?? '').trim().toLowerCase();
const cents = value => Math.round((numeric(value) + Number.EPSILON) * 100);
const financial = new Set(['approved','ongoing','on going','in progress','completed','complete']);
export function buildBusinessMetrics(projects = [], expenses = [], payroll = []) {
  const eligible = projects.filter(p => financial.has(norm(p.status)));
  const rows = eligible.map(project => ({ project, label: project.project_code || project.project_title || 'Unnamed project',
    contract: cents(project.contract_amount), budget: cents(project.project_budget),
    tax: Math.round(cents(project.contract_amount) * numeric(project.tax_amount) / 100),
    opening: cents(project.initial_actual_cost), spending: cents(project.initial_actual_cost) }));
  function match(record) {
    // An explicit foreign key takes precedence over reused titles or codes.
    if (record.project_id) return rows.find(r => norm(r.project.id) === norm(record.project_id));
    if (record.project_code) return rows.find(r => norm(r.project.project_code) === norm(record.project_code));
    const matches = rows.filter(r => record.project_title && norm(r.project.project_title) === norm(record.project_title));
    return matches.length === 1 ? matches[0] : undefined;
  }
  const categories = new Map();
  const monthly = new Map();
  let undated = 0, excluded = 0;
  const add = (key, value) => categories.set(key, (categories.get(key) || 0) + value);
  const seen = new Set();
  const selected = [];
  const hasPayroll = row => payroll.some(p => match(p) === row);
  for (const e of expenses) {
    const row = match(e);
    if (!row) { excluded++; continue; }
    const status = norm(e.validation_status || e.receipt_status || e.approval_status || e.status);
    if (status && !['validated','approved','paid','completed','accepted'].includes(status)) { excluded++; continue; }
    if (norm(e.category) === 'payroll' && hasPayroll(row)) continue;
    selected.push({ kind:'expense', record:e, row, amount:cents(e.amount), category:norm(e.category) === 'payroll' ? 'Payroll' : norm(e.category || 'Other expenses'), date:e.expense_date || e.date });
  }
  for (const p of payroll) {
    const row = match(p);
    if (row) selected.push({kind:'payroll', record:p, row, amount:cents(p.salary_amount), category:'Payroll', date:p.pay_date || p.date});
    else excluded++;
  }
  for (const item of selected) {
    const key = item.record.id ? item.kind + ':' + item.record.id : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    item.row.spending += item.amount;
    add(item.category, item.amount);
    // Never invent a transaction date from today's date or record creation time.
    const date = String(item.date || '').slice(0,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) { undated += item.amount; continue; }
    const month = date.slice(0,7);
    monthly.set(month, (monthly.get(month) || 0) + item.amount);
  }
  for (const row of rows) {
    if (row.opening) { add('Opening recorded cost', row.opening); undated += row.opening; }
    row.expected = row.contract - row.budget - row.tax;
    row.remaining = row.budget - row.spending;
    row.utilization = row.budget > 0 ? row.spending / row.budget * 100 : null;
  }
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  const totals = {contract:sum('contract'), budget:sum('budget'), tax:sum('tax'), spending:sum('spending'), expected:sum('expected')};
  totals.margin = totals.contract > 0 ? totals.expected / totals.contract * 100 : null;
  return {rows, totals, categories:[...categories], monthly:[...monthly].sort((a,b) => a[0].localeCompare(b[0])), undated, excluded};
}
