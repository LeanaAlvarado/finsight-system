import { escapeHtml, formatDate, number, peso, readTable, setText } from "./supabase.js?v=20260820-bi-pro-dashboard-v221";

const AUDIT_PAGE_SIZE = 10;
const LOCAL_QUOTATION_ITEMS_KEY = "lemyu_quotation_items";
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

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
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

function mergeCurrentRecords(cloudRecords = [], localKey, keyFields) {
  const merged = [...(cloudRecords || [])];
  const localRecords = readLocalJson(localKey, []);
  if (!Array.isArray(localRecords)) return merged;

  localRecords.forEach(localRecord => {
    const exists = merged.some(cloudRecord => keyFields.some(field => {
      const localValue = normalizeMatchValue(localRecord?.[field]);
      const cloudValue = normalizeMatchValue(cloudRecord?.[field]);
      return localValue && cloudValue && localValue === cloudValue;
    }));

    if (!exists) {
      merged.push(localRecord);
    }
  });

  return merged;
}

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

function isReportFinancialStatus(status = "") {
  return ["approved", "completed", "complete", "ongoing", "on going", "in progress"].includes(
    String(status || "").trim().toLowerCase()
  );
}

function isReportMaterialStatus(status = "") {
  return ["approved", "completed", "complete", "ongoing", "on going", "in progress"].includes(
    String(status || "").trim().toLowerCase()
  );
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
    total_amount: savedTotal || (qty * price)
  };
}

function getProjectLinkedMaterials(inventory = []) {
  return inventory.filter(item => String(item.project_code || "").trim());
}

