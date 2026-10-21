import { escapeHtml, formatDate, netPayrollAmount, number, peso, readTable, recordAuditEvent, setText, supabase } from "./supabase.js?v=20260921-audit-descriptions-v259";
import { createAuditFeed } from "./audit-feed.js?v=20261021-audit-lazy-v1";
import { matchesAuditView } from "./audit-presentation.js?v=20260921-audit-descriptions-v259";

const AUDIT_PAGE_SIZE = 10;
const LOCAL_QUOTATION_ITEMS_KEY = "lemyu_quotation_items";
const auditTable = document.getElementById("auditTable");
const auditSection = document.getElementById("auditLogSection");

let reportRecords = {
  projects: [],
  expenses: [],
  payroll: [],
  inventory: [],
  feedback: [],
  auditLogs: []
};
let auditEvents = [];
let auditCurrentPage = 1;
let auditLoadError = "";
let auditFeed = null;
let auditRefreshTimer = null;
let auditFilterTimer = null;
let auditBrowsing = false;
let auditPollTimer = null;
let auditAuthSubscription = null;
let auditIdentity = null;
let auditStopped = false;

const reportCoverageState = {
  mode: "month",
  startDate: null,
  endDate: null
};

const auditListState = {
  view: "activity",
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

function getFilteredAuditEvents() {
  const search = auditListState.search.trim().toLowerCase();

  return auditEvents
    .filter(event => matchesAuditView(event, auditListState.view))
    .filter(event => {
      if (!search) return true;
      return [event.moduleName, event.activity, event.reference, event.actor, ...event.details]
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
    || auditListState.action !== "all"
    || auditListState.view !== "all";
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
    ? `Showing ${startIndex}-${endIndex} of ${totalItems} matching loaded records${auditFeed?.state.hasMore ? ' — older history available' : ''}`
    : `No matching loaded records${auditFeed?.state.hasMore ? ' — load older history to continue' : ''}`;

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
    <button type="button" onclick="goToAuditPage(${auditCurrentPage + 1})" ${(auditCurrentPage >= totalPages && !auditFeed?.state.hasMore) || auditFeed?.state.loading || auditBrowsing ? "disabled" : ""}>Next</button>
  `;
}

function renderAuditTable() {
  if (!auditTable || !canViewAuditLogs()) return;

  if (!auditEvents.length && auditFeed?.state.loading) {
    auditTable.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading recent audit records...</td></tr>`;
    renderAuditPagination(0);
    return;
  }

  if (auditLoadError && !auditEvents.length) {
    auditTable.innerHTML = `<tr><td colspan="5" style="text-align:center;">Unable to load permanent audit history. Refresh and try again. ${escapeHtml(auditLoadError)}</td></tr>`;
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
    const message = auditFeed?.state.hasMore
      ? "No matches in the loaded history. Use Load older records to continue searching."
      : auditEvents.length && hasActiveAuditFilters()
      ? "No audit log records match the selected filters."
      : "No audit events available yet.";
    auditTable.innerHTML = `<tr><td colspan="5" style="text-align:center;">${message}</td></tr>`;
    renderAuditPagination(totalItems);
    return;
  }

  auditTable.innerHTML = pageEvents.map(event => `
    <tr>
      <td>${escapeHtml(event.dateValue ? new Date(event.dateValue).toLocaleString("en-PH") : "-")}</td>
      <td>${escapeHtml(event.actor)}</td>
      <td>${escapeHtml(event.moduleName)}</td>
      <td>${escapeHtml(event.activity)}${event.details.length > 3 ? `<details><summary>View all ${event.details.length} changes</summary><ul>${event.details.map(detail => `<li>${escapeHtml(detail)}</li>`).join("")}</ul></details>` : ""}</td>
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
    .filter(event => matchesAuditView(event, "activity"))
    .slice()
    .sort((a, b) => new Date(b.dateValue || 0) - new Date(a.dateValue || 0))
    .slice(0, 5);

  count.textContent = `${latestEvents.length} recent event${latestEvents.length === 1 ? "" : "s"}`;
  list.innerHTML = latestEvents.length
    ? latestEvents.map(event => `
      <li>
        <span>${formatDate(event.dateValue)}</span>
        <strong>${escapeHtml(event.moduleName)}</strong>
        <em>${escapeHtml(event.activity)}</em>
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
  void recordAuditEvent("Generated Active Projects Report", "reports");
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
  void recordAuditEvent("Generated Material Usage Report", "reports");
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
  // Payroll-linked expenses are already saved and displayed in the expenses table.
  // Count the same source used by Expense Records to avoid counting payroll twice.
  const expenseRecords = expenses.length;
  const netResult = totalRevenue - totalProjectCost;
  const netMargin = totalRevenue ? (netResult / totalRevenue) * 100 : 0;

  setText("projectReportCount", financialProjects.length);
  setText("financialScope", operationsOnly ? "-" : peso(totalRevenue));
  setText("expenseReportCount", operationsOnly ? "-" : expenseRecords);
  setText("auditCount", canViewAuditLogs() ? `${auditEvents.length}${auditFeed?.state.hasMore ? '+' : ''}` : "-");
  setText("reportRevenue", operationsOnly ? "-" : peso(totalRevenue));
  setText("reportExpenses", operationsOnly ? "-" : peso(totalProjectCost));
  setText("reportProfit", operationsOnly ? "-" : peso(netResult));
  setText("reportMargin", operationsOnly ? "-" : `${netMargin.toFixed(2)}%`);
  setText("reportFeedback", operationsOnly ? "-" : feedback.length);
  setText("reportCoverageSummary", getCoverageText());
  setText("printCoverageText", getPrintCoverageText());
  setText("printGeneratedText", `Generated: ${new Date().toLocaleString("en-PH")}`);

  renderLatestActivity(auditFeed?.state.recentEvents || auditEvents);
  renderReportProjectList(financialProjects);
  renderAuditTable();
}

async function loadReports() {
  const [projectResult, expenseResult, payrollResult, inventoryResult, feedbackResult] = await Promise.all([
    readTable("projects", { orderBy: "created_at" }),
    readTable("expenses", { orderBy: "created_at" }),
    readTable("payroll", { orderBy: "created_at" }),
    readTable("inventory", { orderBy: "created_at" }),
    readTable("feedback", { orderBy: "created_at" })
  ]);

  const loadError = [projectResult, expenseResult, payrollResult, inventoryResult, feedbackResult].find(result => result.error)?.error;

  reportRecords = {
    projects: mergeCurrentRecords(projectResult.error ? [] : projectResult.data, "lemyu_saved_projects", ["id", "project_code"]),
    expenses: expenseResult.error ? [] : expenseResult.data,
    payroll: payrollResult.error ? [] : payrollResult.data,
    inventory: mergeCurrentRecords(inventoryResult.error ? [] : inventoryResult.data, "lemyu_saved_inventory", ["id"]),
    feedback: feedbackResult.error ? [] : feedbackResult.data,
    auditLogs: []
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
    ["auditViewFilter", "view"],
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
      clearTimeout(auditFilterTimer);
      const value = event.target.value || (stateKey === "search" ? "" : "all");
      const apply = async () => {
        auditListState[stateKey] = value;
        auditCurrentPage = 1;
        if (stateKey === 'sort') await auditFeed?.setOldestFirst(value === 'oldest');
        renderAuditTable();
      };
      if (stateKey === 'search') auditFilterTimer = setTimeout(apply, 250);
      else void apply();
    });
  });
}

