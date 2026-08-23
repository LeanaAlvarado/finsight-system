import { supabase, escapeHtml, peso, number, readTable, setText } from "./supabase.js?v=20260820-budget-warning-v226";

let dashboardChart = null;
let expenseCategoryChart = null;
let dashboardLoadPromise = null;
let dashboardReloadQueued = false;
let dashboardRefreshTimer = null;
let latestCostAlerts = [];

const ALERT_WARNING_THRESHOLD = 70;
const ALERT_CRITICAL_THRESHOLD = 85;
const ALERT_OVER_BUDGET_THRESHOLD = 100;
const ALERT_PREVIEW_LIMIT = 5;
const ACTIVE_ALERT_STATUSES = new Set(["Active", "Viewed"]);
const MATERIAL_PROJECT_STATUSES = new Set(["approved", "ongoing", "on going", "in progress", "completed", "complete"]);
const FINANCIAL_PROJECT_STATUSES = new Set(["approved", "ongoing", "on going", "in progress", "completed", "complete"]);
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

function isFinancialProject(project = {}) {
  return FINANCIAL_PROJECT_STATUSES.has(getProjectRecordStatus(project));
}

function recordBelongsToProjects(record = {}, projects = []) {
  return projects.some(project => recordBelongsToProject(record, project));
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

function getProjectCollectionPaid(project = {}) {
  const contract = Math.max(number(project.contract_amount), 0);
  if (!contract) return 0;

  const directPaid = number(
    project.amount_paid
    ?? project.paid_amount
    ?? project.payment_amount
    ?? project.billing_down_payment_amount
    ?? project.down_payment
  );
  const firstPercent = number(project.billing_down_payment_percent);
  const progressPercent = number(project.billing_progress_percent);
  const firstPayment = firstPercent > 0
    ? contract * (firstPercent / 100)
    : directPaid;
  const progressPayment = progressPercent > 0
    ? contract * (progressPercent / 100)
    : 0;

  return Math.min(Math.max(firstPayment + progressPayment, 0), contract);
}

function renderCollectionStatus(projects = []) {
  const list = document.getElementById("collectionProjectList");
  const totalContract = projects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const totalPaid = projects.reduce((sum, project) => sum + getProjectCollectionPaid(project), 0);
  const collectionRate = totalContract > 0 ? (totalPaid / totalContract) * 100 : 0;
  const projectRows = projects
    .map(project => {
      const contract = number(project.contract_amount);
      const paid = getProjectCollectionPaid(project);
      const balance = Math.max(contract - paid, 0);
      return {
        code: project.project_code || project.project_title || "Project",
        contract,
        paid,
        balance
      };
    })
    .filter(row => row.contract > 0 && row.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  if (list) {
    list.innerHTML = projectRows.length
      ? `
        <div class="collection-project-title">
          <strong>Projects with Unpaid Balance</strong>
          <span>${projectRows.length} project${projectRows.length === 1 ? "" : "s"}</span>
        </div>
        <div class="collection-project-head">
          <span>Project</span>
          <span>Contract</span>
          <span>Paid</span>
          <span>Balance</span>
        </div>
        <div class="collection-project-scroll">
        ${projectRows.map(row => `
          <div class="collection-project-row">
            <strong>${escapeHtml(row.code)}</strong>
            <span>${compactPeso(row.contract)}</span>
            <span>${compactPeso(row.paid)}</span>
            <span>${compactPeso(row.balance)}</span>
          </div>
        `).join("")}
        </div>
      `
      : `<div class="category-breakdown-empty"><strong>No Outstanding Collections</strong><span>All recorded project collections are currently up to date.</span></div>`;
  }

  setText("collectionRate", `${collectionRate.toFixed(2)}%`);
  const collectionRateBar = document.getElementById("collectionRateBar");
  if (collectionRateBar) collectionRateBar.style.width = `${Math.min(Math.max(collectionRate, 0), 100).toFixed(2)}%`;
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

  projects.forEach(project => {
    const date = new Date(getRecordDate(project));
    const key = getMonthKey(date);
    if (revenueByMonth.has(key)) {
      revenueByMonth.set(key, revenueByMonth.get(key) + number(project.contract_amount));
    }
    if (expensesByMonth.has(key)) {
      expensesByMonth.set(key, expensesByMonth.get(key) + number(project.project_budget));
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

function updateDashboardLastUpdated() {
  const stamp = new Date().toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  setText("dashboardLastUpdated", `Last updated: ${stamp}`);
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
    const budgetSpendWithoutMaterials = expenseTotal + payrollTotal;
    const actualBudgetSpend = budgetSpendWithoutMaterials + materialTotal;
    const budgetOverrun = budget > 0 ? Math.max(budgetSpendWithoutMaterials - budget, 0) : budgetSpendWithoutMaterials;
    const budgetRemaining = budget > 0 ? Math.max(budget - budgetSpendWithoutMaterials, 0) : 0;
    const budgetUtilization = budget > 0 ? (budgetSpendWithoutMaterials / budget) * 100 : 0;
    const appliedMaterialCost = budget > 0 ? 0 : materialTotal;
    const totalCost = budget + appliedMaterialCost;
    const profit = revenue - totalCost - tax;
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
      budgetSpendWithoutMaterials,
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
  if (analysis.budgetRemaining < 0 || analysis.budgetUtilization > ALERT_OVER_BUDGET_THRESHOLD) {
    return { label: "Over Budget", className: "over-budget" };
  }

  if (analysis.budgetUtilization >= ALERT_CRITICAL_THRESHOLD) {
    return { label: "Critical", className: "critical" };
  }

  if (analysis.budgetUtilization >= ALERT_WARNING_THRESHOLD) {
    return { label: "Warning", className: "warning" };
  }

  return { label: "Healthy", className: "safe" };
}

function getProjectStatus(analysis) {
  return getBudgetStatusInfo(analysis).label;
}

function renderProfitabilityTable(projectAnalytics) {
  const panel = document.getElementById("profitabilityHighlights");
  if (!panel) return;

  const rankedProjects = [...projectAnalytics]
    .sort((a, b) => b.profit - a.profit)
    .filter(item => item.revenue > 0);
  const topProject = rankedProjects[0];
  const needsAttention = [...rankedProjects]
    .sort((a, b) => a.margin - b.margin || a.profit - b.profit)[0];

  if (!topProject) {
    panel.innerHTML = `<div class="category-breakdown-empty">No project profitability records available.</div>`;
    return;
  }

  const cards = [
    {
      label: "Top Performing",
      item: topProject,
      tone: "good"
    },
    {
      label: "Needs Attention",
      item: needsAttention,
      tone: needsAttention?.profit < 0 || needsAttention?.margin < 10 ? "bad" : "watch"
    }
  ].filter(card => card.item);

  panel.innerHTML = cards.map(card => {
    const item = card.item;
    const status = getBudgetStatusInfo(item);
    return `
      <div class="profitability-card ${card.tone}">
        <small>${escapeHtml(card.label)}</small>
        <strong title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</strong>
        <div class="profitability-metrics">
          <span>Net Profit <b>${peso(item.profit)}</b></span>
          <span>Margin <b>${item.margin.toFixed(2)}%</b></span>
        </div>
        <em class="bi-status ${status.className}">${status.label}</em>
      </div>
    `;
  }).join("");
}

function renderBudgetUtilizationList(projectAnalytics) {
  const list = document.getElementById("budgetUtilizationList");
  if (!list) return;

  const rankedProjects = [...projectAnalytics]
    .filter(item => item.budget > 0)
    .sort((a, b) => b.budgetUtilization - a.budgetUtilization)
    .slice(0, 4);

  if (!rankedProjects.length) {
    list.innerHTML = `<div class="category-breakdown-empty">No project budget records available.</div>`;
    return;
  }

  list.innerHTML = rankedProjects.map(item => {
    const width = Math.min(Math.max(item.budgetUtilization, 4), 100);
    const status = getBudgetStatusInfo(item);
    return `
      <div class="budget-util-row ${status.className}">
        <div class="budget-util-head">
          <strong title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</strong>
          <span class="bi-status ${status.className}">${status.label}</span>
        </div>
        <div class="compact-profit-bar" aria-label="${escapeHtml(item.label)} ${item.budgetUtilization.toFixed(1)} percent used">
          <span style="width:${width.toFixed(2)}%"></span>
        </div>
        <div class="budget-util-foot">
          <span>${item.budgetUtilization.toFixed(1)}% utilized</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderProjectHealthOverview(projectAnalytics = []) {
  const healthProjects = projectAnalytics.filter(item => item.budget > 0);
  const counts = healthProjects.reduce((summary, item) => {
    const status = getBudgetStatusInfo(item).label;
    if (status === "Over Budget" || status === "Critical") summary.critical += 1;
    else if (status === "Warning") summary.warning += 1;
    else summary.healthy += 1;
    return summary;
  }, { healthy: 0, warning: 0, critical: 0 });
  const total = Math.max(healthProjects.length, 1);
  const safePercent = (counts.healthy / total) * 100;
  const warningPercent = (counts.warning / total) * 100;
  const criticalPercent = (counts.critical / total) * 100;

  setText("healthyProjectCount", counts.healthy);
  setText("warningProjectCount", counts.warning);
  setText("healthCriticalProjectCount", counts.critical);
  const safeBar = document.getElementById("healthSafeBar");
  const warningBar = document.getElementById("healthWarningBar");
  const criticalBar = document.getElementById("healthCriticalBar");
  if (safeBar) safeBar.style.width = `${safePercent.toFixed(2)}%`;
  if (warningBar) warningBar.style.width = `${warningPercent.toFixed(2)}%`;
  if (criticalBar) criticalBar.style.width = `${criticalPercent.toFixed(2)}%`;

  const caption = healthProjects.length
    ? `${healthProjects.length} budgeted project${healthProjects.length === 1 ? "" : "s"} monitored for budget health.`
    : "No project budget records available yet.";
  setText("projectHealthCaption", caption);
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
    .map(([projectCode, total]) => {
      const project = projects.find(item => normalizeMatchValue(item.project_code) === normalizeMatchValue(projectCode)) || {};
      return {
        code: project.project_code || projectCode,
        label: project.project_title || project.client_name || getInventoryProjectLabel(projects, projectCode),
        total
      };
    })
    .filter(item => item.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  if (!rankedProjects.length) {
    list.innerHTML = `<span class="inventory-project-empty">No approved, ongoing, or completed CCTV project materials.</span>`;
    return;
  }

  list.innerHTML = rankedProjects.map(item => `
    <div class="inventory-project-row">
      <span><b>${escapeHtml(item.code || "PROJECT")}</b>${escapeHtml(item.label)}</span>
      <strong>${peso(item.total)}</strong>
    </div>
  `).join("");
}

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
    return;
  }

  const visibleAlerts = alerts.slice(0, ALERT_PREVIEW_LIMIT);

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
  const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const categoryTotal = [...categoryTotals.values()].reduce((sum, value) => sum + number(value), 0);
  const insights = [];

  projectAnalytics.forEach(item => {
    const status = getBudgetStatusInfo(item);
    if (status.label === "Over Budget") {
      insights.push({
        severity: "critical",
        title: "Budget Overrun",
        subject: item.label,
        text: `${peso(item.budgetSpendWithoutMaterials)} used against ${peso(item.budget)} project budget.`,
        action: `${item.budgetUtilization.toFixed(1)}% utilized. Review project spending immediately.`
      });
      return;
    }

    if (status.label === "Critical") {
      insights.push({
        severity: "critical",
        title: "Critical Budget",
        subject: item.label,
        text: `${peso(item.budgetRemaining)} remaining from ${peso(item.budget)} project budget.`,
        action: `${item.budgetUtilization.toFixed(1)}% already used. Monitor before additional spending.`
      });
      return;
    }

    if (status.label === "Warning") {
      insights.push({
        severity: "warning",
        title: "Low Remaining Budget",
        subject: item.label,
        text: `${peso(item.budgetRemaining)} remaining from ${peso(item.budget)} project budget.`,
        action: `${item.budgetUtilization.toFixed(1)}% utilized. Check upcoming costs.`
      });
    }
  });

  projectAnalytics
    .filter(item => item.revenue > 0 && item.margin < 10)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 2)
    .forEach(item => {
      insights.push({
        severity: item.margin < 0 ? "critical" : "warning",
        title: "Low Profitability",
        subject: item.label,
        text: `${peso(item.profit)} net profit with ${item.margin.toFixed(2)}% margin.`,
        action: "Review pricing, budget, or project cost exposure."
      });
    });

  projectAnalytics
    .map(item => {
      const paid = getProjectCollectionPaid(item.project);
      const balance = Math.max(item.revenue - paid, 0);
      return { ...item, paid, balance };
    })
    .filter(item => item.revenue > 0 && item.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 2)
    .forEach(item => {
      insights.push({
        severity: "warning",
        title: "Outstanding Collection",
        subject: item.label,
        text: `${peso(item.balance)} still collectible from ${peso(item.revenue)} contract value.`,
        action: `${((item.paid / item.revenue) * 100).toFixed(2)}% collected so far.`
      });
    });

  if (topCategory && categoryTotal > 0 && (topCategory[1] / categoryTotal) >= 0.65) {
    insights.push({
      severity: "warning",
      title: "High Expense Concentration",
      subject: topCategory[0],
      text: `${peso(topCategory[1])} or ${((topCategory[1] / categoryTotal) * 100).toFixed(2)}% of categorized cost.`,
      action: "Check if spending is concentrated in one cost driver."
    });
  }

  if (bestProject) {
    insights.push({
      severity: "normal",
      title: "Highest Project Contribution",
      subject: bestProject.label,
      text: `${peso(bestProject.profit)} net profit with ${bestProject.margin.toFixed(2)}% margin.`,
      action: "This project currently contributes most to profitability."
    });
  }

  if (totals.revenue > 0 && totals.profit > 0) {
    insights.push({
      severity: "normal",
      title: "Overall Profitability",
      subject: "Portfolio",
      text: `Overall profit margin is ${((totals.profit / totals.revenue) * 100).toFixed(2)}%.`,
      action: "The active project portfolio is currently profitable."
    });
  }

  const priority = { critical: 0, warning: 1, normal: 2 };
  const visibleInsights = insights
    .sort((a, b) => priority[a.severity] - priority[b.severity])
    .slice(0, 5);

  if (!visibleInsights.length) {
    list.innerHTML = `
      <div class="insight-item normal">
        <div class="insight-heading">
          <em>Healthy</em>
          <strong>No Critical Projects</strong>
        </div>
        <span>All monitored projects are currently within their budget limits.</span>
      </div>
    `;
    return;
  }

  list.innerHTML = visibleInsights.map(item => `
    <div class="insight-item ${escapeHtml(item.severity)}">
      <div class="insight-heading">
        <em>${escapeHtml(item.severity)}</em>
        <strong>${escapeHtml(item.title)}</strong>
      </div>
      <b title="${escapeHtml(item.subject)}">${escapeHtml(item.subject)}</b>
      <span>${escapeHtml(item.text)}</span>
      <small>${escapeHtml(item.action)}</small>
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
  const riskCount = projectAnalytics.filter(item => getBudgetStatusInfo(item).className !== "safe").length;
  const criticalProjectCount = projectAnalytics.filter(item => {
    const label = getBudgetStatusInfo(item).label;
    return label === "Critical" || label === "Over Budget";
  }).length;
  const overBudgetCount = projectAnalytics.filter(item => getBudgetStatusInfo(item).label === "Over Budget").length;
  const budgetedProjects = projectAnalytics.filter(item => number(item.budget) > 0);
  const totalRemainingBudget = budgetedProjects.reduce((sum, item) => sum + number(item.budgetRemaining), 0);
  const totalProjectBudget = budgetedProjects.reduce((sum, item) => sum + number(item.budget), 0);
  const totalBudgetUsed = budgetedProjects.reduce((sum, item) => sum + number(item.budgetSpendWithoutMaterials), 0);
  const portfolioBudgetUtilization = totalProjectBudget > 0
    ? (totalBudgetUsed / totalProjectBudget) * 100
    : 0;

  setText("profitMargin", `${margin.toFixed(2)}%`);
  setText("profitMarginKpi", `${margin.toFixed(2)}%`);
  setText("criticalProjectCount", criticalProjectCount);
  setText("riskProjectCount", riskCount);
  setText("bestProjectProfit", peso(totalRemainingBudget));
  setText("bestProjectName", budgetedProjects.length ? `Across ${budgetedProjects.length} budgeted projects.` : "No project budget recorded.");
  setText("topCostDriver", `${portfolioBudgetUtilization.toFixed(2)}%`);
  setText("topCostDriverAmount", `${overBudgetCount} over budget`);

  renderExpenseCategoryChart(categoryTotals);
  renderCategoryBreakdownList(categoryTotals);
  renderProfitabilityTable(projectAnalytics);
  renderBudgetUtilizationList(projectAnalytics);
  renderProjectHealthOverview(projectAnalytics);
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
  const financialProjects = projects.filter(isFinancialProject);
  const financialExpenses = expenses.filter(expense => recordBelongsToProjects(expense, financialProjects));
  const financialPayroll = payroll.filter(item => recordBelongsToProjects(item, financialProjects));

  latestCostAlerts = canViewCostOverrunAlerts()
    ? await syncCostOverrunAlerts(buildCostOverrunAlerts(financialProjects, financialExpenses, savedCostAlerts, financialPayroll), savedCostAlerts)
    : [];

  const revenue = financialProjects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const projectMaterials = getApprovedCompletedCctvQuotationMaterials(financialProjects, inventory);
  const projectMaterialCost = projectMaterials.reduce((sum, item) => sum + getInventoryMaterialCost(item), 0);
  const projectAnalytics = getProjectAnalytics(financialProjects, financialExpenses, financialPayroll, projectMaterials);
  const totalCost = projectAnalytics.reduce((sum, item) => sum + number(item.totalCost), 0);
  const profit = revenue - totalCost;

  setText("totalRevenue", peso(revenue));
  setText("totalExpenses", peso(totalCost));
  setText("netProfit", peso(profit));
  setText("projectCount", financialProjects.length);
  setText("inventoryPanelValue", peso(projectMaterialCost));
  setText("inventoryPanelCount", projectMaterials.length);
  renderCollectionStatus(financialProjects);

  if (dashboardChart) {
    dashboardChart.destroy();
  }

  const trend = getMonthlyTrend(financialProjects, financialExpenses, financialPayroll);
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
          label: "Project Budget",
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
              const expenseItem = items.find(item => item.dataset.label === "Project Budget");
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

  renderBusinessIntelligence(financialProjects, financialExpenses, financialPayroll, projectMaterials, revenue, latestCostAlerts);
  updateDashboardLastUpdated();
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

  window.location.href = projectId
    ? `projects.html?details=${encodeURIComponent(projectId)}`
    : "projects.html";
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
