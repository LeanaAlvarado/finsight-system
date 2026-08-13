import { escapeHtml, formatDate, number, peso, readTable, setText } from "./supabase.js?v=20260813-overview-project-budget-v194";

const AUDIT_PAGE_SIZE = 10;
const auditTable = document.getElementById("auditTable");
const auditSection = document.getElementById("auditLogSection");

let reportRecords = {
  projects: [],
  expenses: [],
  payroll: [],
  inventory: [],
  feedback: []
};
let auditEvents = [];
let auditCurrentPage = 1;
let reportsLoadError = "";

const reportCoverageState = {
  mode: "month",
  startDate: null,
  endDate: null
};

const auditListState = {
  search: "",
  module: "all",
  action: "all",
  sort: "newest"
};

function getRecordDate(record) {
  return record.created_at || record.uploaded_at || record.date || record.expense_date || record.pay_date || "";
}

function addAuditEvent(events, moduleName, activity, reference, dateValue, activityType = "record") {
  events.push({
    moduleName,
    activity,
    reference,
    dateValue: dateValue || new Date().toISOString(),
    activityType
  });
}

function isFinanceScope() {
  return document.body.dataset.roleScope === "finance"
    || String(localStorage.getItem("lemyu_user_role") || "").toLowerCase() === "finance officer/accountant";
}

function isOperationsScope() {
  return document.body.dataset.roleScope === "operations"
    || String(localStorage.getItem("lemyu_user_role") || "").toLowerCase() === "project manager/operations staff";
}

function isSystemAdminScope() {
  return String(localStorage.getItem("lemyu_user_role") || "").toLowerCase() === "system administrator";
}

function isOwnerManagerScope() {
  const role = String(
    localStorage.getItem("lemyu_user_role_label")
    || localStorage.getItem("lemyu_user_role")
    || ""
  ).toLowerCase();
  return ["owner/manager", "owner", "manager", "owner_manager"].includes(role);
}

function canViewAuditLogs() {
  return isSystemAdminScope() || isOwnerManagerScope();
}

function getDayStart(date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function getDayEnd(date) {
  const nextDate = new Date(date);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
}

function getCoverageRange() {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);

  if (reportCoverageState.mode === "all") {
    return { start: null, end: null, label: "All Records" };
  }

  if (reportCoverageState.mode === "today") {
    return { start: getDayStart(today), end: getDayEnd(today), label: "Today" };
  }

  if (reportCoverageState.mode === "week") {
    const day = today.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(today.getDate() - diff);
    end.setDate(start.getDate() + 6);
    return { start: getDayStart(start), end: getDayEnd(end), label: "This Week" };
  }

  if (reportCoverageState.mode === "quarter") {
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
    start.setMonth(quarterStartMonth, 1);
    end.setMonth(quarterStartMonth + 3, 0);
    return { start: getDayStart(start), end: getDayEnd(end), label: "This Quarter" };
  }

  if (reportCoverageState.mode === "year") {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
    return { start: getDayStart(start), end: getDayEnd(end), label: "This Year" };
  }

  if (reportCoverageState.mode === "custom") {
    return {
      start: reportCoverageState.startDate ? getDayStart(new Date(reportCoverageState.startDate)) : null,
      end: reportCoverageState.endDate ? getDayEnd(new Date(reportCoverageState.endDate)) : null,
      label: "Custom Date Range"
    };
  }

  start.setDate(1);
  end.setMonth(today.getMonth() + 1, 0);
  return { start: getDayStart(start), end: getDayEnd(end), label: "This Month" };
}