function getReportCctvProjectMaterials(projects = [], inventory = []) {
  return projects
    .filter(project => isReportMaterialStatus(project.status || project.project_status) && getProjectQuotationType(project) === "cctv")
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

function getProjectMaterialsGroupedReport(projects = [], inventory = []) {
  const materials = getReportCctvProjectMaterials(projects, inventory);
  const groups = new Map();

  materials.forEach(material => {
    const projectCode = String(material.project_code || "").trim();
    const project = projects.find(item => recordBelongsToProject(material, item))
      || projects.find(item => normalizeMatchValue(item.project_code) === normalizeMatchValue(projectCode))
      || {};
    const key = project.id || project.project_code || projectCode || "unassigned";
    const current = groups.get(key) || {
      projectCode: project.project_code || projectCode || "-",
      projectTitle: project.project_title || material.project_title || project.client_name || "Untitled CCTV Project",
      clientName: project.client_name || project.company_name || "-",
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

  return {
    groups: [...groups.values()].sort((a, b) => b.total - a.total),
    materials
  };
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

function renderLatestActivity(events = []) {
  const list = document.getElementById("latestActivityList");
  const count = document.getElementById("latestActivityCount");
  if (!list || !count) return;

  const latestEvents = events
    .slice()
    .sort((a, b) => new Date(b.dateValue || 0) - new Date(a.dateValue || 0))
    .slice(0, 5);

  count.textContent = `${latestEvents.length} recent event${latestEvents.length === 1 ? "" : "s"}`;
  list.innerHTML = latestEvents.length
    ? latestEvents.map(event => `
      <li>
        <span>${formatDate(event.dateValue)}</span>
        <strong>${escapeHtml(event.moduleName)}</strong>
        <em>${escapeHtml(event.reference)}</em>
      </li>
    `).join("")
    : `<li>No recent activity yet.</li>`;
}

function renderReportProjectList(projects = []) {
  const list = document.getElementById("reportProjectList");
  const count = document.getElementById("reportProjectCountText");
  if (!list || !count) return;

  const sortedProjects = projects
    .slice()
    .sort((a, b) => String(a.project_code || "").localeCompare(String(b.project_code || "")));

  count.textContent = `${sortedProjects.length} project${sortedProjects.length === 1 ? "" : "s"}`;
  list.innerHTML = sortedProjects.length
    ? sortedProjects.map(project => `
      <div class="report-project-row">
        <div>
          <strong>${escapeHtml(project.project_code || "No Code")}</strong>
          <span>${escapeHtml(project.project_title || project.client_name || "Untitled Project")}</span>
        </div>
        <em>${escapeHtml(project.status || "No Status")}</em>
      </div>
    `).join("")
    : `<p class="muted">No approved, ongoing, or completed projects in this coverage.</p>`;
}

window.generateReportsActiveProjectsReport = function() {
  const activeProjects = filterByCoverage(reportRecords.projects)
    .filter(project => isReportFinancialStatus(project.status))
    .sort((a, b) => String(a.project_code || "").localeCompare(String(b.project_code || "")));
  const generatedDate = new Date();
  const reportWindow = window.open("", "_blank");

  if (!reportWindow) {
    alert("Please allow pop-ups to generate the Active Projects report.");
    return;
  }

  const totalContract = activeProjects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const rows = activeProjects.length
    ? activeProjects.map((project, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(project.project_code || "-")}</td>
        <td>${escapeHtml(project.project_title || project.client_name || "Untitled Project")}</td>
        <td>${escapeHtml(project.client_name || project.company_name || "-")}</td>
        <td>${escapeHtml(project.status || "Active")}</td>
        <td>${peso(project.contract_amount)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" style="text-align:center;">No approved, ongoing, or completed projects in this coverage.</td></tr>`;

  reportWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Active_Projects_Report_${generatedDate.toISOString().slice(0, 10)}</title>
      <style>
        @page{size:A4;margin:14mm;}
        *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        body{font-family:Arial,sans-serif;color:#071f3d;margin:0;background:#f4f7fb;}
        .report-page{max-width:960px;margin:0 auto;padding:28px;background:#fff;min-height:100vh;}
        .actions{text-align:right;margin-bottom:14px;}
        button{border:0;border-radius:6px;background:#174f80;color:#fff;padding:9px 14px;font-weight:800;}
        .report-top{display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #0f5f66;padding-bottom:16px;margin-bottom:18px;}
        small{display:block;color:#51657d;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;}
        h1{margin:4px 0 6px;font-size:24px;}
        p{margin:0;color:#42566f;font-size:12px;line-height:1.45;}
        .metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:18px 0;}
        .metric{border:1px solid #c9d7e6;border-radius:6px;padding:12px;background:#f8fbff;}
        .metric strong{display:block;margin-top:6px;font-size:18px;}
        table{width:100%;border-collapse:collapse;font-size:11px;margin-top:14px;}
        th,td{border:1px solid #d9e3ee;padding:8px;text-align:left;vertical-align:top;}
        th{background:#0f5f66;color:#fff;text-transform:uppercase;font-size:10px;letter-spacing:.04em;}
        td:nth-child(1),td:nth-child(6){text-align:right;white-space:nowrap;}
        @media print{body{background:#fff}.actions{display:none}.report-page{max-width:none;padding:0;}}
      </style>
    </head>
    <body>
      <div class="report-page">
        <div class="actions"><button onclick="window.print()">Print</button></div>
        <div class="report-top">
          <div>
            <small>LEMYU FIBER OPTIC INSTALLATION AND SERVICES</small>
            <h1>Active Projects Report</h1>
            <p>Approved, ongoing, and completed project records from the selected report coverage.</p>
          </div>
          <div>
            <small>Generated Date</small>
            <p>${generatedDate.toLocaleString("en-PH")}</p>
          </div>
        </div>
        <div class="metrics">
          <div class="metric"><small>Total Active Projects</small><strong>${activeProjects.length}</strong></div>
          <div class="metric"><small>Total Contract Amount</small><strong>${peso(totalContract)}</strong></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>No.</th>
              <th>Project Code</th>
              <th>Project Title</th>
              <th>Client</th>
              <th>Status</th>
              <th>Contract Amount</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </body>
    </html>
  `);
  reportWindow.document.close();
};

window.generateReportsProjectMaterialsReport = function() {
  const projects = filterByCoverage(reportRecords.projects).filter(project => isReportMaterialStatus(project.status || project.project_status));
  const { groups, materials } = getProjectMaterialsGroupedReport(projects, reportRecords.inventory);
  const totalRecords = materials.length;
  const totalCost = materials.reduce((sum, item) => sum + getInventoryMaterialCost(item), 0);
  const generatedDate = new Date();
  const reportWindow = window.open("", "_blank");

  if (!reportWindow) {
    alert("Please allow pop-ups to generate the Material Usage report.");
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
              <th>No.</th>
              <th>Material</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Unit Price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${group.items.map((item, index) => `
              <tr>
                <td>${index + 1}</td>
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
    : `<div class="empty-report">No CCTV material usage records found for the selected report coverage.</div>`;

  reportWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Material_Usage_Report_${generatedDate.toISOString().slice(0, 10)}</title>
      <style>
        @page{size:A4;margin:14mm;}
        *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        body{font-family:Arial,sans-serif;color:#071f3d;margin:0;background:#f4f7fb;}
        .report-page{max-width:960px;margin:0 auto;padding:28px;background:#fff;min-height:100vh;}
        .actions{text-align:right;margin-bottom:14px;}
        button{border:0;border-radius:6px;background:#174f80;color:#fff;padding:9px 14px;font-weight:800;}
        .report-top{display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #0f5f66;padding-bottom:16px;margin-bottom:18px;}
        small{display:block;color:#51657d;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;}
        h1{margin:4px 0 6px;font-size:24px;}
        h2{margin:4px 0 6px;font-size:16px;}
        p{margin:0;color:#42566f;font-size:12px;line-height:1.45;}
        .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0;}
        .metric{border:1px solid #c9d7e6;border-radius:6px;padding:12px;background:#f8fbff;}
        .metric strong{display:block;margin-top:6px;font-size:18px;}
        .report-project{border:1px solid #c9d7e6;border-radius:8px;margin-top:14px;overflow:hidden;break-inside:avoid;}
        .project-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;background:#eef4fa;padding:12px 14px;}
        .project-head strong{font-size:15px;white-space:nowrap;}
        table{width:100%;border-collapse:collapse;font-size:11px;}
        th,td{border-top:1px solid #d9e3ee;padding:8px;text-align:left;vertical-align:top;}
        th{background:#0f5f66;color:#fff;text-transform:uppercase;font-size:10px;letter-spacing:.04em;}
        td:nth-child(1),td:nth-child(4),td:nth-child(6),td:nth-child(7){text-align:right;white-space:nowrap;}
        .empty-report{border:1px solid #c9d7e6;border-radius:8px;padding:18px;text-align:center;color:#51657d;}
        @media print{body{background:#fff}.actions{display:none}.report-page{max-width:none;padding:0;}}
      </style>
    </head>
    <body>
      <main class="report-page">
        <div class="actions"><button onclick="window.print()">Print</button></div>
        <header class="report-top">
          <div>
            <small>LEMYU Fiber Optic Installation and Services</small>
            <h1>Inventory / Material Usage Report</h1>
            <p>CCTV material usage from approved, ongoing, and completed projects in the selected coverage.</p>
          </div>
          <div>
            <small>Generated Date</small>
            <p>${escapeHtml(generatedDate.toLocaleString("en-PH"))}</p>
          </div>
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

function renderReports() {
  const projects = filterByCoverage(reportRecords.projects);
  const financialProjects = projects.filter(project => isReportFinancialStatus(project.status));
  const expenses = filterByCoverage(reportRecords.expenses);
  const payroll = filterByCoverage(reportRecords.payroll);
  const inventory = filterByCoverage(reportRecords.inventory);
  const feedback = filterByCoverage(reportRecords.feedback);
  const operationsOnly = isOperationsScope();

  const totalRevenue = financialProjects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const totalProjectCost = financialProjects.reduce((sum, project) => sum + number(project.project_budget), 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + number(expense.amount), 0);
  const totalPayroll = payroll.reduce((sum, item) => sum + number(item.salary_amount), 0);
  const expenseRecords = expenses.length + payroll.length;
  const netResult = totalRevenue - totalProjectCost;
  const netMargin = totalRevenue ? (netResult / totalRevenue) * 100 : 0;

  auditEvents = buildAuditEvents(projects, expenses, payroll, inventory, feedback);

  setText("projectReportCount", financialProjects.length);
  setText("financialScope", operationsOnly ? "-" : peso(totalRevenue));
  setText("expenseReportCount", operationsOnly ? "-" : expenseRecords);
  setText("auditCount", canViewAuditLogs() ? auditEvents.length : "-");
  setText("reportRevenue", operationsOnly ? "-" : peso(totalRevenue));
  setText("reportExpenses", operationsOnly ? "-" : peso(totalProjectCost));
  setText("reportProfit", operationsOnly ? "-" : peso(netResult));
  setText("reportMargin", operationsOnly ? "-" : `${netMargin.toFixed(2)}%`);
  setText("reportFeedback", operationsOnly ? "-" : feedback.length);
  setText("reportCoverageSummary", getCoverageText());
  setText("printCoverageText", getPrintCoverageText());
  setText("printGeneratedText", `Generated: ${new Date().toLocaleString("en-PH")}`);

  renderLatestActivity(auditEvents);
  renderReportProjectList(financialProjects);
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
    projects: mergeCurrentRecords(projectResult.error ? [] : projectResult.data, "lemyu_saved_projects", ["id", "project_code"]),
    expenses: expenseResult.error ? [] : expenseResult.data,
    payroll: payrollResult.error ? [] : payrollResult.data,
    inventory: mergeCurrentRecords(inventoryResult.error ? [] : inventoryResult.data, "lemyu_saved_inventory", ["id"]),
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
