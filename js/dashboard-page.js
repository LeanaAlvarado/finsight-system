import { supabase, escapeHtml, peso, number, readTable, setText } from "./supabase.js?v=20260809-revenue-operational-label-v158";

let dashboardChart = null;
let expenseCategoryChart = null;
let dashboardLoadPromise = null;
let dashboardReloadQueued = false;
let dashboardRefreshTimer = null;
let latestCostAlerts = [];
let showingAllCostAlerts = false;
let latestDashboardProjects = [];
let latestProjectMaterials = [];

const ALERT_WARNING_THRESHOLD = 70;
const ALERT_CRITICAL_THRESHOLD = 85;
const ALERT_OVER_BUDGET_THRESHOLD = 100;
const ALERT_PREVIEW_LIMIT = 5;
const ACTIVE_ALERT_STATUSES = new Set(["Active", "Viewed"]);
const MATERIAL_PROJECT_STATUSES = new Set(["approved", "completed", "complete"]);
const LOCAL_QUOTATION_ITEMS_KEY = "lemyu_quotation_items";

function getCurrentRole() {
  return String(
    localStorage.getItem("lemyu_user_role_label")
    || localStorage.getItem("lemyu_user_role")
    || ""
  ).toLowerCase();
}

function canViewCostOverrunAlerts() {
  const role = getCurrentRole();
  if (["finance officer/accountant", "project manager/operations staff"].includes(role)) {
    return false;
  }

  return ["owner/manager", "system administrator"].includes(role);
}

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function mergeCurrentRecords(cloudRecords = [], localKey, keyFields, normalize = record => record) {
  const cloud = (cloudRecords || []).map(normalize);
  const localRecords = readLocalJson(localKey, []);
  const merged = [...cloud];

  if (!Array.isArray(localRecords)) return merged;

  localRecords.map(normalize).forEach(localRecord => {
    const matchIndex = merged.findIndex(cloudRecord => keyFields.some(field => {
      const localValue = normalizeMatchValue(localRecord?.[field]);
      const cloudValue = normalizeMatchValue(cloudRecord?.[field]);
      return localValue && cloudValue && localValue === cloudValue;
    }));

    if (matchIndex < 0) {
      merged.push(localRecord);
    }
  });

  return merged;
}

function normalizeMatchValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

function recordBelongsToProject(record = {}, project = {}) {
  const recordProjectId = normalizeMatchValue(record.project_id);
  const projectId = normalizeMatchValue(project.id);
  const recordProjectCode = normalizeMatchValue(record.project_code);
  const projectCode = normalizeMatchValue(project.project_code);
  const recordProjectTitle = normalizeMatchValue(record.project_title);
  const projectTitle = normalizeMatchValue(project.project_title);

  return (recordProjectId && projectId && recordProjectId === projectId)
    || (recordProjectCode && projectCode && recordProjectCode === projectCode)
    || (recordProjectTitle && projectTitle && recordProjectTitle === projectTitle);
}

function isValidatedProjectExpense(expense = {}) {
  const status = normalizeMatchValue(
    expense.validation_status
    || expense.receipt_status
    || expense.approval_status
    || expense.status
    || ""
  );

  if (!status) return true;
  return ["validated", "approved", "paid", "completed", "accepted"].includes(status);
}