function formatCoverageDate(date) {
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function getCoverageText() {
  const range = getCoverageRange();
  if (!range.start || !range.end) return "Showing all report records.";
  return `Showing report records from ${formatCoverageDate(range.start)} to ${formatCoverageDate(range.end)}.`;
}

function getPrintCoverageText() {
  const range = getCoverageRange();
  if (!range.start || !range.end) return "Report Coverage: All Records";
  return `Report Coverage: ${formatCoverageDate(range.start)} to ${formatCoverageDate(range.end)}`;
}

function isWithinCoverage(record) {
  const range = getCoverageRange();
  if (!range.start || !range.end) return true;

  const rawDate = getRecordDate(record);
  if (!rawDate) return false;

  const recordDate = new Date(rawDate);
  if (Number.isNaN(recordDate.getTime())) return false;

  return recordDate >= range.start && recordDate <= range.end;
}

function filterByCoverage(records = []) {
  return records.filter(record => isWithinCoverage(record));
}

function applyOperationsReportScope() {
  if (!isOperationsScope()) return;

  const heroTitle = document.querySelector(".hero h1");
  const heroText = document.querySelector(".hero p");
  if (heroTitle) heroTitle.textContent = "Project Reports";
  if (heroText) heroText.textContent = "Review project records and project-only report activity.";

  document.querySelectorAll(".grid .kpi").forEach(card => {
    const label = card.querySelector("small")?.textContent || "";
    if (!/Project Records/i.test(label)) card.style.display = "none";
  });

  const summaryCard = document.getElementById("reportRevenue")?.closest(".card");
  if (summaryCard) summaryCard.style.display = "none";
}

function applyFinanceReportScope() {
  if (!isFinanceScope()) return;

  const heroTitle = document.querySelector(".hero h1");
  const heroText = document.querySelector(".hero p");
  if (heroTitle) heroTitle.textContent = "Financial Reports";
  if (heroText) heroText.textContent = "Review revenue, payroll, expenses, taxes, budget exposure, and financial activity only.";

  const feedbackCard = document.getElementById("reportFeedback")?.closest(".mini-card");
  if (feedbackCard) feedbackCard.style.display = "none";
}

function applyAuditAccessScope() {
  if (canViewAuditLogs()) return;
  if (auditSection) auditSection.style.display = "none";
}

function buildAuditEvents(projects, expenses, payroll, inventory, feedback) {
  const events = [];
  const financeOnly = isFinanceScope();
  const operationsOnly = isOperationsScope();

  projects.forEach(project => {
    addAuditEvent(
      events,
      "Project Monitoring",
      operationsOnly ? "Project record available for monitoring review" : "Project budget and contract amount available for financial review",
      project.project_title || project.project_code || "Project",
      getRecordDate(project),
      "monitoring"
    );
  });

  if (!operationsOnly) {
    expenses.forEach(expense => {
      addAuditEvent(
        events,
        "Payroll & Expenses",
        `${expense.category || "Expense"} transaction recorded`,
        peso(expense.amount),
        getRecordDate(expense),
        "transaction"
      );
    });

    payroll.forEach(item => {
      addAuditEvent(
        events,
        "Payroll & Expenses",
        `Payroll record saved for ${item.employee_name || "employee"}`,
        peso(item.salary_amount),
        getRecordDate(item),
        "transaction"
      );
    });
  }

  if (!financeOnly && !operationsOnly) {
    inventory.forEach(item => {
      addAuditEvent(
        events,
        "Inventory",
        "Inventory material recorded",
        item.name || item.material_name || "Material",
        getRecordDate(item),
        "record"
      );
    });

    feedback.forEach(item => {
      addAuditEvent(
        events,
        "Proposal / Quotation & Feedback",
        `Client feedback submitted with rating ${item.rating || item.overall_satisfaction || 0}/5`,
        item.client_name || "Client",
        getRecordDate(item),
        "feedback"
      );
    });
  }

  return events.sort((a, b) => new Date(b.dateValue) - new Date(a.dateValue));
}

function getFilteredAuditEvents() {
  const search = auditListState.search.trim().toLowerCase();

  return auditEvents
    .filter(event => {
      if (!search) return true;
      return [event.moduleName, event.activity, event.reference]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .filter(event => auditListState.module === "all" || event.moduleName === auditListState.module)
    .filter(event => auditListState.action === "all" || event.activityType === auditListState.action || event.activity.toLowerCase().includes(auditListState.action))
    .sort((a, b) => {
      const dateA = new Date(a.dateValue || 0).getTime() || 0;
      const dateB = new Date(b.dateValue || 0).getTime() || 0;
      if (auditListState.sort === "oldest") return dateA - dateB;
      if (auditListState.sort === "module_asc") return a.moduleName.localeCompare(b.moduleName) || dateB - dateA;
      return dateB - dateA;
    });
}

function hasActiveAuditFilters() {
  return Boolean(auditListState.search.trim())
    || auditListState.module !== "all"
    || auditListState.action !== "all";
}

function renderAuditPagination(totalItems) {
  const pagination = document.getElementById("auditPagination");
  const summary = document.getElementById("auditPaginationSummary");
  const controls = document.getElementById("auditPaginationControls");
  if (!pagination || !summary || !controls) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / AUDIT_PAGE_SIZE));
  auditCurrentPage = Math.min(Math.max(auditCurrentPage, 1), totalPages);
  const startIndex = totalItems ? ((auditCurrentPage - 1) * AUDIT_PAGE_SIZE) + 1 : 0;
  const endIndex = Math.min(auditCurrentPage * AUDIT_PAGE_SIZE, totalItems);

  pagination.hidden = false;
  summary.textContent = totalItems
    ? `Showing ${startIndex}-${endIndex} of ${totalItems} audit log records`
    : "Showing 0 of 0 audit log records";

  const pageWindow = 5;
  const firstPage = Math.max(1, Math.min(auditCurrentPage - 2, totalPages - pageWindow + 1));
  const lastPage = Math.min(totalPages, firstPage + pageWindow - 1);
  const pageButtons = [];

  for (let page = firstPage; page <= lastPage; page += 1) {
    pageButtons.push(`
      <button type="button" class="${page === auditCurrentPage ? "active" : ""}" ${page === auditCurrentPage ? "aria-current=\"page\"" : ""} onclick="goToAuditPage(${page})">${page}</button>
    `);
  }

  controls.innerHTML = `
    <button type="button" onclick="goToAuditPage(${auditCurrentPage - 1})" ${auditCurrentPage <= 1 ? "disabled" : ""}>Previous</button>
    ${pageButtons.join("")}
    <button type="button" onclick="goToAuditPage(${auditCurrentPage + 1})" ${auditCurrentPage >= totalPages ? "disabled" : ""}>Next</button>
  `;
}

function renderAuditTable() {
  if (!auditTable || !canViewAuditLogs()) return;

  if (reportsLoadError) {
    auditTable.innerHTML = `<tr><td colspan="4" style="text-align:center;">Unable to load audit log records. Please try again.</td></tr>`;
    renderAuditPagination(0);
    return;
  }

  const events = getFilteredAuditEvents();
  const totalItems = events.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / AUDIT_PAGE_SIZE));
  auditCurrentPage = Math.min(Math.max(auditCurrentPage, 1), totalPages);
  const startIndex = (auditCurrentPage - 1) * AUDIT_PAGE_SIZE;
  const pageEvents = events.slice(startIndex, startIndex + AUDIT_PAGE_SIZE);

  if (!pageEvents.length) {
    const message = auditEvents.length && hasActiveAuditFilters()
      ? "No audit log records match the selected filters."
      : "No audit events available yet.";
    auditTable.innerHTML = `<tr><td colspan="4" style="text-align:center;">${message}</td></tr>`;
    renderAuditPagination(totalItems);
    return;
  }

  auditTable.innerHTML = pageEvents.map(event => `
    <tr>
      <td>${formatDate(event.dateValue)}</td>
      <td>${escapeHtml(event.moduleName)}</td>
      <td>${escapeHtml(event.activity)}</td>
      <td>${escapeHtml(event.reference)}</td>
    </tr>
  `).join("");

  renderAuditPagination(totalItems);
}