window.goToAuditPage = async function(page) {
  if (auditBrowsing || auditFeed?.state.loading) return;
  const target = Math.max(Number(page) || 1, 1);
  auditBrowsing = true;
  try {
    // A filter may discard a whole batch. Bound the work per user request;
    // never traverse the entire history just to display one page.
    for (let batches = 0; batches < 3 && auditFeed?.state.hasMore
      && getFilteredAuditEvents().length <= (target - 1) * AUDIT_PAGE_SIZE; batches++) {
      await auditFeed.loadMore();
      if (auditFeed.state.error) break;
    }
    const totalPages = Math.max(1, Math.ceil(getFilteredAuditEvents().length / AUDIT_PAGE_SIZE));
    auditCurrentPage = Math.min(target, totalPages);
  } finally { auditBrowsing = false; renderAuditTable(); }
};

function renderAuditFeed(state) {
  if (!canViewAuditLogs()) { stopAuditLog(true); return; }
  auditEvents = state.events;
  auditLoadError = state.error;
  setText('auditCount', `${auditEvents.length}${state.hasMore ? '+' : ''}`);
  renderLatestActivity(state.recentEvents);
  renderAuditTable();
  const status = state.error
    ? `Could not refresh audit history. ${state.events.length ? 'Loaded records remain available. ' : ''}${state.error}`
    : state.cached ? 'Showing recently saved history; checking for updates...'
    : state.loading ? 'Loading audit history...'
    : state.pending ? 'New audit activity is available.' : state.live;
  setText('auditLoadStatus', status);
  const more = document.getElementById('auditLoadMoreBtn');
  if (more) { more.hidden = !state.hasMore; more.disabled = state.loading; }
  if (more) more.textContent = state.oldestFirst ? 'Load newer records' : 'Load older records';
  const refresh = document.getElementById('auditRefreshBtn');
  if (refresh) {
    refresh.disabled = state.loading;
    refresh.textContent = state.pending ? 'Show new activity' : state.error ? 'Retry refresh' : 'Refresh logs';
  }
  // Coalesce a burst of WebSocket inserts. Older pages stay in place until
  // the user chooses to refresh, rather than jumping while being reviewed.
  if (state.pending && !state.loading && !auditBrowsing && auditCurrentPage === 1
    && auditListState.sort === 'newest' && document.visibilityState !== 'hidden' && !auditRefreshTimer) {
    auditRefreshTimer = setTimeout(() => {
      auditRefreshTimer = null;
      if (!auditStopped && !auditBrowsing && auditCurrentPage === 1 && auditListState.sort === 'newest') void auditFeed?.refresh();
    }, 1000);
  }
}