function toTitleCase(value = "") {
  return String(value || "User")
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function addCategoryTotal(categoryTotals, category, amount) {
  const label = String(category || "Operational Expenses").trim() || "Operational Expenses";
  categoryTotals.set(label, (categoryTotals.get(label) || 0) + number(amount));
}

function isPayrollExpense(expense = {}) {
  return normalizeMatchValue(expense.category) === "payroll";
}

function getDashboardExpensePieces(expenses = [], payroll = []) {
  const nonPayrollExpenses = expenses.filter(expense => !isPayrollExpense(expense));
  const payrollExpenseFallback = payroll.length ? [] : expenses.filter(isPayrollExpense);
  const nonPayrollExpenseTotal = nonPayrollExpenses.reduce((sum, expense) => sum + number(expense.amount), 0);
  const payrollTotal = payroll.length
    ? payroll.reduce((sum, item) => sum + number(item.salary_amount), 0)
    : payrollExpenseFallback.reduce((sum, expense) => sum + number(expense.amount), 0);

  return {
    nonPayrollExpenses,
    payrollExpenseFallback,
    nonPayrollExpenseTotal,
    payrollTotal,
    operatingExpenseTotal: nonPayrollExpenseTotal + payrollTotal
  };
}

function compactPeso(value = 0) {
  const amount = number(value);
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `PHP ${(amount / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`;
  if (abs >= 1000) return `PHP ${(amount / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  return peso(amount);
}

function getProjectLabel(project) {
  return project.project_title || project.project_code || project.client_name || "Untitled Project";
}

function getProjectRecordStatus(project = {}) {
  return normalizeMatchValue(project.status || project.project_status || project.approval_status);
}

function isMaterialCountedProject(project = {}) {
  return MATERIAL_PROJECT_STATUSES.has(getProjectRecordStatus(project));
}

function getProjectQuotationType(project = {}) {
  const type = normalizeMatchValue(project.quotation_type);
  if (type === "cctv") return "cctv";
  if (type === "manpower") return "manpower";
  if (/cctv|camera|dvr|supply/.test(normalizeMatchValue(`${project.remarks || ""} ${project.project_title || ""}`))) return "cctv";
  return "manpower";
}

function getLocalQuotationItems(project = {}) {
  const records = readLocalJson(LOCAL_QUOTATION_ITEMS_KEY, {});
  return records[project.id] || records[project.project_code] || [];
}

function getProjectQuotationItems(project = {}) {
  return Array.isArray(project.quotation_items)
    ? project.quotation_items
    : getLocalQuotationItems(project);
}

function getTaxAmount(project) {
  const contract = number(project.contract_amount);
  const taxPercent = project.tax_amount === null || project.tax_amount === undefined || project.tax_amount === ""
    ? 0
    : number(project.tax_amount);

  return contract * (taxPercent / 100);
}

function getRecordDate(record = {}) {
  return record.expense_date
    || record.date
    || record.start_date
    || record.created_at
    || new Date().toISOString();
}

function getAlertTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return safeDate.toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(date) {
  return date.toLocaleDateString("en-PH", {
    month: "short"
  });
}

function getTrendMonths(projects, expenses, payroll = []) {
  const payrollDates = payroll.map(record => record.pay_date || record.date || record.created_at);
  const allDates = [
    ...projects.map(record => getRecordDate(record)),
    ...expenses.map(record => getRecordDate(record)),
    ...payrollDates
  ]
    .map(value => new Date(value))
    .filter(date => !Number.isNaN(date.getTime()));
  const endDate = allDates.length
    ? new Date(Math.max(...allDates.map(date => date.getTime())))
    : new Date();
  const months = [];

  endDate.setDate(1);

  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(endDate.getFullYear(), endDate.getMonth() - index, 1);
    months.push({
      key: getMonthKey(date),
      label: getMonthLabel(date)
    });
  }

  return months;
}

function getMonthlyTrend(projects, expenses, payroll = []) {
  const months = getTrendMonths(projects, expenses, payroll);
  const revenueByMonth = new Map(months.map(month => [month.key, 0]));
  const expensesByMonth = new Map(months.map(month => [month.key, 0]));
  const expensePieces = getDashboardExpensePieces(expenses, payroll);

  projects.forEach(project => {
    const date = new Date(getRecordDate(project));
    const key = getMonthKey(date);
    if (revenueByMonth.has(key)) {
      revenueByMonth.set(key, revenueByMonth.get(key) + number(project.contract_amount));
    }
  });

  [...expensePieces.nonPayrollExpenses, ...expensePieces.payrollExpenseFallback].forEach(expense => {
    const date = new Date(getRecordDate(expense));
    const key = getMonthKey(date);
    if (expensesByMonth.has(key)) {
      expensesByMonth.set(key, expensesByMonth.get(key) + number(expense.amount));
    }
  });

  payroll.forEach(item => {
    const date = new Date(item.pay_date || item.date || item.created_at || new Date());
    const key = getMonthKey(date);
    if (expensesByMonth.has(key)) {
      expensesByMonth.set(key, expensesByMonth.get(key) + number(item.salary_amount));
    }
  });

  return {
    labels: months.map(month => month.label),
    revenue: months.map(month => revenueByMonth.get(month.key)),
    expenses: months.map(month => expensesByMonth.get(month.key))
  };
}

function getTrendTotals(trend) {
  const revenue = trend.revenue.reduce((sum, value) => sum + number(value), 0);
  const expenses = trend.expenses.reduce((sum, value) => sum + number(value), 0);
  return {
    revenue,
    expenses,
    net: revenue - expenses,
    netByPeriod: trend.revenue.map((value, index) => number(value) - number(trend.expenses[index]))
  };
}

function showDashboardUser() {
  const accountName = localStorage.getItem("lemyu_user_name")
    || localStorage.getItem("lemyu_username")
    || localStorage.getItem("lemyu_user_email")
    || "User";
  const role = localStorage.getItem("lemyu_user_role_label")
    || localStorage.getItem("lemyu_user_role")
    || "User";

  setText("dashboardUsername", toTitleCase(accountName));
  setText("dashboardRole", toTitleCase(role));
}

function getProjectAnalytics(projects, expenses, payroll, inventory) {
  const hasPayrollRecords = payroll.length > 0;
  return projects.map(project => {
    const revenue = number(project.contract_amount);
    const budget = number(project.project_budget);
    const tax = getTaxAmount(project);
    const expenseTotal = expenses
      .filter(expense => recordBelongsToProject(expense, project) && !isPayrollExpense(expense))
      .reduce((sum, expense) => sum + number(expense.amount), 0);
    const payrollTotal = hasPayrollRecords
      ? payroll
        .filter(item => recordBelongsToProject(item, project))
        .reduce((sum, item) => sum + number(item.salary_amount), 0)
      : expenses
        .filter(expense => recordBelongsToProject(expense, project) && isPayrollExpense(expense))
        .reduce((sum, expense) => sum + number(expense.amount), 0);
    const materialTotal = inventory
      .filter(item => recordBelongsToProject(item, project))
      .reduce((sum, item) => sum + (number(item.qty) * number(item.price)), 0);
    const actualBudgetSpend = expenseTotal + payrollTotal;
    const budgetOverrun = budget > 0 ? Math.max(actualBudgetSpend - budget, 0) : actualBudgetSpend;
    const budgetRemaining = budget > 0 ? Math.max(budget - actualBudgetSpend, 0) : 0;
    const budgetUtilization = budget > 0 ? (actualBudgetSpend / budget) * 100 : 0;
    const appliedMaterialCost = budget > 0 ? 0 : materialTotal;
    const totalCost = budget + tax + appliedMaterialCost;
    const profit = revenue - totalCost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const costRatio = revenue > 0 ? (totalCost / revenue) * 100 : 0;

    return {
      project,
      label: getProjectLabel(project),
      revenue,
      budget,
      tax,
      expenseTotal,
      payrollTotal,
      materialTotal,
      actualBudgetSpend,
      budgetOverrun,
      budgetRemaining,
      budgetUtilization,
      appliedMaterialCost,
      totalCost,
      profit,
      margin,
      costRatio
    };
  });
}

function getBudgetStatusInfo(analysis = {}) {
  if (analysis.remainingBudget < 0 || analysis.budgetUtilization > ALERT_OVER_BUDGET_THRESHOLD) {
    return { label: "Over Budget", className: "over-budget" };
  }

  if (analysis.budgetUtilization >= ALERT_CRITICAL_THRESHOLD) {
    return { label: "Critical", className: "critical" };
  }

  if (analysis.budgetUtilization >= ALERT_WARNING_THRESHOLD) {
    return { label: "Warning", className: "warning" };
  }

  return { label: "Safe", className: "safe" };
}

function getProjectStatus(analysis) {
  return getBudgetStatusInfo(analysis).label;
}

function renderProfitabilityTable(projectAnalytics) {
  const table = document.getElementById("profitabilityTable");
  if (!table) return;

  const rankedProjects = [...projectAnalytics]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 6);

  if (!rankedProjects.length) {
    table.innerHTML = `<tr><td colspan="7" style="text-align:center;">No project records available for BI ranking.</td></tr>`;
    return;
  }

  table.innerHTML = rankedProjects.map((item, index) => {
    const status = getBudgetStatusInfo(item);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.label)}</td>
        <td>${peso(item.revenue)}</td>
        <td>${peso(item.totalCost)}</td>
        <td class="${item.profit >= 0 ? "good" : "bad"}">${peso(item.profit)}</td>
        <td>${item.margin.toFixed(2)}%</td>
        <td><span class="bi-status ${status.className}">${status.label}</span></td>
      </tr>
    `;
  }).join("");
}