function renderReports() {
  const projects = filterByCoverage(reportRecords.projects);
  const expenses = filterByCoverage(reportRecords.expenses);
  const payroll = filterByCoverage(reportRecords.payroll);
  const inventory = filterByCoverage(reportRecords.inventory);
  const feedback = filterByCoverage(reportRecords.feedback);
  const operationsOnly = isOperationsScope();

  const totalRevenue = projects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + number(expense.amount), 0);
  const totalPayroll = payroll.reduce((sum, item) => sum + number(item.salary_amount), 0);
  const expenseRecords = expenses.length + payroll.length;

  auditEvents = buildAuditEvents(projects, expenses, payroll, inventory, feedback);

  setText("projectReportCount", projects.length);
  setText("financialScope", operationsOnly ? "-" : peso(totalRevenue));
  setText("expenseReportCount", operationsOnly ? "-" : expenseRecords);
  setText("auditCount", canViewAuditLogs() ? auditEvents.length : "-");
  setText("reportRevenue", operationsOnly ? "-" : peso(totalRevenue));
  setText("reportExpenses", operationsOnly ? "-" : peso(totalExpenses + totalPayroll));
  setText("reportProfit", operationsOnly ? "-" : peso(totalRevenue - totalExpenses - totalPayroll));
  setText("reportFeedback", operationsOnly ? "-" : feedback.length);
  setText("reportCoverageSummary", getCoverageText());
  setText("printCoverageText", getPrintCoverageText());
  setText("printGeneratedText", `Generated: ${new Date().toLocaleString("en-PH")}`);

  renderAuditTable();
}