function stopAuditLog(clearCache = false) {
  auditStopped = true;
  clearTimeout(auditRefreshTimer); clearTimeout(auditFilterTimer); clearInterval(auditPollTimer);
  auditRefreshTimer = null; auditFilterTimer = null; auditPollTimer = null;
  if (clearCache) auditFeed?.clearCache();
  auditFeed?.dispose();
  auditFeed = null;
  auditAuthSubscription?.unsubscribe();
  auditAuthSubscription = null;
  if (clearCache) {
    auditEvents = []; auditLoadError = '';
    if (auditTable) auditTable.innerHTML = '';
    setText('auditCount', '-');
    renderLatestActivity([]);
    if (auditSection) auditSection.style.display = 'none';
  }
}

async function startAuditLog() {
  if (!auditTable) return;
  if (!canViewAuditLogs()) { stopAuditLog(true); return; }
  auditStopped = false;
  auditEvents = []; auditLoadError = '';
  auditTable.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading recent audit records...</td></tr>`;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (auditStopped) return;
    if (error || !data?.session?.user?.id) throw new Error('Sign in again to view audit history.');
    auditIdentity = data.session.user.id;
    let storage;
    try { storage = window.sessionStorage; } catch { /* In-memory loading still works. */ }
    auditFeed = createAuditFeed(supabase, {
      scope: `${auditIdentity}:${localStorage.getItem('lemyu_user_role') || ''}`,
      storage, onChange: renderAuditFeed
    });
    const { data: auth } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session || session.user.id !== auditIdentity) stopAuditLog(true);
    });
    auditAuthSubscription = auth.subscription;
    await auditFeed.start();
    if (auditStopped) return;
    if (!getFilteredAuditEvents().length && auditFeed.state.hasMore && !auditFeed.state.error) {
      await window.goToAuditPage(1);
    }
    // Only head checks during idle time. Never reload business/report tables.
    auditPollTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void auditFeed?.checkLatest();
    }, 60_000);
  } catch (error) {
    auditLoadError = error.message || 'Unable to load audit history.';
    renderAuditTable();
    setText('auditLoadStatus', auditLoadError);
  }
}

document.getElementById('auditLoadMoreBtn')?.addEventListener('click', () => { void auditFeed?.loadMore(); });
document.getElementById('auditRefreshBtn')?.addEventListener('click', () => {
  auditCurrentPage = 1;
  if (auditFeed) void auditFeed.refresh(); else void startAuditLog();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' && !auditStopped) {
    if (auditFeed?.state.pending) renderAuditFeed(auditFeed.state);
    else void auditFeed?.checkLatest();
  }
});
window.addEventListener('pagehide', () => stopAuditLog());
window.addEventListener('pageshow', event => { if (event.persisted) void startAuditLog(); });

document.getElementById("generateSummaryReportBtn")?.addEventListener("click", () => {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    alert("Please allow pop-ups to generate the Management Summary report.");
    return;
  }
  renderReports();
  const metrics = [
    ["Project Records", "projectReportCount"],
    ["Total Revenue", "reportRevenue"],
    ["Project Cost Estimated", "reportExpenses"],
    ["Estimated Profit", "reportProfit"],
    ["Net Result Margin", "reportMargin"],
    ["Client Feedback", "reportFeedback"]
  ].filter(([, id]) => (!isOperationsScope() || id === "projectReportCount")
    && (!isFinanceScope() || id !== "reportFeedback"));
  const rows = metrics.map(([label, id]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(document.getElementById(id)?.textContent || "-")}</td></tr>`).join("");
  reportWindow.document.write(`<!DOCTYPE html>
    <html lang="en"><head><meta charset="UTF-8"><title>Management Summary Report</title>
    <style>
      @page{size:A4;margin:18mm;}
      body{font-family:Arial,sans-serif;color:#071f3d;margin:0;background:#f4f7fb;}
      main{max-width:850px;margin:24px auto;padding:32px;background:#fff;}
      small{font-weight:700;letter-spacing:.06em;color:#51657d;}
      h1{font-size:25px;margin:10px 0;}
      p{color:#42566f;font-size:13px;line-height:1.5;}
      table{width:100%;border-collapse:collapse;margin-top:24px;}
      th,td{padding:14px;border:1px solid #d9e3ee;text-align:left;}
      th{background:#eef4fa;}td{text-align:right;font-weight:700;}
      .actions{text-align:right;}button{padding:10px 16px;border:0;border-radius:6px;background:#174f80;color:#fff;cursor:pointer;}
      @media print{body{background:#fff;}main{margin:0;padding:0;}.actions{display:none;}}
    </style></head><body><main>
    <div class="actions"><button type="button" onclick="window.print()">Print / Save PDF</button></div>
    <small>LEMYU FIBER OPTIC INSTALLATION AND SERVICES</small>
    <h1>Management Summary Report</h1>
    <p>${escapeHtml(getPrintCoverageText())}<br>Generated: ${escapeHtml(new Date().toLocaleString("en-PH"))}</p>
    <table><tbody>${rows}</tbody></table>
    </main></body></html>`);
  reportWindow.document.close();
  void recordAuditEvent("Generated management summary", "reports");
});

applyFinanceReportScope();
applyOperationsReportScope();
applyAuditAccessScope();
bindCoverageControls();
bindAuditFilters();
void startAuditLog();
loadReports();