function renderTopProfitabilityList(projectAnalytics) {
  const list = document.getElementById("topProfitabilityList");
  if (!list) return;

  const rankedProjects = [...projectAnalytics]
    .filter(item => item.revenue > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);
  const maxProfit = Math.max(...rankedProjects.map(item => Math.max(item.profit, 0)), 1);

  if (!rankedProjects.length) {
    list.innerHTML = `<div class="category-breakdown-empty">No profitability records available.</div>`;
    return;
  }

  list.innerHTML = rankedProjects.map(item => {
    const width = Math.max((Math.max(item.profit, 0) / maxProfit) * 100, 4);
    return `
      <div class="compact-profit-row">
        <div class="compact-profit-name">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${peso(item.profit)}</span>
        </div>
        <div class="compact-profit-bar">
          <span style="width:${width.toFixed(2)}%"></span>
        </div>
        <div class="compact-profit-margin">${item.margin.toFixed(1)}%</div>
      </div>
    `;
  }).join("");
}

function getInventoryProjectLabel(projects, projectCode = "") {
  const normalizedCode = normalizeMatchValue(projectCode);
  const project = projects.find(item => normalizeMatchValue(item.project_code) === normalizedCode);
  return project ? getProjectLabel(project) : projectCode;
}

function getProjectLinkedMaterials(inventory = []) {
  return inventory.filter(item => String(item.project_code || "").trim());
}

function getInventoryMaterialCost(item = {}) {
  const savedTotal = number(item.total_amount || item.line_total);
  if (savedTotal > 0) return savedTotal;
  return number(item.qty ?? item.quantity) * number(item.price ?? item.unit_price ?? item.amount);
}

function normalizeQuotationMaterial(project = {}, item = {}, index = 0) {
  const qty = number(item.qty ?? item.quantity ?? 1);
  const savedTotal = number(item.total_amount || item.line_total);
  const price = savedTotal && qty
    ? savedTotal / qty
    : number(item.price ?? item.unit_price ?? item.unitPrice ?? item.amount);

  return {
    id: item.id || `${project.id || project.project_code || "project"}-material-${index}`,
    project_id: project.id || "",
    project_code: project.project_code || "",
    project_title: project.project_title || "",
    name: item.name || item.material_name || item.description || "CCTV Material",
    description: item.details || item.description || "",
    qty,
    unit: item.unit || "",
    price,
    total_amount: savedTotal || (qty * price),
    is_project_material: true
  };
}

function getApprovedCompletedCctvQuotationMaterials(projects = [], inventory = []) {
  return projects
    .filter(project => isMaterialCountedProject(project) && getProjectQuotationType(project) === "cctv")
    .flatMap(project => {
      const quotationItems = getProjectQuotationItems(project)
        .map((item, index) => normalizeQuotationMaterial(project, item, index))
        .filter(item => item.name || item.description || item.total_amount || item.qty);

      if (quotationItems.length) return quotationItems;

      return getProjectLinkedMaterials(inventory)
        .filter(material => recordBelongsToProject(material, project))
        .map((item, index) => normalizeQuotationMaterial(project, item, index));
    });
}