async function loadReports() {
  if (auditTable && canViewAuditLogs()) {
    auditTable.innerHTML = `<tr><td colspan="4" style="text-align:center;">Loading audit log records...</td></tr>`;
  }

  const [projectResult, expenseResult, payrollResult, inventoryResult, feedbackResult] = await Promise.all([
    readTable("projects", { orderBy: "created_at" }),
    readTable("expenses", { orderBy: "created_at" }),
    readTable("payroll", { orderBy: "created_at" }),
    readTable("inventory", { orderBy: "created_at" }),
    readTable("feedback", { orderBy: "created_at" })
  ]);

  const loadError = [projectResult, expenseResult, payrollResult, inventoryResult, feedbackResult].find(result => result.error)?.error;
  reportsLoadError = loadError?.message || "";

  reportRecords = {
    projects: projectResult.error ? [] : projectResult.data,
    expenses: expenseResult.error ? [] : expenseResult.data,
    payroll: payrollResult.error ? [] : payrollResult.data,
    inventory: inventoryResult.error ? [] : inventoryResult.data,
    feedback: feedbackResult.error ? [] : feedbackResult.data
  };

  renderReports();
}

function setCoverageMode(mode) {
  reportCoverageState.mode = mode;
  document.querySelectorAll("#reportCoverageControls button").forEach(button => {
    button.classList.toggle("active", button.dataset.coverage === mode);
  });

  const customControls = document.getElementById("customCoverageControls");
  if (customControls) customControls.hidden = mode !== "custom";

  if (mode !== "custom") {
    auditCurrentPage = 1;
    renderReports();
  }
}

function bindCoverageControls() {
  document.querySelectorAll("#reportCoverageControls button").forEach(button => {
    button.addEventListener("click", () => setCoverageMode(button.dataset.coverage || "month"));
  });

  document.getElementById("applyCoverageBtn")?.addEventListener("click", () => {
    const startDate = document.getElementById("coverageStartDate")?.value || "";
    const endDate = document.getElementById("coverageEndDate")?.value || "";

    if (!startDate || !endDate || new Date(endDate) < new Date(startDate)) {
      alert("Please select a valid report coverage period.");
      return;
    }

    reportCoverageState.startDate = startDate;
    reportCoverageState.endDate = endDate;
    auditCurrentPage = 1;
    renderReports();
  });

  document.getElementById("clearCoverageBtn")?.addEventListener("click", () => {
    const startDate = document.getElementById("coverageStartDate");
    const endDate = document.getElementById("coverageEndDate");
    if (startDate) startDate.value = "";
    if (endDate) endDate.value = "";
    reportCoverageState.startDate = null;
    reportCoverageState.endDate = null;
    setCoverageMode("month");
  });
}

function bindAuditFilters() {
  const controls = [
    ["auditSearch", "search"],
    ["auditModuleFilter", "module"],
    ["auditActionFilter", "action"],
    ["auditSort", "sort"]
  ];

  controls.forEach(([id, stateKey]) => {
    const element = document.getElementById(id);
    if (!element) return;

    const eventName = element.type === "search" ? "input" : "change";
    element.addEventListener(eventName, event => {
      auditListState[stateKey] = event.target.value || (stateKey === "search" ? "" : "all");
      auditCurrentPage = 1;
      renderAuditTable();
    });
  });
}

window.goToAuditPage = function(page) {
  const totalPages = Math.max(1, Math.ceil(getFilteredAuditEvents().length / AUDIT_PAGE_SIZE));
  auditCurrentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  renderAuditTable();
};

document.getElementById("printReportBtn")?.addEventListener("click", () => {
  renderReports();
  window.print();
});

applyFinanceReportScope();
applyOperationsReportScope();
applyAuditAccessScope();
bindCoverageControls();
bindAuditFilters();
loadReports();