function renderInventoryProjectList(projects, inventory) {
  const list = document.getElementById("inventoryProjectList");
  if (!list) return;

  const totals = new Map();

  getProjectLinkedMaterials(inventory).forEach(item => {
    const projectCode = String(item.project_code || "").trim();
    totals.set(projectCode, (totals.get(projectCode) || 0) + getInventoryMaterialCost(item));
  });

  const rankedProjects = [...totals.entries()]
    .map(([projectCode, total]) => ({
      label: getInventoryProjectLabel(projects, projectCode),
      total
    }))
    .filter(item => item.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  if (!rankedProjects.length) {
    list.innerHTML = `<span class="inventory-project-empty">No approved/completed project materials.</span>`;
    return;
  }

  list.innerHTML = rankedProjects.map(item => `
    <div class="inventory-project-row">
      <span>${escapeHtml(item.label)}</span>
      <strong>${peso(item.total)}</strong>
    </div>
  `).join("");
}

function getProjectMaterialsGroupedReport(projects = latestDashboardProjects, materials = latestProjectMaterials) {
  const groups = new Map();

  materials.forEach(material => {
    const projectCode = String(material.project_code || "").trim();
    const project = projects.find(item => recordBelongsToProject(material, item))
      || projects.find(item => normalizeMatchValue(item.project_code) === normalizeMatchValue(projectCode))
      || {};
    const key = project.id || project.project_code || projectCode || "unassigned";
    const current = groups.get(key) || {
      project,
      projectCode: project.project_code || projectCode || "-",
      projectTitle: getProjectLabel(project) || material.project_title || "Untitled CCTV Project",
      clientName: project.client_name || "-",
      status: project.status || "-",
      items: [],
      total: 0
    };
    const itemTotal = getInventoryMaterialCost(material);

    current.items.push({
      ...material,
      total: itemTotal
    });
    current.total += itemTotal;
    groups.set(key, current);
  });

  return [...groups.values()].sort((a, b) => b.total - a.total);
}

window.generateProjectMaterialsReport = function() {
  const groups = getProjectMaterialsGroupedReport();
  const totalRecords = latestProjectMaterials.length;
  const totalCost = latestProjectMaterials.reduce((sum, item) => sum + getInventoryMaterialCost(item), 0);
  const generatedDate = new Date();
  const reportWindow = window.open("", "_blank");

  if (!reportWindow) {
    alert("Please allow pop-ups to generate the Project Materials report.");
    return;
  }

  const projectSections = groups.length
    ? groups.map(group => `
      <section class="report-project">
        <div class="project-head">
          <div>
            <small>${escapeHtml(group.projectCode)}</small>
            <h2>${escapeHtml(group.projectTitle)}</h2>
            <p>Client: ${escapeHtml(group.clientName)} | Status: ${escapeHtml(group.status)}</p>
          </div>
          <strong>${peso(group.total)}</strong>
        </div>
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Unit Price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${group.items.map(item => `
              <tr>
                <td>${escapeHtml(item.name || "CCTV Material")}</td>
                <td>${escapeHtml(item.description || "-")}</td>
                <td>${number(item.qty)}</td>
                <td>${escapeHtml(item.unit || "-")}</td>
                <td>${peso(item.price)}</td>
                <td>${peso(item.total)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    `).join("")
    : `<div class="empty-report">No approved/completed CCTV project materials available.</div>`;

  reportWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Project_Materials_Report_${generatedDate.toISOString().slice(0, 10)}</title>
      <style>
        body{font-family:Arial,sans-serif;color:#071f3d;margin:0;background:#f4f7fb;}
        .report-page{max-width:960px;margin:0 auto;padding:28px;background:#fff;min-height:100vh;}
        .report-top{display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #0f5f66;padding-bottom:16px;margin-bottom:18px;}
        .report-top small,.metric small,.project-head small{display:block;color:#51657d;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;}
        h1{margin:4px 0 6px;font-size:24px;}
        h2{margin:4px 0 6px;font-size:16px;}
        p{margin:0;color:#42566f;font-size:12px;line-height:1.45;}
        .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0;}
        .metric{border:1px solid #c9d7e6;border-radius:6px;padding:12px;background:#f8fbff;}
        .metric strong{display:block;margin-top:6px;font-size:18px;}
        .report-project{border:1px solid #c9d7e6;border-radius:8px;margin-top:14px;overflow:hidden;}
        .project-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;background:#eef4fa;padding:12px 14px;}
        .project-head strong{font-size:15px;white-space:nowrap;}
        table{width:100%;border-collapse:collapse;font-size:11px;}
        th,td{border-top:1px solid #d9e3ee;padding:8px;text-align:left;vertical-align:top;}
        th{background:#0f5f66;color:#fff;text-transform:uppercase;font-size:10px;letter-spacing:.04em;}
        td:nth-child(3),td:nth-child(5),td:nth-child(6){text-align:right;white-space:nowrap;}
        .empty-report{border:1px solid #c9d7e6;border-radius:8px;padding:18px;text-align:center;color:#51657d;}
        .actions{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;background:#fff;padding:10px 0;margin-bottom:8px;}
        button{border:0;border-radius:5px;background:#1f4e79;color:#fff;font-weight:800;padding:9px 14px;cursor:pointer;}
        .secondary{background:#eef4fa;color:#1f4e79;border:1px solid #c9d7e6;}
        @media print{body{background:#fff}.actions{display:none}.report-page{max-width:none;padding:18mm}.report-project{break-inside:avoid;page-break-inside:avoid;}}
      </style>
    </head>
    <body>
      <main class="report-page">
        <div class="actions">
          <button type="button" class="secondary" onclick="window.close()">Back</button>
          <button type="button" onclick="window.print()">Print / Save PDF</button>
        </div>
        <header class="report-top">
          <div>
            <small>LEMYU Fiber Optic Installation and Services</small>
            <h1>Project Materials Report</h1>
            <p>Approved and completed CCTV quotation material usage from the FinSight dashboard.</p>
          </div>
          <p>Generated: ${escapeHtml(generatedDate.toLocaleString("en-PH"))}</p>
        </header>
        <section class="metrics">
          <div class="metric"><small>CCTV Projects</small><strong>${groups.length}</strong></div>
          <div class="metric"><small>Material Records</small><strong>${totalRecords}</strong></div>
          <div class="metric"><small>Total Material Cost</small><strong>${peso(totalCost)}</strong></div>
        </section>
        ${projectSections}
      </main>
    </body>
    </html>
  `);
  reportWindow.document.close();
};

function getProjectActualExpenses(project, expenses = [], payroll = []) {
  const linkedExpenses = expenses
    .filter(expense => recordBelongsToProject(expense, project))
    .filter(expense => payroll.length === 0 || normalizeMatchValue(expense.category) !== "payroll")
    .filter(isValidatedProjectExpense);
  const linkedPayroll = payroll
    .filter(item => recordBelongsToProject(item, project))
    .map(item => ({
      id: item.id,
      project_id: item.project_id,
      project_code: item.project_code,
      category: "Payroll",
      amount: item.salary_amount,
      date: item.pay_date,
      description: item.description || item.payroll_description || item.employee_name
    }));

  const uniqueExpenses = new Map();

  [...linkedExpenses, ...linkedPayroll].forEach((expense, index) => {
    const key = expense.id
      || [
        expense.project_id,
        expense.project_code,
        expense.category,
        expense.amount,
        expense.date || expense.expense_date,
        expense.description
      ].map(value => String(value || "").trim()).join("|")
      || `expense-${index}`;

    if (!uniqueExpenses.has(key)) {
      uniqueExpenses.set(key, expense);
    }
  });

  return [...uniqueExpenses.values()]
    .reduce((sum, expense) => sum + Math.max(number(expense.amount), 0), Math.max(number(project.initial_actual_cost), 0));
}

function getAlertSeverity(utilization) {
  if (utilization > ALERT_OVER_BUDGET_THRESHOLD) return "Over Budget";
  if (utilization >= ALERT_CRITICAL_THRESHOLD) return "Critical";
  if (utilization >= ALERT_WARNING_THRESHOLD) return "Warning";
  return "";
}

function getCostAlertSortRank(alert) {
  if (alert.severity === "Over Budget") return 0;
  if (alert.exceededAmount > 0) return 0;
  if (alert.utilization >= ALERT_CRITICAL_THRESHOLD) return 1;
  return 2;
}

function buildCostOverrunAlerts(projects, expenses, savedAlerts = [], payroll = []) {
  const savedByProjectSeverity = new Map(
    savedAlerts.map(alert => [`${alert.project_id}|${alert.severity}`, alert])
  );

  return projects
    .map(project => {
      const budget = Math.max(number(project.project_budget), 0);
      if (budget <= 0) return null;

      const projectIdentifier = String(project.id || project.project_code || getProjectLabel(project)).trim();
      if (!projectIdentifier) return null;

      const actualExpenses = getProjectActualExpenses(project, expenses, payroll);
      const utilization = (actualExpenses / budget) * 100;
      const severity = getAlertSeverity(utilization);
      if (!severity) return null;

      const exceededAmount = Math.max(actualExpenses - budget, 0);
      const remainingAmount = Math.max(budget - actualExpenses, 0);
      const savedAlert = savedByProjectSeverity.get(`${project.id}|${severity}`) || {};

      return {
        id: savedAlert.id || `${projectIdentifier}-${severity.toLowerCase()}`,
        projectId: projectIdentifier,
        projectCode: project.project_code || "",
        projectName: getProjectLabel(project),
        budget,
        actualExpenses,
        utilization,
        exceededAmount,
        remainingAmount,
        severity,
        status: savedAlert.status || "Active",
        createdAt: savedAlert.created_at || savedAlert.createdAt || new Date().toISOString(),
        message: exceededAmount > 0
          ? `${getProjectLabel(project)} has exceeded its allocated contract budget by ${peso(exceededAmount)}.`
          : `${getProjectLabel(project)} has already utilized ${utilization.toFixed(0)}% of its allocated contract budget.`
      };
    })
    .filter(Boolean)
    .sort((a, b) => getAlertSortRank(a) - getAlertSortRank(b) || b.utilization - a.utilization);
}

function getAlertSortRank(alert) {
  return getCostAlertSortRank(alert);
}

function getStatusClassName(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function renderAlertStatusBadge(severity) {
  return `<span class="cost-alert-badge ${getStatusClassName(severity)}">${severity}</span>`;
}

function renderCostAlerts(alerts) {
  const list = document.getElementById("costAlertList");
  if (!list) return;

  const alertPanel = document.querySelector(".alerts-panel");
  if (alertPanel) alertPanel.hidden = !canViewCostOverrunAlerts();
  if (!canViewCostOverrunAlerts()) return;

  if (!alerts.length) {
    list.innerHTML = `
      <div class="alert-item good-alert">
        <strong>No budget limit alert detected</strong>
        <span>All monitored projects are below 70% contract budget utilization.</span>
      </div>
    `;
    document.getElementById("viewAllCostAlerts")?.setAttribute("hidden", "");
    return;
  }

  const visibleAlerts = showingAllCostAlerts ? alerts : alerts.slice(0, ALERT_PREVIEW_LIMIT);
  const viewAllButton = document.getElementById("viewAllCostAlerts");

  if (viewAllButton) {
    viewAllButton.hidden = alerts.length <= ALERT_PREVIEW_LIMIT;
    viewAllButton.textContent = showingAllCostAlerts ? "Show preview" : `View all alerts (${alerts.length})`;
  }

  list.innerHTML = visibleAlerts.map(alert => {
    const amountLabel = alert.exceededAmount > 0
      ? `Exceeded by ${peso(alert.exceededAmount)}`
      : `${peso(alert.remainingAmount)} remaining`;
    const progress = Math.min(alert.utilization, 140);

    return `
      <div class="cost-alert-card ${getStatusClassName(alert.severity)}">
        <div class="cost-alert-top">
          <strong>${escapeHtml(alert.projectName)}</strong>
          ${renderAlertStatusBadge(alert.severity)}
        </div>
        <div class="cost-alert-progress" aria-label="${escapeHtml(alert.projectName)} budget utilization ${alert.utilization.toFixed(2)} percent">
          <span style="width:${Math.min(progress, 100).toFixed(2)}%"></span>
        </div>
        <div class="cost-alert-grid">
          <span><small>Contract Budget</small><strong>${peso(alert.budget)}</strong></span>
          <span><small>Budget Used</small><strong>${peso(alert.actualExpenses)}</strong></span>
          <span><small>${alert.exceededAmount > 0 ? "Exceeded Amount" : "Remaining Budget"}</small><strong>${amountLabel}</strong></span>
          <span><small>Utilization</small><strong>${alert.utilization.toFixed(2)}%</strong></span>
        </div>
        <button type="button" class="small-action-btn" onclick="viewCostAlert('${escapeHtml(alert.id)}', '${escapeHtml(alert.projectId)}')">View Details</button>
      </div>
    `;
  }).join("");
}

function renderCostAlertNotifications(alerts) {
  const wrapper = document.getElementById("costAlertNotification");
  const badge = document.getElementById("costAlertBadge");
  const dropdownCount = document.getElementById("costAlertDropdownCount");
  const dropdownList = document.getElementById("costAlertDropdownList");

  if (!wrapper || !badge || !dropdownList) return;

  const allowed = canViewCostOverrunAlerts();
  wrapper.hidden = !allowed;
  if (!allowed) return;

  const activeAlerts = alerts.filter(alert => ACTIVE_ALERT_STATUSES.has(alert.status || "Active"));
  badge.hidden = !activeAlerts.length;
  badge.textContent = activeAlerts.length;
  if (dropdownCount) {
    dropdownCount.textContent = `${activeAlerts.length} active`;
  }

  if (!activeAlerts.length) {
    dropdownList.innerHTML = `<div class="notification-empty">No active cost overrun alerts.</div>`;
    return;
  }

  dropdownList.innerHTML = activeAlerts.map(alert => {
    const amountLabel = alert.exceededAmount > 0
      ? `Exceeded by ${peso(alert.exceededAmount)}`
      : `${peso(alert.remainingAmount)} remaining`;

    return `
      <div class="notification-item ${alert.severity.toLowerCase()}">
        <div class="notification-item-head">
          <strong>${escapeHtml(alert.projectName)}</strong>
          ${renderAlertStatusBadge(alert.severity)}
        </div>
        <p>${escapeHtml(alert.message)}</p>
        <div class="notification-meta">
          <span>Budget: ${peso(alert.budget)}</span>
          <span>Actual: ${peso(alert.actualExpenses)}</span>
          <span>${amountLabel}</span>
          <span>${alert.utilization.toFixed(2)}% used</span>
          <span>Generated: ${getAlertTimestamp(alert.createdAt)}</span>
        </div>
        <button type="button" class="small-action-btn" onclick="viewCostAlert('${escapeHtml(alert.id)}', '${escapeHtml(alert.projectId)}')">View Project</button>
      </div>
    `;
  }).join("");
}

async function writeCostAlertAudit(action, alert, details = "") {
  try {
    await supabase.from("cloud_sync_audit").insert([{
      source_key: `cost_overrun_alert:${action}:${alert.projectId || alert.project_id || ""}:${alert.severity || ""}`,
      synced_count: 1,
      error_count: 0
    }]);
  } catch (error) {
    console.warn(`Cost alert audit not saved (${details || action}).`, error);
  }
}

function buildAlertRecord(alert, status = alert.status || "Active") {
  return {
    project_id: alert.projectId,
    alert_type: "budget_utilization",
    severity: alert.severity,
    budget_amount: alert.budget,
    actual_expenses: alert.actualExpenses,
    utilization_percentage: Number(alert.utilization.toFixed(2)),
    exceeded_amount: alert.exceededAmount,
    status
  };
}

async function syncCostOverrunAlerts(currentAlerts, savedAlerts = []) {
  if (!canViewCostOverrunAlerts()) return currentAlerts;

  const savedActive = savedAlerts.filter(alert => ACTIVE_ALERT_STATUSES.has(alert.status || "Active"));
  const currentKeys = new Set(currentAlerts.map(alert => `${alert.projectId}|${alert.severity}`));
  const syncedAlerts = [];

  for (const alert of currentAlerts) {
    const existing = savedActive.find(item =>
      String(item.project_id || "") === String(alert.projectId || "")
      && String(item.severity || "") === String(alert.severity || "")
    );

    if (existing?.id) {
      const record = {
        ...buildAlertRecord(alert, existing.status || "Active"),
        resolved_at: null
      };
      const { data, error } = await supabase
        .from("cost_overrun_alerts")
        .update(record)
        .eq("id", existing.id)
        .select("*")
        .single();

      if (!error && data) {
        syncedAlerts.push({ ...alert, id: data.id, status: data.status, createdAt: data.created_at });
      } else {
        syncedAlerts.push(alert);
      }
      continue;
    }

    const { data, error } = await supabase
      .from("cost_overrun_alerts")
      .insert([buildAlertRecord(alert)])
      .select("*")
      .single();

    if (!error && data) {
      await writeCostAlertAudit("generated", alert);
      syncedAlerts.push({ ...alert, id: data.id, status: data.status, createdAt: data.created_at });
    } else {
      console.warn("Cost overrun alert was not saved:", error?.message || error);
      syncedAlerts.push(alert);
    }
  }

  for (const savedAlert of savedActive) {
    const key = `${savedAlert.project_id}|${savedAlert.severity}`;
    if (currentKeys.has(key)) continue;

    const { error } = await supabase
      .from("cost_overrun_alerts")
      .update({
        status: "Resolved",
        resolved_at: new Date().toISOString()
      })
      .eq("id", savedAlert.id);

    if (!error) {
      await writeCostAlertAudit("resolved", {
        projectId: savedAlert.project_id,
        severity: savedAlert.severity
      });
      await writeCostAlertAudit("budget_or_expense_corrected", {
        projectId: savedAlert.project_id,
        severity: savedAlert.severity
      });
    }
  }

  return syncedAlerts.length ? syncedAlerts : currentAlerts;
}

async function loadSavedCostAlerts() {
  const { data = [], error } = await supabase
    .from("cost_overrun_alerts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Cost overrun alert table is not available yet. Run the SQL migration.", error.message || error);
    return [];
  }

  return data || [];
}

async function markCostAlertViewed(alertId) {
  if (!alertId || String(alertId).includes("-warning") || String(alertId).includes("-critical")) return;

  const { error } = await supabase
    .from("cost_overrun_alerts")
    .update({
      status: "Viewed",
      viewed_at: new Date().toISOString()
    })
    .eq("id", alertId)
    .in("status", ["Active", "Viewed"]);

  if (!error) {
    const alert = latestCostAlerts.find(item => String(item.id) === String(alertId));
    if (alert) {
      alert.status = "Viewed";
      await writeCostAlertAudit("viewed", alert);
    }
  }
}

function renderBusinessInsights(projectAnalytics, categoryTotals, totals) {
  const list = document.getElementById("businessInsightList");
  if (!list) return;

  const sortedProjects = [...projectAnalytics].sort((a, b) => b.profit - a.profit);
  const bestProject = sortedProjects[0];
  const lowestProject = [...projectAnalytics].sort((a, b) => a.margin - b.margin)[0];
  const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const riskCount = projectAnalytics.filter(item => getBudgetStatusInfo(item).label !== "Safe").length;
  const insights = [];

  if (bestProject) {
    insights.push({
      title: "Highest project contribution",
      text: `${bestProject.label} currently leads with ${peso(bestProject.profit)} net profit.`
    });
  }

  if (topCategory) {
    insights.push({
      title: "Largest cost driver",
      text: `${topCategory[0]} accounts for ${peso(topCategory[1])} of recorded costs.`
    });
  }

  if (lowestProject && lowestProject.revenue > 0) {
    insights.push({
      title: "Lowest margin project",
      text: `${lowestProject.label} has a ${lowestProject.margin.toFixed(2)}% margin and should be reviewed.`
    });
  }

  insights.push({
    title: "Portfolio risk",
    text: riskCount
      ? `${riskCount} project${riskCount === 1 ? "" : "s"} are near or above the contract budget limit.`
      : "No project is currently near its contract budget limit."
  });

  if (totals.revenue > 0) {
    insights.push({
      title: "Overall profitability",
      text: `The overall profit margin is ${((totals.profit / totals.revenue) * 100).toFixed(2)}%.`
    });
  }

  list.innerHTML = insights.map(item => `
    <div class="insight-item">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.text)}</span>
    </div>
  `).join("");
}

function renderExpenseCategoryChart(categoryTotals) {
  const chartCanvas = document.getElementById("expenseCategoryChart");
  if (!chartCanvas || !window.Chart) return;

  const entries = [...categoryTotals.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (expenseCategoryChart) {
    expenseCategoryChart.destroy();
  }

  expenseCategoryChart = new Chart(chartCanvas, {
    type: "doughnut",
    data: {
      labels: entries.length ? entries.map(([label]) => label) : ["No Expenses"],
      datasets: [{
        data: entries.length ? entries.map(([, value]) => value) : [1],
        backgroundColor: entries.length > 1
          ? ["#1f4e79", "#b42318", "#18864b", "#b7791f", "#475569", "#7c3aed"]
          : ["#1f4e79"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      cutout: "62%"
    }
  });
}

function renderCategoryBreakdownList(categoryTotals) {
  const list = document.getElementById("categoryBreakdownList");
  if (!list) return;

  const entries = [...categoryTotals.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  setText("categoryCostTotal", peso(total));

  if (!entries.length) {
    list.innerHTML = `
      <div class="category-breakdown-empty">
        No categorized expenses available.
      </div>
    `;
    return;
  }

  list.innerHTML = entries.map(([label, value]) => {
    const percent = total > 0 ? (value / total) * 100 : 0;
    return `
      <div class="category-breakdown-item">
        <div class="category-breakdown-top">
          <strong>${escapeHtml(label)}</strong>
          <span>${peso(value)}</span>
        </div>
        <div class="category-progress" aria-label="${escapeHtml(label)} ${percent.toFixed(2)} percent">
          <span style="width:${Math.max(percent, 4).toFixed(2)}%"></span>
        </div>
        <small>${percent.toFixed(2)}% of categorized cost</small>
      </div>
    `;
  }).join("");
}

function renderBusinessIntelligence(projects, expenses, payroll, projectMaterials, revenue, costAlerts = []) {
  const expensePieces = getDashboardExpensePieces(expenses, payroll);
  const payrollTotal = expensePieces.payrollTotal;
  const projectMaterialCost = projectMaterials.reduce((sum, item) => sum + getInventoryMaterialCost(item), 0);
  const projectAnalytics = getProjectAnalytics(projects, expenses, payroll, projectMaterials);
  const categoryTotals = new Map();

  expensePieces.nonPayrollExpenses.forEach(expense => addCategoryTotal(categoryTotals, expense.category, expense.amount));
  if (payrollTotal > 0) addCategoryTotal(categoryTotals, "Payroll", payrollTotal);
  if (projectMaterialCost > 0) addCategoryTotal(categoryTotals, "Project Materials", projectMaterialCost);

  const totalProjectCost = projectAnalytics.reduce((sum, item) => sum + item.totalCost, 0);
  const profit = revenue - totalProjectCost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const riskCount = projectAnalytics.filter(item => getBudgetStatusInfo(item).label !== "Safe").length;
  const overBudgetCount = projectAnalytics.filter(item => getBudgetStatusInfo(item).label === "Over Budget").length;
  const totalRemainingBudget = projectAnalytics.reduce((sum, item) => sum + number(item.remainingBudget), 0);
  const averageBudgetUtilization = projectAnalytics.length
    ? projectAnalytics.reduce((sum, item) => sum + number(item.budgetUtilization), 0) / projectAnalytics.length
    : 0;

  setText("profitMargin", `${margin.toFixed(2)}%`);
  setText("riskProjectCount", riskCount);
  setText("bestProjectProfit", peso(totalRemainingBudget));
  setText("bestProjectName", "Across monitored projects.");
  setText("topCostDriver", `${averageBudgetUtilization.toFixed(2)}%`);
  setText("topCostDriverAmount", `${overBudgetCount} over budget`);

  renderExpenseCategoryChart(categoryTotals);
  renderCategoryBreakdownList(categoryTotals);
  renderProfitabilityTable(projectAnalytics);
  renderTopProfitabilityList(projectAnalytics);
  renderInventoryProjectList(projects, projectMaterials);
  renderCostAlerts(costAlerts);
  renderCostAlertNotifications(costAlerts);
  renderBusinessInsights(projectAnalytics, categoryTotals, {
    revenue,
    profit
  });
}

async function loadDashboard(){
  const [projectResult, expenseResult, payrollResult, inventoryResult] = await Promise.all([
    readTable("projects"),
    readTable("expenses"),
    readTable("payroll"),
    readTable("inventory")
  ]);

  const fallbackProjects = readLocalJson("lemyu_saved_projects", []);
  if (projectResult.error && !fallbackProjects.length) {
    setText("netProfit", "Connection error");
    console.error(projectResult.error);
    return;
  }

  if (expenseResult.error) {
    console.warn("Dashboard loaded without expense records.", expenseResult.error);
  }

  const projects = mergeCurrentRecords(
    projectResult.error ? [] : projectResult.data,
    "lemyu_saved_projects",
    ["id", "project_code"]
  );
  const expenses = expenseResult.error ? [] : (expenseResult.data || []);
  const payroll = payrollResult.error ? [] : payrollResult.data;
  const inventory = mergeCurrentRecords(
    inventoryResult.error ? [] : inventoryResult.data,
    "lemyu_saved_inventory",
    ["id"],
    item => ({
      ...item,
      material_name: item.material_name || item.name || item.description || "Unnamed Material",
      name: item.name || item.material_name || item.description || "Unnamed Material"
    })
  );

  if (payrollResult.error || inventoryResult.error) {
    console.warn("Dashboard BI loaded without optional payroll or inventory records.", payrollResult.error || inventoryResult.error);
  }

  const savedCostAlerts = canViewCostOverrunAlerts() ? await loadSavedCostAlerts() : [];
  latestCostAlerts = canViewCostOverrunAlerts()
    ? await syncCostOverrunAlerts(buildCostOverrunAlerts(projects, expenses, savedCostAlerts, payroll), savedCostAlerts)
    : [];

  const revenue = projects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const projectMaterials = getApprovedCompletedCctvQuotationMaterials(projects, inventory);
  const projectMaterialCost = projectMaterials.reduce((sum, item) => sum + getInventoryMaterialCost(item), 0);
  const projectAnalytics = getProjectAnalytics(projects, expenses, payroll, projectMaterials);
  latestDashboardProjects = projects;
  latestProjectMaterials = projectMaterials;
  const totalCost = projectAnalytics.reduce((sum, item) => sum + number(item.totalCost), 0);
  const profit = revenue - totalCost;

  setText("totalRevenue", peso(revenue));
  setText("totalExpenses", peso(totalCost));
  setText("netProfit", peso(profit));
  setText("projectCount", projects.length);
  setText("inventoryValue", projectMaterials.length);
  setText("inventoryCount", projectMaterials.length);
  setText("inventoryPanelValue", peso(projectMaterialCost));
  setText("inventoryPanelCount", projectMaterials.length);
  setText("projectMini", projects.length);
  setText("revenueSmall", peso(revenue));
  setText("expenseSmall", peso(totalCost));
  setText("profitSmall", peso(profit));

  if (dashboardChart) {
    dashboardChart.destroy();
  }

  const trend = getMonthlyTrend(projects, expenses, payroll);
  const trendTotals = getTrendTotals(trend);
  setText("chartRevenueTotal", peso(trendTotals.revenue));
  setText("chartExpenseTotal", peso(trendTotals.expenses));
  setText("chartNetTotal", peso(trendTotals.net));

  dashboardChart = new Chart(document.getElementById("salesChart"), {
    type: "bar",
    data: {
      labels: trend.labels,
      datasets: [
        {
          label: "Revenue",
          data: trend.revenue,
          borderColor: "#1f4e79",
          backgroundColor: "rgba(31,78,121,.72)",
          borderRadius: 5,
          borderWidth: 1,
          maxBarThickness: 34
        },
        {
          label: "Expenses",
          data: trend.expenses,
          borderColor: "#9f3a35",
          backgroundColor: "rgba(159,58,53,.68)",
          borderRadius: 5,
          borderWidth: 1,
          maxBarThickness: 34
        },
        {
          type: "line",
          label: "Net Result",
          data: trendTotals.netByPeriod,
          borderColor: "#0f766e",
          backgroundColor: "#0f766e",
          fill: false,
          tension: .38,
          pointRadius: 4,
          pointHoverRadius: 5,
          borderWidth: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          position: "top",
          labels: {
            usePointStyle: true,
            boxWidth: 9,
            color: "#24364b",
            font: {
              size: 11,
              weight: "700"
            }
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${peso(context.parsed.y || 0)}`;
            },
            afterBody(items) {
              const revenueItem = items.find(item => item.dataset.label === "Revenue");
              const expenseItem = items.find(item => item.dataset.label === "Expenses");
              if (!revenueItem || !expenseItem) return "";
              const net = number(revenueItem.parsed.y) - number(expenseItem.parsed.y);
              return `Net explanation: ${peso(net)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Amount in Philippine Peso",
            color: "#51657d",
            font: {
              size: 11,
              weight: "700"
            }
          },
          grid: {
            color: "rgba(101,115,134,.16)"
          },
          ticks: {
            color: "#657386",
            callback(value) {
              return compactPeso(value);
            }
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: "#657386",
            font: {
              weight: "700"
            }
          }
        }
      }
    }
  });

  renderBusinessIntelligence(projects, expenses, payroll, projectMaterials, revenue, latestCostAlerts);
}

function refreshDashboardNow() {
  if (dashboardLoadPromise) {
    dashboardReloadQueued = true;
    return dashboardLoadPromise;
  }

  dashboardLoadPromise = loadDashboard()
    .catch(error => {
      console.error("Dashboard refresh failed:", error);
    })
    .finally(() => {
      dashboardLoadPromise = null;
      if (dashboardReloadQueued) {
        dashboardReloadQueued = false;
        refreshDashboardNow();
      }
    });

  return dashboardLoadPromise;
}

function scheduleDashboardRefresh(delay = 120) {
  clearTimeout(dashboardRefreshTimer);
  dashboardRefreshTimer = setTimeout(refreshDashboardNow, delay);
}

window.viewCostAlert = async function(alertId, projectId) {
  await markCostAlertViewed(alertId);

  if (projectId) {
    sessionStorage.setItem("lemyu_focus_project_id", projectId);
  }

  window.location.href = "projects.html";
};

showDashboardUser();
refreshDashboardNow();
document.getElementById("costAlertBell")?.addEventListener("click", async () => {
  const dropdown = document.getElementById("costAlertDropdown");
  const bell = document.getElementById("costAlertBell");
  if (!dropdown || !bell) return;

  const willOpen = dropdown.hidden;
  dropdown.hidden = !willOpen;
  bell.setAttribute("aria-expanded", String(willOpen));

  if (willOpen) {
    const activeAlerts = latestCostAlerts.filter(alert => ACTIVE_ALERT_STATUSES.has(alert.status || "Active"));
    await Promise.all(activeAlerts.map(alert => markCostAlertViewed(alert.id)));
    renderCostAlertNotifications(latestCostAlerts);
  }
});
document.getElementById("viewAllCostAlerts")?.addEventListener("click", () => {
  showingAllCostAlerts = !showingAllCostAlerts;
  renderCostAlerts(latestCostAlerts);
});
document.addEventListener("click", event => {
  const wrapper = document.getElementById("costAlertNotification");
  const dropdown = document.getElementById("costAlertDropdown");
  const bell = document.getElementById("costAlertBell");
  if (!wrapper || !dropdown || wrapper.contains(event.target)) return;

  dropdown.hidden = true;
  bell?.setAttribute("aria-expanded", "false");
});
window.addEventListener("lemyu:data-sync-complete", () => scheduleDashboardRefresh(0));
window.addEventListener("lemyu:local-data-changed", () => scheduleDashboardRefresh(0));
window.addEventListener("storage", event => {
  if (String(event.key || "").startsWith("lemyu_")) scheduleDashboardRefresh(0);
});
window.addEventListener("focus", () => scheduleDashboardRefresh(0));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleDashboardRefresh(0);
});
const dashboardChannel = supabase.channel("dashboard-live");
["projects", "expenses", "payroll", "inventory", "cost_overrun_alerts"].forEach(table => {
  dashboardChannel.on(
    "postgres_changes",
    { event: "*", schema: "public", table },
    () => scheduleDashboardRefresh(0)
  );
});
dashboardChannel.subscribe(status => {
  if (status === "SUBSCRIBED") scheduleDashboardRefresh(0);
});

setInterval(() => {
  if (!document.hidden) scheduleDashboardRefresh(0);
}, 5000);
