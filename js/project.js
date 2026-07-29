import { supabase, peso, escapeHtml, formatDate, updateWithOptionalColumns } from "./supabase.js";

const form = document.getElementById("projectForm");
const tbody = document.getElementById("projectTable");

let editingId = null;
let editingProjectCode = "";
let allProjects = [];
let activeSmartContract = null;
let projectCurrentPage = 1;
let pendingProgressFiles = [];
const PROJECT_UPLOAD_BUCKETS = ["contracts", "progress-files"];
const MARK_SIGNATURE_IMAGE = "assets/mark-lyndon-lawas-signature.jpg";
const LOCAL_PROJECTS_KEY = "lemyu_saved_projects";
const LOCAL_PPR_CONFIGS_KEY = "lemyu_ppr_report_configs";
const MATERIAL_CATALOG_KEY = "lemyu_material_catalog";
const LOCAL_INVENTORY_KEY = "lemyu_saved_inventory";
const MATERIAL_UNIT_OPTIONS = ["PCS", "MTR", "SET", "ROLL", "BOX", "PACK", "UNIT", "LOT"];
const PROJECT_PAGE_SIZE = 10;
const projectListState = {
  search: "",
  status: "all",
  date: "all",
  type: "all",
  sort: "newest"
};
const PROJECT_LIST_STATE_KEY = "lemyu_project_monitoring_list_state";
let pendingDetailProjectId = new URLSearchParams(window.location.search).get("view") || "";

function getProjectListStateSnapshot() {
  return {
    page: projectCurrentPage,
    search: projectListState.search,
    status: projectListState.status,
    date: projectListState.date,
    type: projectListState.type,
    sort: projectListState.sort,
    scrollY: window.scrollY || 0
  };
}

function saveProjectListState() {
  sessionStorage.setItem(PROJECT_LIST_STATE_KEY, JSON.stringify(getProjectListStateSnapshot()));
}

function restoreProjectListState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PROJECT_LIST_STATE_KEY) || "{}");
    projectListState.search = saved.search ?? projectListState.search;
    projectListState.status = saved.status ?? projectListState.status;
    projectListState.date = saved.date ?? projectListState.date;
    projectListState.type = saved.type ?? projectListState.type;
    projectListState.sort = saved.sort ?? projectListState.sort;
    projectCurrentPage = Number(saved.page || projectCurrentPage) || 1;

    const fieldMap = {
      projectSearch: projectListState.search,
      projectStatusFilter: projectListState.status,
      projectDateFilter: projectListState.date,
      projectTypeFilter: projectListState.type,
      projectSort: projectListState.sort
    };

    Object.entries(fieldMap).forEach(([id, value]) => {
      const field = document.getElementById(id);
      if (field) field.value = value;
    });

    return Number(saved.scrollY || 0);
  } catch {
    return 0;
  }
}

function isFinanceScope() {
  return document.body.dataset.roleScope === "finance"
    || String(localStorage.getItem("lemyu_user_role") || "").toLowerCase() === "finance officer/accountant";
}

function isOperationsScope() {
  return document.body.dataset.roleScope === "operations"
    || String(localStorage.getItem("lemyu_user_role") || "").toLowerCase() === "project manager/operations staff";
}

function applyFinanceProjectScope() {
  if (!isFinanceScope()) return;

  const heroText = document.querySelector(".hero p");
  if (heroText) {
    heroText.textContent = "Review project cost, budget, expenses, balance, and profit only. Operational project controls are not available for this role.";
  }

  const editSection = document.getElementById("editProjectSection");
  if (editSection) editSection.style.display = "none";
}

function applyOperationsProjectScope() {
  if (!isOperationsScope()) return;

  const heroText = document.querySelector(".hero p");
  const heroTitle = document.querySelector(".hero h1");
  if (heroTitle) heroTitle.textContent = "Project Monitoring";
  if (heroText) {
    heroText.textContent = "Review project records, progress status, and project reports without financial details.";
  }

  const editSection = document.getElementById("editProjectSection");
  if (editSection) editSection.style.display = "none";

}

function assetUrl(path) {
  return new URL(path, window.location.href).href;
}

function markSignatureSvg(className = "signature-svg") {
  return `<img class="${className}" src="${assetUrl(MARK_SIGNATURE_IMAGE)}" alt="Mark Lyndon Lawas signature">`;
}

function escapeProjectHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function uploadProjectFile(file, folder = "project-files", buckets = PROJECT_UPLOAD_BUCKETS) {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filePath = `${folder}/${Date.now()}_${safeName}`;
  let lastError = null;

  for (const bucket of buckets) {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file);

    if (!uploadError) {
      const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      return {
        bucket,
        filePath,
        publicUrl: data.publicUrl
      };
    }

    lastError = uploadError;

    if (!/bucket/i.test(uploadError.message || "")) {
      break;
    }
  }

  throw lastError || new Error("Unable to upload file.");
}

function isImageFile(fileName = "", fileUrl = "") {
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(fileName) || /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(fileUrl);
}

function isPdfFile(fileName = "", fileUrl = "") {
  return /\.pdf$/i.test(fileName) || /\.pdf(\?|$)/i.test(fileUrl);
}

function isVideoFile(fileName = "", fileUrl = "") {
  return /\.(mp4|webm|ogg|mov)$/i.test(fileName) || /\.(mp4|webm|ogg|mov)(\?|$)/i.test(fileUrl);
}

function safePprText(value, fallback = "Not Available") {
  const text = String(value ?? "").trim();
  return text && text !== "-" ? escapeProjectHtml(text) : fallback;
}

function getPprGeneratedBy() {
  return getCurrentAccountName() || localStorage.getItem("lemyu_user_email") || "FinSight User";
}

function getExplicitProjectProgress(project = {}) {
  const candidates = [
    project.completion_percentage,
    project.progress_percentage,
    project.progress,
    project.percent_complete
  ];
  const raw = candidates.find(value => value !== null && value !== undefined && value !== "");
  if (raw !== null && raw !== undefined && raw !== "") {
    const value = Number(raw);
    if (Number.isFinite(value)) return Math.min(Math.max(value, 0), 100);
  }
  return "";
}

function getProjectProgressInputValue(input) {
  const value = Number(input?.value || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), 100);
}

function getPprCompletionValue(project = {}) {
  const explicitProgress = getExplicitProjectProgress(project);
  if (explicitProgress !== "") return explicitProgress;

  const status = String(project.status || "").trim().toLowerCase();
  if (status === "completed") return 100;
  if (status === "ongoing") return 50;
  if (status === "approved") return 25;
  if (status === "delayed" || status === "on hold") return 40;
  if (status === "cancelled" || status === "rejected") return 0;
  if (status === "pending" || status === "draft" || status === "not started") return 0;
  return 0;
}

function getPprStatusClass(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (/completed/.test(normalized)) return "success";
  if (/delayed|hold/.test(normalized)) return "warning";
  if (/cancel/.test(normalized)) return "critical";
  if (/ongoing|approved/.test(normalized)) return "active";
  return "neutral";
}

function getPprDaysRemaining(project = {}) {
  if (!project.target_completion) return "Not Available";
  const target = new Date(project.target_completion);
  if (Number.isNaN(target.getTime())) return "Not Available";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const days = Math.ceil((target - today) / 86400000);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  return `${days} day${days === 1 ? "" : "s"} remaining`;
}

function getPprFileDate(file = {}) {
  return file.date_taken || file.uploaded_at || file.created_at || file.updated_at || "";
}

function getPprPhotoCategory(file = {}) {
  const category = String(file.category || file.photo_category || file.stage || "other").trim().toLowerCase();
  const allowed = ["before", "ongoing", "completed", "testing", "turnover", "other"];
  return allowed.includes(category) ? category : "other";
}

function getPprPhotoSortValue(file = {}) {
  const orderMap = { before: 1, ongoing: 2, testing: 3, completed: 4, turnover: 5, other: 6 };
  const displayOrder = Number(file.display_order ?? 9999);
  const dateValue = new Date(getPprFileDate(file) || 0).getTime() || 0;
  return {
    category: orderMap[getPprPhotoCategory(file)] || 6,
    displayOrder: Number.isFinite(displayOrder) ? displayOrder : 9999,
    dateValue
  };
}

function getPprPhotoTitle(file = {}, index = 0) {
  return file.photo_title || file.title || file.file_name || `Project Photograph ${index + 1}`;
}

function getPprPhotoDescription(file = {}) {
  return file.description || file.caption || file.comment || "";
}

function getPprPhotos(projectFiles = []) {
  return projectFiles
    .filter(file => isImageFile(file.file_name || "", file.file_url || ""))
    .filter(file => file.is_visible_in_report !== false)
    .sort((a, b) => {
      const sortA = getPprPhotoSortValue(a);
      const sortB = getPprPhotoSortValue(b);
      return sortA.category - sortB.category
        || sortA.displayOrder - sortB.displayOrder
        || sortA.dateValue - sortB.dateValue;
    });
}

function chunkPprPhotos(photos = [], size = 4) {
  if (!photos.length) return [[]];
  const chunks = [];
  for (let index = 0; index < photos.length; index += size) {
    chunks.push(photos.slice(index, index + size));
  }
  return chunks;
}

function getPprScopeItems(project = {}) {
  const quotationType = getProjectQuotationType(project);
  const details = quotationType === "manpower"
    ? getManpowerQuotationDetails(project)
    : getCctvQuotationDetails(project);
  const source = details.workDescription || details.scope || details.intro || project.remarks || project.project_title || "";
  return String(source || "")
    .split(/\r?\n|;|•/)
    .map(item => item.trim())
    .filter(Boolean);
}

function formatPprValue(value, formatter = value => value, fallback = "Not Available") {
  if (value === null || value === undefined || value === "") return fallback;
  return formatter(value);
}

function buildPprQrUrl(projectId) {
  const feedbackLink = `${window.location.origin}${window.location.pathname.replace("projects.html", "public-feedback.html")}?project_id=${projectId}`;
  return {
    feedbackLink,
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(feedbackLink)}`
  };
}

function getLocalPprConfigs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PPR_CONFIGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLocalPprConfig(projectId, config = {}) {
  if (!projectId) return;
  const configs = getLocalPprConfigs();
  configs[projectId] = config;
  localStorage.setItem(LOCAL_PPR_CONFIGS_KEY, JSON.stringify(configs));
}

function normalizePprConfig(config = {}) {
  const source = typeof config === "string"
    ? (() => {
        try { return JSON.parse(config); } catch { return {}; }
      })()
    : (config || {});

  return {
    coverageStart: source.coverageStart || source.coverage_start || "",
    coverageEnd: source.coverageEnd || source.coverage_end || "",
    executiveSummary: source.executiveSummary || source.executive_summary || "",
    accomplishments: source.accomplishments || "",
    issues: source.issues || "",
    correctiveActions: source.correctiveActions || source.corrective_actions || "",
    nextActivities: source.nextActivities || source.next_activities || "",
    overallRemarks: source.overallRemarks || source.overall_remarks || "",
    includeFinancialSummary: source.includeFinancialSummary !== false && source.include_financial_summary !== false
  };
}

function getProjectPprConfig(project = {}) {
  return normalizePprConfig(project.ppr_report_config || getLocalPprConfigs()[project.id] || {});
}

function getPprSectionText(value = "") {
  const text = String(value || "").trim();
  return text ? escapeProjectHtml(text) : "No information was recorded for this section.";
}

function getPprCoveragePeriod(project = {}, config = {}) {
  if (config.coverageStart || config.coverageEnd) {
    return `${formatDate(config.coverageStart, "Not Available")} to ${formatDate(config.coverageEnd, "Not Available")}`;
  }

  return project.start_date || project.target_completion
    ? `${formatDate(project.start_date, "Not Available")} to ${formatDate(project.target_completion, "Not Available")}`
    : "Not Available";
}

function getQuotationItemsFromForm(bodyId = "quotationItemsBody") {
  const rows = [...document.querySelectorAll(`#${bodyId} tr`)];

  return rows.map(row => {
    const description = row.querySelector(".quotation-description")?.value.trim() || "";
    const qty = Number(row.querySelector(".quotation-qty")?.value || 0);
    const unit = row.querySelector(".quotation-unit")?.value.trim() || "";
    const amountInput = Number(row.querySelector(".quotation-amount")?.value || 0);
    const amount = amountInput;

    return {
      description,
      qty,
      unit,
      amount
    };
  }).filter(item => item.description || item.qty || item.unit || item.amount);
}

function bindQuotationRow(row) {
  row.querySelector(".add-quotation-item-btn")?.addEventListener("click", () => {
    const body = row.closest("tbody");
    if (body?.id) {
      addQuotationItem(body.id);
    }
  });
  return row;
}

function createQuotationItemRow(item = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="quotation-description" placeholder="e.g. MOBILIZATION" value="${item.description || ""}"></td>
    <td><input class="quotation-qty" type="number" min="0" step="0.01" value="${item.qty ?? 1}"></td>
    <td><input class="quotation-unit" placeholder="e.g. LOT / DAY / PCS" value="${item.unit || ""}"></td>
    <td><input class="quotation-amount" type="number" min="0" step="0.01" value="${item.amount ?? 0}"></td>
    <td class="quotation-action-cell">
      <button type="button" class="add-quotation-item-btn">Add Item</button>
      <button type="button" class="danger-btn" onclick="removeQuotationItem(this)">Delete</button>
    </td>
  `;
  bindQuotationRow(tr);
  return tr;
}

function resetQuotationItems(items = [], bodyId = "quotationItemsBody") {
  const body = document.getElementById(bodyId);

  if (!body) return;

  const rows = items.length ? items : [{ description: "", qty: 1, unit: "", amount: 0 }];
  body.innerHTML = "";
  rows.forEach(item => body.appendChild(createQuotationItemRow(item)));
}

window.addQuotationItem = function(bodyId = "quotationItemsBody") {
  document.getElementById(bodyId)?.appendChild(createQuotationItemRow());
};

window.removeQuotationItem = function(button) {
  const body = document.getElementById("quotationItemsBody");
  const row = button.closest("tr");

  if (!body || !row) return;

  row.remove();

  if (!body.children.length) {
    body.appendChild(createQuotationItemRow());
  }
};

function getStorageReferenceFromUrl(fileUrl = "") {
  const marker = "/storage/v1/object/public/";
  const markerIndex = fileUrl.indexOf(marker);

  if (markerIndex < 0) return null;

  const publicPath = fileUrl.slice(markerIndex + marker.length).split("?")[0];
  const slashIndex = publicPath.indexOf("/");

  if (slashIndex < 0) return null;

  return {
    bucket: decodeURIComponent(publicPath.slice(0, slashIndex)),
    path: decodeURIComponent(publicPath.slice(slashIndex + 1))
  };
}

function getSmartContracts() {
  return JSON.parse(localStorage.getItem("lemyu_smart_contracts") || "[]");
}

function saveSmartContracts(records) {
  localStorage.setItem("lemyu_smart_contracts", JSON.stringify(records));
}

function canViewInternalContractReview() {
  const role = String(localStorage.getItem("lemyu_user_role") || "").toLowerCase();
  return ["admin", "owner", "hr"].includes(role);
}

function getQuotationItemsMap() {
  return JSON.parse(localStorage.getItem("lemyu_quotation_items") || "{}");
}

function saveQuotationItemsMap(records) {
  localStorage.setItem("lemyu_quotation_items", JSON.stringify(records));
}

function saveLocalQuotationItems(projectId, items) {
  if (!projectId) return;

  const records = getQuotationItemsMap();
  records[projectId] = items;
  saveQuotationItemsMap(records);
}

function getLocalQuotationItems(projectId) {
  return getQuotationItemsMap()[projectId] || [];
}

function getClientNamesMap() {
  return JSON.parse(localStorage.getItem("lemyu_client_names") || "{}");
}

function saveClientNamesMap(records) {
  localStorage.setItem("lemyu_client_names", JSON.stringify(records));
}

function saveLocalClientName(projectId, clientName) {
  if (!projectId) return;

  const records = getClientNamesMap();
  records[projectId] = clientName || "";
  saveClientNamesMap(records);
}

function getProjectClientName(project) {
  return project?.client_contact_name || getClientNamesMap()[project?.id] || "";
}

function getDownPaymentsMap() {
  return JSON.parse(localStorage.getItem("lemyu_down_payments") || "{}");
}

function saveDownPaymentsMap(records) {
  localStorage.setItem("lemyu_down_payments", JSON.stringify(records));
}

function saveLocalDownPayment(projectId, amount) {
  if (!projectId) return;

  const records = getDownPaymentsMap();
  records[projectId] = Number(amount || 0);
  saveDownPaymentsMap(records);
}

function getProjectDownPayment(project) {
  return Number(project?.down_payment ?? getDownPaymentsMap()[project?.id] ?? 0);
}

function getPercentFromAmount(amount, total) {
  const totalValue = Number(total || 0);
  if (totalValue <= 0) return 0;
  return (Number(amount || 0) / totalValue) * 100;
}

function getInventoryProjectCodesMap() {
  return JSON.parse(localStorage.getItem("lemyu_inventory_project_codes") || "{}");
}

function getLocalInventoryRecords() {
  try {
    return JSON.parse(localStorage.getItem("lemyu_saved_inventory") || "[]");
  } catch {
    return [];
  }
}

function mergeInventoryRecords(supabaseInventory = [], localInventory = getLocalInventoryRecords()) {
  const merged = [...supabaseInventory];

  localInventory.forEach(localItem => {
    const exists = merged.some(item => {
      return String(item.id || "") === String(localItem.id || "")
        || (
          String(item.name || "").toLowerCase() === String(localItem.name || "").toLowerCase()
          && String(getInventoryProjectCode(item) || "").toLowerCase() === String(getInventoryProjectCode(localItem) || "").toLowerCase()
        );
    });

    if (!exists) merged.push(localItem);
  });

  return merged;
}

function getInventoryUnitsMap() {
  return JSON.parse(localStorage.getItem("lemyu_inventory_units") || "{}");
}

function getInventoryProjectCode(item) {
  return item?.project_code || getInventoryProjectCodesMap()[item?.id] || "";
}

function getInventoryUnit(item) {
  return item?.unit || getInventoryUnitsMap()[item?.id] || "";
}

function createContractId() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `SC-${stamp}-${random}`;
}

function getProjectById(id) {
  return allProjects.find(project => project.id == id);
}

function isLocalProjectId(id = "") {
  return String(id || "").startsWith("local-");
}

async function getProjectForAction(id, actionLabel = "Project") {
  let project = getProjectById(id);

  if (project) return project;

  if (isLocalProjectId(id)) {
    alert(`${actionLabel} record was not found locally. Please refresh the Project Monitoring List.`);
    return null;
  }

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    alert(error.message);
    return null;
  }

  return data;
}

function getLocalSavedProjects() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PROJECTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalProjectMirror(project) {
  if (!project) return;

  const records = getLocalSavedProjects();
  const existingIndex = records.findIndex(item => {
    return String(item.id || "") === String(project.id || "")
      || String(item.project_code || "").toLowerCase() === String(project.project_code || "").toLowerCase();
  });

  const localRecord = {
    ...project,
    created_at: project.created_at || new Date().toISOString()
  };

  const nextRecords = existingIndex >= 0
    ? records.map((item, index) => index === existingIndex ? { ...item, ...localRecord } : item)
    : [localRecord, ...records];

  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(nextRecords));
}

function updateLocalProjectMirror(projectId, updates) {
  const records = getLocalSavedProjects();
  const existing = records.find(project => String(project.id || "") === String(projectId || ""));
  const updatedProject = {
    ...(existing || getProjectById(projectId) || {}),
    ...updates,
    id: projectId,
    updated_at: new Date().toISOString()
  };

  saveLocalProjectMirror(updatedProject);
  return updatedProject;
}

function deleteLocalProjectMirror(project) {
  if (!project) return;

  const projectId = String(project.id || "");
  const projectCode = String(project.project_code || "").toLowerCase();
  const records = getLocalSavedProjects().filter(item => {
    return String(item.id || "") !== projectId
      && String(item.project_code || "").toLowerCase() !== projectCode;
  });

  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(records));
}

function deleteProjectMapEntry(key, projectId) {
  if (!projectId) return;

  const records = JSON.parse(localStorage.getItem(key) || "{}");
  delete records[projectId];
  localStorage.setItem(key, JSON.stringify(records));
}

function deleteLocalProjectRelatedRecords(project) {
  const projectId = String(project?.id || "");

  deleteLocalProjectMirror(project);
  deleteProjectMapEntry("lemyu_quotation_items", projectId);
  deleteProjectMapEntry("lemyu_client_names", projectId);
  deleteProjectMapEntry("lemyu_down_payments", projectId);
  removeLocalInventoryByProjectCode(project?.project_code || "");

  const smartContracts = getSmartContracts().filter(contract => {
    return String(contract.project_id || "") !== projectId
      && String(contract.project_code || "").toLowerCase() !== String(project?.project_code || "").toLowerCase();
  });
  saveSmartContracts(smartContracts);
}

function mergeProjects(supabaseProjects = [], localProjects = getLocalSavedProjects()) {
  const merged = [...supabaseProjects];

  localProjects.forEach(localProject => {
    const existingIndex = merged.findIndex(project => {
      return String(project.id || "") === String(localProject.id || "")
        || String(project.project_code || "").toLowerCase() === String(localProject.project_code || "").toLowerCase();
    });

    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...localProject,
        ...merged[existingIndex],
        quotation_type: merged[existingIndex].quotation_type || localProject.quotation_type,
        quotation_items: merged[existingIndex].quotation_items || localProject.quotation_items,
        client_email: merged[existingIndex].client_email || localProject.client_email,
        ppr_prepared_by: merged[existingIndex].ppr_prepared_by || localProject.ppr_prepared_by,
        remarks: merged[existingIndex].remarks || localProject.remarks
      };
    } else {
      merged.push(localProject);
    }
  });

  return merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function getProjectQuotationType(project = {}) {
  const type = String(project.quotation_type || "").toLowerCase();

  if (type === "cctv") return "cctv";
  if (type === "manpower") return "manpower";
  if (/cctv|camera|dvr|supply/i.test(project.remarks || project.project_title || "")) return "cctv";
  return "manpower";
}

function getProjectQuotationLabel(project = {}) {
  return getProjectQuotationType(project) === "cctv" ? "CCTV Quotation" : "Manpower Quotation";
}

function isApprovedQuotation(project = {}) {
  return String(project.status || "").trim().toLowerCase() === "approved";
}

function getContractAction(project = {}) {
  if (isApprovedQuotation(project)) {
    return `<a href="#" onclick="viewProjectContract('${project.id}'); return false;">Generate Contract</a>`;
  }

  return `
    <span class="disabled-action" title="A contract can only be generated from an approved quotation.">Generate Contract</span>
    <small class="contract-disabled-message">A contract can only be generated from an approved quotation.</small>
  `;
}

function cleanSignatoryName(value = "") {
  const cleaned = String(value || "").trim();
  return cleaned && cleaned !== "-" ? cleaned : "";
}

function getCurrentAccountName() {
  return cleanSignatoryName(
    localStorage.getItem("lemyu_user_name")
    || localStorage.getItem("lemyu_username")
    || ""
  );
}

function getPrintableViewControlsStyle() {
  return `
        .print-view-actions{
          position:sticky;
          top:0;
          z-index:20;
          display:flex;
          justify-content:flex-end;
          gap:8px;
          width:100%;
          margin:0 0 14px;
          padding:10px 0;
          background:#fff;
          border-bottom:1px solid #d8e5f2;
        }
        .print-view-actions button{
          border:1px solid #1f4f7a;
          border-radius:5px;
          padding:8px 12px;
          background:#1f4f7a;
          color:#fff;
          font:700 12px Arial, Helvetica, sans-serif;
          cursor:pointer;
        }
        .print-view-actions .secondary-print-action{
          background:#fff;
          color:#1f4f7a;
        }
        @media print{
          .print-view-actions{
            display:none !important;
          }
        }`;
}

function getPrintableViewControls() {
  return `
      <div class="print-view-actions">
        <button type="button" class="secondary-print-action" onclick="if (window.opener && !window.opener.closed) { window.opener.focus(); } window.close();">Back to Project List</button>
        <button type="button" onclick="window.print()">Print</button>
      </div>`;
}

function getContractDateStamp(dateValue = new Date()) {
  const date = new Date(dateValue);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().slice(0, 10).replaceAll("-", "");
}

function getReadableDate(value = new Date()) {
  const date = new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function getContractNumber(project = {}) {
  const sourceDate = project.approved_at || project.updated_at || project.created_at || new Date();
  const code = String(project.project_code || project.id || "PROJECT").replace(/[^\w-]/g, "").slice(0, 14) || "PROJECT";
  return `CTR-${getContractDateStamp(sourceDate)}-${code}`;
}

function getQuotationNumber(project = {}) {
  const sourceDate = project.approved_at || project.updated_at || project.created_at || new Date();
  const code = String(project.project_code || project.id || "PROJECT").replace(/[^\w-]/g, "").slice(0, 14) || "PROJECT";
  const prefix = getProjectQuotationType(project) === "cctv" ? "SIQ" : "MP";
  return `${prefix}-${getContractDateStamp(sourceDate)}-${code}`;
}

function getContractFileName(contract = {}) {
  const contractNumber = String(contract.contract_number || contract.id || "CONTRACT").replace(/[^\w-]/g, "_");
  const clientName = String(contract.client_name || "CLIENT").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  return `Contract_${contractNumber}_${clientName || "CLIENT"}.pdf`;
}

function getProjectDurationText(project = {}) {
  const durationDaysMatch = String(project.remarks || "").match(/^project duration days:\s*(.*)$/im);
  if (durationDaysMatch) {
    const days = Math.max(0, Math.trunc(Number(String(durationDaysMatch[1]).replace(/[^0-9.]/g, "")) || 0));
    if (days > 0) return `${days} day${days === 1 ? "" : "s"}`;
  }

  if (getProjectQuotationType(project) === "manpower") {
    const manpower = getManpowerQuotationDetails(project);
    if (Number(manpower.durationDays || 0) > 0) {
      const days = Number(manpower.durationDays);
      return `${days} day${days === 1 ? "" : "s"}`;
    }
  }

  if (project.start_date && project.target_completion) {
    return `${formatDate(project.start_date)} to ${formatDate(project.target_completion)}`;
  }

  if (project.target_completion) {
    return `Until ${formatDate(project.target_completion)}`;
  }

  return "As stated in the approved quotation and mutually confirmed project schedule.";
}

function normalizeContractItem(item = {}, fallbackDescription = "Project service") {
  const qty = getQuotationQty(item.qty);
  const unitPrice = Number(item.unitPrice ?? item.price ?? item.amount ?? 0);
  const amount = Number(item.total_amount ?? item.line_total ?? (qty * unitPrice) ?? 0);

  return {
    description: item.name || item.description || item.details || fallbackDescription,
    details: item.details || item.description || "",
    qty,
    unit: item.unit || "",
    unitPrice,
    amount
  };
}

async function getContractQuotationItems(project = {}) {
  if (getProjectQuotationType(project) === "manpower") {
    const manpower = getManpowerQuotationDetails(project);
    const fallbackQty = Number(manpower.workers || 1) || 1;
    const fallbackUnitPrice = Number(project.contract_amount || 0)
      ? Number(project.contract_amount || 0) / fallbackQty
      : Number(manpower.days || 0) * Number(manpower.rate || 0);
    const items = (manpower.items || []).length
      ? manpower.items
      : [{
          description: manpower.workDescription || manpower.position || project.project_title || "Manpower Services",
          qty: fallbackQty,
          unitPrice: fallbackUnitPrice
        }];

    return items.map(item => normalizeContractItem(item, manpower.workDescription || project.project_title || "Manpower Services"));
  }

  const savedQuotationItems = Array.isArray(project.quotation_items)
    ? project.quotation_items
    : getLocalQuotationItems(project.id);
  let linkedInventoryItems = [];

  if (!savedQuotationItems.length && project.project_code) {
    const { data = [], error } = await supabase.from("inventory").select("*");
    if (!error) {
      linkedInventoryItems = mergeInventoryRecords(data)
        .filter(item => String(getInventoryProjectCode(item) || "").toLowerCase() === String(project.project_code || "").toLowerCase())
        .map(item => ({
          name: item.name || item.material_name || "Material",
          description: item.description || "",
          qty: getQuotationQty(item.qty),
          unit: getInventoryUnit(item),
          price: Number(item.price || item.unit_price || 0),
          total_amount: getQuotationQty(item.qty) * Number(item.price || item.unit_price || 0)
        }));
    }
  }

  const rows = (savedQuotationItems.length ? savedQuotationItems : linkedInventoryItems)
    .map(item => normalizeContractItem(item, project.project_title || "Supply and installation services"))
    .filter(item => item.description || item.amount);

  return rows.length
    ? rows
    : [normalizeContractItem({ description: project.project_title || "Supply and installation services", qty: 1, unitPrice: Number(project.contract_amount || 0) })];
}

async function buildApprovedQuotationSnapshot(project = {}) {
  const quotationType = getProjectQuotationType(project);
  const manpower = quotationType === "manpower" ? getManpowerQuotationDetails(project) : null;
  const cctv = quotationType === "cctv" ? getCctvQuotationDetails(project) : null;
  const items = await getContractQuotationItems(project);
  const lineTotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalContractPrice = Number(project.contract_amount || 0) || lineTotal;
  const downPaymentAmount = getProjectDownPayment(project);
  const downPaymentPercent = getPercentFromAmount(downPaymentAmount, totalContractPrice);
  const balanceDue = Math.max(totalContractPrice - downPaymentAmount, 0);
  const scope = manpower?.workDescription || manpower?.scope || cctv?.intro || project.remarks || project.project_title || "Project services as stated in the approved quotation.";
  const terms = manpower?.terms || cctv?.terms || "Payment and implementation terms shall follow the approved quotation and mutually confirmed billing schedule.";

  return {
    quotation_type: quotationType,
    quotation_label: getProjectQuotationLabel(project),
    contract_number: getContractNumber(project),
    quotation_number: getQuotationNumber(project),
    effective_date: getReadableDate(new Date()),
    client_name: project.client_name || getProjectClientName(project) || "-",
    client_authorized_representative: getProjectClientName(project) || "",
    project_title: project.project_title || "-",
    project_description: manpower?.workDescription || cctv?.intro || project.project_title || "-",
    location: project.location || "-",
    scope_of_services: scope,
    project_duration: getProjectDurationText(project),
    start_date: project.start_date || "",
    target_completion: project.target_completion || "",
    items,
    total_contract_price: totalContractPrice,
    down_payment_percent: downPaymentPercent,
    down_payment_amount: downPaymentAmount,
    remaining_balance: balanceDue,
    payment_terms: terms,
    other_terms: manpower?.additionalComments || cctv?.note || project.remarks || "",
    source_project_id: project.id,
    source_project_code: project.project_code || "",
    source_status: project.status || "Pending",
    source_updated_at: project.updated_at || project.created_at || new Date().toISOString()
  };
}

window.generateProjectQuotation = function(projectId, options = {}) {
  const project = getProjectById(projectId);
  const type = getProjectQuotationType(project);
  return type === "cctv"
    ? window.generateSupplyInstallationQuotation(projectId, options)
    : window.generateQuotation(projectId, options);
};

function generateProjectCode(projects = []) {
  const maxNumber = projects.reduce((max, project) => {
    const match = String(project.project_code || "").match(/(\d+)$/);
    const number = match ? Number(match[1]) : 0;
    return Math.max(max, number);
  }, 0);

  return `PRJ-${String(maxNumber + 1).padStart(4, "0")}`;
}

function setNextProjectCode(projects = allProjects) {
  const field = document.getElementById("project_code");

  if (!field || editingId) return;

  field.value = generateProjectCode(projects);
}

function getContractLogo(project) {
  if (isImageFile(project?.contract_file_name || "", project?.contract_file_url || "")) {
    return project.contract_file_url;
  }

  return "assets/logo.jpg";
}

function getProjectFinancials(project, expenses = []) {
  const projectExpenses = expenses
    .filter(exp => exp.project_id === project.id)
    .reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  return {
    budget: Number(project.project_budget || 0),
    contract: Number(project.contract_amount || 0),
    downPayment: getProjectDownPayment(project),
    tax: getProjectTaxAmount(project),
    expenses: projectExpenses + Number(project.initial_actual_cost || 0)
  };
}

function optionalPeso(value, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : peso(value);
}

function optionalPercent(value, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : `${Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}%`;
}

function getQuotationQty(value) {
  const qty = Number(value || 0);
  return qty > 0 ? qty : 1;
}

function hasQuotationPrice(item = {}) {
  return Number(item.unitPrice || 0) > 0 || Number(item.amount || 0) > 0;
}

function getProjectTaxPercent(project) {
  return project?.tax_amount === null || project?.tax_amount === undefined || project?.tax_amount === ""
    ? 0
    : Number(project.tax_amount || 0);
}

function getProjectTaxAmount(project) {
  return Number(project?.contract_amount || 0) * (getProjectTaxPercent(project) / 100);
}

function isLockedContract(record = {}) {
  return ["finalized", "signed"].includes(String(record.status || "").toLowerCase());
}

async function buildProjectContractRecord(project, existingRecord = null) {
  if (isLockedContract(existingRecord)) return existingRecord;

  const snapshot = await buildApprovedQuotationSnapshot(project);
  const contractId = existingRecord?.id || snapshot.contract_number || createContractId();
  const record = {
    id: contractId,
    project_id: project.id,
    project_code: project.project_code || "-",
    project_title: snapshot.project_title,
    client_name: snapshot.client_name,
    client_contact_name: snapshot.client_authorized_representative,
    contact_number: project.contact_number || "-",
    location: snapshot.location,
    start_date: project.start_date || "",
    target_completion: project.target_completion || "",
    contract_number: snapshot.contract_number,
    quotation_number: snapshot.quotation_number,
    quotation_type: snapshot.quotation_type,
    quotation_snapshot: snapshot,
    contract_amount: snapshot.total_contract_price,
    down_payment: snapshot.down_payment_amount,
    balance_due: snapshot.remaining_balance,
    contract_price_display: peso(snapshot.total_contract_price),
    down_payment_display: peso(snapshot.down_payment_amount),
    balance_due_display: peso(snapshot.remaining_balance),
    status: existingRecord?.status || "Draft",
    project_status: project.status || "Pending",
    smart_status: existingRecord?.smart_status || "Ready for Review",
    created_at: existingRecord?.created_at || new Date().toLocaleString("en-PH"),
    updated_at: new Date().toISOString(),
    finalized_at: existingRecord?.finalized_at || ""
  };

  record.contract_text = `Formal Service Agreement generated from approved quotation ${snapshot.quotation_number}.`;
  return record;
}

async function saveProjectContract(project) {
  if (!project?.id || !isApprovedQuotation(project)) return null;

  const records = getSmartContracts();
  const existingIndex = records.findIndex(item => String(item.project_id || "") === String(project.id || ""));
  const existingRecord = existingIndex >= 0 ? records[existingIndex] : null;
  const contractRecord = await buildProjectContractRecord(project, existingRecord);

  if (existingIndex >= 0) {
    records[existingIndex] = contractRecord;
  } else {
    records.unshift(contractRecord);
  }

  saveSmartContracts(records);
  renderSmartContracts();
  return contractRecord;
}

async function syncProjectContracts(projects) {
  const records = getSmartContracts();
  const syncedRecords = [...records];

  for (const project of projects) {
    if (!project?.id || !isApprovedQuotation(project)) continue;

    const existingIndex = syncedRecords.findIndex(item => String(item.project_id || "") === String(project.id || ""));
    const existingRecord = existingIndex >= 0 ? syncedRecords[existingIndex] : null;
    if (isLockedContract(existingRecord)) continue;

    const contractRecord = await buildProjectContractRecord(project, existingRecord);
    if (existingIndex >= 0) {
      syncedRecords[existingIndex] = contractRecord;
    } else {
      syncedRecords.unshift(contractRecord);
    }
  }

  saveSmartContracts(syncedRecords);
}

function renderSmartContracts() {
  const table = document.getElementById("smartContractTable");
  if (!table) return;

  const records = getSmartContracts();
  if (!records.length) {
    table.innerHTML = `<tr><td colspan="8" style="text-align:center;">No formal contract records yet.</td></tr>`;
    return;
  }

  table.innerHTML = records.map(record => `
    <tr>
      <td>${escapeProjectHtml(record.contract_number || record.id)}</td>
      <td>${escapeProjectHtml(record.project_title || "-")}</td>
      <td>${escapeProjectHtml(record.client_name || "-")}</td>
      <td>${peso(record.contract_amount || 0)}</td>
      <td>${escapeProjectHtml(record.quotation_number || "-")}</td>
      <td><span class="badge Pending">${escapeProjectHtml(record.status || "Draft")}</span></td>
      <td>${escapeProjectHtml(record.created_at || "-")}</td>
      <td class="action-links">
        <a href="#" onclick="viewSmartContract('${record.id}'); return false;">Preview</a>
        <a href="#" onclick="deleteSmartContract('${record.id}'); return false;">Delete</a>
      </td>
    </tr>
  `).join("");
}

function contractClause(title, body) {
  return `
    <section class="agreement-section">
      <h2>${escapeProjectHtml(title)}</h2>
      ${body}
    </section>
  `;
}

function getContractItemsRows(snapshot = {}) {
  return (snapshot.items || []).map(item => `
    <tr>
      <td>${escapeProjectHtml(item.description || "-")}</td>
      <td class="qty-cell">${escapeProjectHtml(item.qty || 0)}</td>
      <td>${escapeProjectHtml(item.unit || "")}</td>
      <td class="amount-cell">${peso(item.unitPrice || 0)}</td>
      <td class="amount-cell">${peso(item.amount || 0)}</td>
    </tr>
  `).join("");
}

function buildFormalContractHtml(contract = {}, options = {}) {
  const snapshot = contract.quotation_snapshot || {};
  const showScreenActions = options.showScreenActions === true;
  const fileName = getContractFileName(contract);
  const clientName = snapshot.client_name || contract.client_name || "CLIENT";
  const contractNumber = snapshot.contract_number || contract.contract_number || contract.id || "-";
  const quotationNumber = snapshot.quotation_number || contract.quotation_number || "-";
  const finalizedNote = isLockedContract(contract)
    ? `<p class="contract-lock-note">Finalized contract. Quotation data is locked as of ${escapeProjectHtml(contract.finalized_at || contract.updated_at || contract.created_at || "finalization")}.</p>`
    : `<p class="contract-lock-note draft">Draft preview. Refresh this contract if the approved quotation is revised before finalization.</p>`;

  return `
    <div class="formal-contract-document">
      ${showScreenActions ? getPrintableViewControls() : ""}
      <header class="agreement-header">
        <div class="agreement-brand">LEMYU FIBER OPTIC INSTALLATION AND SERVICES</div>
        <div class="agreement-meta">Formal Service Agreement | ${escapeProjectHtml(fileName)}</div>
      </header>

      <h1>SERVICE AGREEMENT</h1>
      <p class="agreement-subtitle">${escapeProjectHtml(snapshot.project_title || contract.project_title || "Project Service Agreement")}</p>
      ${finalizedNote}

      <table class="contract-info-table">
        <tr><td>Contract Number</td><td>${escapeProjectHtml(contractNumber)}</td></tr>
        <tr><td>Quotation Reference</td><td>${escapeProjectHtml(quotationNumber)}</td></tr>
        <tr><td>Effective Date</td><td>${escapeProjectHtml(snapshot.effective_date || getReadableDate(new Date()))}</td></tr>
        <tr><td>Service Provider</td><td>LEMYU Fiber Optic Installation and Services</td></tr>
        <tr><td>Client</td><td>${escapeProjectHtml(clientName)}</td></tr>
        <tr><td>Authorized Representative</td><td>${escapeProjectHtml(snapshot.client_authorized_representative || "AUTHORIZED REPRESENTATIVE")}</td></tr>
        <tr><td>Project Location</td><td>${escapeProjectHtml(snapshot.location || "-")}</td></tr>
        <tr><td>Project Duration</td><td>${escapeProjectHtml(snapshot.project_duration || "-")}</td></tr>
      </table>

      ${contractClause("PARTIES", `<p>This Service Agreement (the "Agreement") is entered into by and between LEMYU Fiber Optic Installation and Services, represented by Mark Lyndon Lawas, Operations Manager, hereinafter referred to as the "Service Provider," and ${escapeProjectHtml(clientName)}, hereinafter referred to as the "Client." The Service Provider and the Client are collectively referred to as the "Parties."</p>`)}

      ${contractClause("PURPOSE", `<p>The Client engages the Service Provider to perform ${escapeProjectHtml(snapshot.project_description || snapshot.project_title || "the approved project services")}, subject to the terms, conditions, scope, cost, and schedule stated in this Agreement and the approved quotation.</p>`)}

      ${contractClause("1. SCOPE OF SERVICES", `<p>${quotationText(snapshot.scope_of_services || "The Service Provider shall perform the scope of services stated in the approved quotation.")}</p><p>Any service, material, equipment, or activity not expressly stated in this Agreement or the approved quotation shall be treated as additional work and shall require a written variation or change order.</p>`)}

      ${contractClause("2. CONTRACT DURATION", `<p>The project duration shall be ${escapeProjectHtml(snapshot.project_duration || "as stated in the approved quotation")}. Any extension shall be documented in writing and approved by both Parties. Delays caused by site restrictions, late access, change orders, force majeure, or circumstances beyond the Service Provider's reasonable control shall result in a corresponding adjustment of the project schedule.</p>`)}

      <section class="agreement-section">
        <h2>3. CONTRACT PRICE</h2>
        <table class="contract-price-table">
          <thead><tr><th>Description</th><th>Quantity</th><th>Unit</th><th>Unit Price</th><th>Amount</th></tr></thead>
          <tbody>${getContractItemsRows(snapshot)}</tbody>
          <tfoot>
            <tr><td colspan="4">TOTAL CONTRACT PRICE</td><td>${peso(snapshot.total_contract_price || contract.contract_amount || 0)}</td></tr>
          </tfoot>
        </table>
        <p>The total contract price is ${peso(snapshot.total_contract_price || contract.contract_amount || 0)}, exclusive of additional work not covered by the approved scope, unless otherwise expressly stated in writing.</p>
      </section>

      ${contractClause("4. PAYMENT TERMS", `<p>4.1 The Client shall pay a down payment of ${Number(snapshot.down_payment_percent || 0).toFixed(2)}% amounting to ${peso(snapshot.down_payment_amount || 0)} upon signing of this Agreement and before mobilization.</p><p>4.2 The remaining balance of ${peso(snapshot.remaining_balance || 0)} shall be paid according to the billing schedule mutually confirmed by the Parties or upon completion of the agreed services.</p><p>4.3 ${quotationText(snapshot.payment_terms || "Payments shall follow the approved quotation terms.")}</p><p>4.4 Delayed payments may result in suspension of services after written notice, without prejudice to the Service Provider's right to collect amounts already due.</p>`)}

      ${contractClause("5. RESPONSIBILITIES OF THE SERVICE PROVIDER", `<p>5.1 Deploy qualified and properly instructed personnel, materials, tools, or technical resources required by the approved quotation.</p><p>5.2 Perform the services with reasonable skill, care, diligence, and professionalism.</p><p>5.3 Comply with applicable occupational health and safety requirements.</p><p>5.4 Maintain project records and promptly report material issues affecting the work.</p><p>5.5 Protect confidential information obtained during the engagement.</p>`)}

      ${contractClause("6. RESPONSIBILITIES OF THE CLIENT", `<p>6.1 Provide timely access to the project site, authorized work areas, and necessary coordination contacts.</p><p>6.2 Communicate site rules, safety requirements, and project-specific instructions before deployment.</p><p>6.3 Review and approve submitted records, accomplishments, and requests within a reasonable period.</p><p>6.4 Pay all amounts due according to the agreed payment terms.</p><p>6.5 Promptly inform the Service Provider of changes that may affect the scope, cost, or schedule.</p>`)}

      ${contractClause("7. CHANGE ORDERS", `<p>No alteration to the scope, personnel requirement, duration, price, or deliverables shall be binding unless documented in a written Change Order approved by authorized representatives of both Parties. Approved changes may result in adjustments to the contract price and completion schedule.</p>`)}
      ${contractClause("8. ACCEPTANCE AND COMPLETION", `<p>The services shall be considered completed upon fulfillment of the agreed scope and submission of the required completion documents. The Client shall notify the Service Provider in writing of any material deficiency within a reasonable review period.</p>`)}
      ${contractClause("9. SUSPENSION AND TERMINATION", `<p>Either Party may terminate this Agreement for material breach if the breaching Party fails to remedy the breach within a reasonable period after written notice. The Service Provider may suspend deployment or performance for non-payment, unsafe working conditions, denial of access, or unlawful instructions.</p>`)}
      ${contractClause("10. FORCE MAJEURE", `<p>Neither Party shall be liable for delay or failure caused by events beyond its reasonable control, including natural disasters, severe weather, government restrictions, labor disruptions, epidemics, war, civil disturbance, utility interruption, or similar events.</p>`)}
      ${contractClause("11. CONFIDENTIALITY", `<p>Each Party shall protect confidential, technical, commercial, financial, and operational information received from the other Party and shall use such information only for purposes of this Agreement, except where disclosure is required by law or authorized in writing.</p>`)}
      ${contractClause("12. LIABILITY AND INDEMNITY", `<p>Each Party shall be responsible for loss or damage directly resulting from its own negligence, willful misconduct, or breach of this Agreement. Neither Party shall be liable for indirect, incidental, or consequential loss except where such limitation is prohibited by law.</p>`)}
      ${contractClause("13. GOVERNING LAW AND DISPUTE RESOLUTION", `<p>This Agreement shall be governed by the laws of the Republic of the Philippines. The Parties shall first attempt to resolve any dispute through good-faith negotiation. If no settlement is reached, the dispute may be submitted to the courts of competent jurisdiction.</p>`)}
      ${contractClause("14. GENERAL PROVISIONS", `<p>14.1 Entire Agreement. This Agreement, together with the approved quotation and duly signed change orders, constitutes the complete understanding of the Parties regarding the project.</p><p>14.2 Amendments. Any amendment must be in writing and signed by authorized representatives of both Parties.</p><p>14.3 Severability. If any provision is found invalid or unenforceable, the remaining provisions shall continue in effect.</p><p>14.4 No Waiver. Failure to enforce any provision shall not constitute a waiver of the right to enforce it later.</p><p>14.5 Electronic Records. System-generated copies, electronic approvals, and digitally stored records may be used as supporting business records, subject to applicable law.</p>`)}
      ${contractClause("15. CONTRACT DOCUMENTS", `<p>The following documents form part of this Agreement:</p><ul><li>Approved ${escapeProjectHtml(snapshot.quotation_label || "Quotation")} No. ${escapeProjectHtml(quotationNumber)}</li><li>Approved scope of work and project instructions</li><li>Approved change orders, if any</li><li>Completion, billing, and acceptance documents</li></ul>${snapshot.other_terms ? `<p><b>Other Approved Quotation Terms:</b><br>${quotationText(snapshot.other_terms)}</p>` : ""}`)}

      <section class="agreement-section signatures-section">
        <h2>16. SIGNATURES</h2>
        <p>The undersigned confirm that they are authorized to sign this Agreement and that they have read, understood, and accepted its terms.</p>
        <div class="formal-signatures">
          <div class="formal-sig-block">
            <h3>FOR THE SERVICE PROVIDER</h3>
            <div class="formal-sign-line"></div>
            <strong>MARK LYNDON LAWAS</strong>
            <span>Operations Manager</span>
            <span>LEMYU Fiber Optic Installation and Services</span>
            <p>Date: __________________________</p>
          </div>
          <div class="formal-sig-block">
            <h3>FOR THE CLIENT</h3>
            <div class="formal-sign-line"></div>
            <strong>AUTHORIZED REPRESENTATIVE</strong>
            <span>Position: ______________________</span>
            <span>${escapeProjectHtml(clientName)}</span>
            <p>Date: __________________________</p>
          </div>
        </div>
      </section>
    </div>
  `;
}

function getFormalContractStyles() {
  return `
    @page{size:A4;margin:18mm 16mm;}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    body{margin:0;background:#eef2f6;color:#111827;font-family:"Times New Roman", Times, serif;font-size:11.5pt;line-height:1.35;}
    .formal-contract-document{width:180mm;min-height:267mm;margin:0 auto;background:#fff;padding:0;color:#111827;counter-reset:page;}
    .agreement-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111827;padding-bottom:8px;margin-bottom:18px;font-family:Arial, Helvetica, sans-serif;font-size:9pt;}
    .agreement-brand{font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#0b315f;}
    .agreement-meta{color:#4b5563;text-align:right;}
    h1{text-align:center;font-size:20pt;letter-spacing:.08em;margin:18px 0 4px;text-transform:uppercase;}
    .agreement-subtitle{text-align:center;font-size:12pt;margin:0 0 16px;font-weight:700;}
    .contract-lock-note{border:1px solid #cbd5e1;background:#f8fafc;padding:8px 10px;margin:0 0 14px;font-family:Arial, Helvetica, sans-serif;font-size:9pt;}
    .contract-lock-note.draft{background:#fff7ed;border-color:#fed7aa;}
    table{width:100%;border-collapse:collapse;margin:10px 0 14px;page-break-inside:avoid;}
    .contract-info-table td{border:1px solid #1f2937;padding:6px 8px;vertical-align:top;}
    .contract-info-table td:first-child{width:32%;font-weight:700;background:#eef2f7;}
    .agreement-section{margin:0 0 11px;page-break-inside:auto;}
    .agreement-section h2{font-family:Arial, Helvetica, sans-serif;font-size:10.5pt;margin:12px 0 5px;text-transform:uppercase;color:#111827;page-break-after:avoid;}
    .agreement-section p{margin:4px 0;text-align:justify;}
    .agreement-section ul{margin:4px 0 4px 18px;padding:0;}
    .contract-price-table th,.contract-price-table td{border:1px solid #111827;padding:6px 7px;vertical-align:top;}
    .contract-price-table th{background:#e5edf7;font-family:Arial, Helvetica, sans-serif;font-size:9pt;text-align:center;text-transform:uppercase;}
    .qty-cell{text-align:center;width:12%;}.amount-cell{text-align:right;white-space:nowrap;}
    .contract-price-table tfoot td{font-weight:800;background:#f3f4f6;}.contract-price-table tfoot td:first-child{text-align:right;}
    .signatures-section{page-break-inside:avoid;margin-top:18px;}
    .formal-signatures{display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-top:28px;}
    .formal-sig-block{min-height:150px;page-break-inside:avoid;}
    .formal-sig-block h3{font-family:Arial, Helvetica, sans-serif;font-size:10pt;margin:0 0 42px;text-transform:uppercase;}
    .formal-sign-line{border-top:1px solid #111827;margin:0 0 5px;height:1px;}
    .formal-sig-block strong,.formal-sig-block span{display:block;margin:2px 0;}.formal-sig-block p{margin-top:18px;text-align:left;}
    .print-view-actions{font-family:Arial, Helvetica, sans-serif;position:sticky;top:0;background:#fff;border-bottom:1px solid #d8e5f2;margin-bottom:14px;padding:10px 0;display:flex;justify-content:flex-end;gap:8px;z-index:5;}
    .print-view-actions button{border:1px solid #1f4f7a;border-radius:5px;padding:8px 12px;background:#1f4f7a;color:#fff;font-weight:700;cursor:pointer;}
    .print-view-actions .secondary-print-action{background:#fff;color:#1f4f7a;}
    @media print{body{background:#fff;}.formal-contract-document{width:auto;min-height:auto;margin:0;padding:0;}.print-view-actions{display:none!important;}}
  `;
}

async function getOrCreateProjectContract(projectId) {
  const project = await getProjectForAction(projectId, "Contract");
  if (!project) return null;

  if (!isApprovedQuotation(project)) {
    alert("A contract can only be generated from an approved quotation.");
    return null;
  }

  return saveProjectContract(project);
}

window.viewProjectContract = async function(projectId) {
  const record = await getOrCreateProjectContract(projectId);
  if (!record) return;
  window.viewSmartContract(record.id);
};

window.printProjectContract = async function(projectId) {
  const record = await getOrCreateProjectContract(projectId);
  if (!record) return;
  activeSmartContract = record;
  window.printSmartContract();
};

window.viewSmartContract = function(contractId) {
  const record = getSmartContracts().find(item => String(item.id || "") === String(contractId || ""));

  if (!record) {
    alert("Contract record not found.");
    return;
  }

  activeSmartContract = record;
  if (smartContractContent) {
    smartContractContent.innerHTML = `
      <style>${getFormalContractStyles()}</style>
      ${buildFormalContractHtml(record, { showScreenActions: false })}
    `;
  }

  const refreshBtn = document.getElementById("refreshContractBtn");
  const finalizeBtn = document.getElementById("finalizeContractBtn");
  const locked = isLockedContract(record);
  if (refreshBtn) refreshBtn.disabled = locked;
  if (finalizeBtn) finalizeBtn.disabled = locked;
  if (smartContractModal) smartContractModal.style.display = "flex";
};

window.closeSmartContractModal = function() {
  if (smartContractModal) smartContractModal.style.display = "none";
};

window.refreshSmartContractFromQuotation = async function() {
  if (!activeSmartContract) return;

  if (isLockedContract(activeSmartContract)) {
    alert("This contract is finalized and cannot be refreshed from the quotation.");
    return;
  }

  const project = await getProjectForAction(activeSmartContract.project_id, "Approved quotation");
  if (!project) return;

  if (!isApprovedQuotation(project)) {
    alert("A contract can only be generated from an approved quotation.");
    return;
  }

  const records = getSmartContracts();
  const index = records.findIndex(item => String(item.id || "") === String(activeSmartContract.id || ""));
  const refreshed = await buildProjectContractRecord(project, activeSmartContract);

  if (index >= 0) {
    records[index] = refreshed;
  } else {
    records.unshift(refreshed);
  }

  saveSmartContracts(records);
  renderSmartContracts();
  window.viewSmartContract(refreshed.id);
};

window.finalizeSmartContract = function() {
  if (!activeSmartContract) return;

  if (isLockedContract(activeSmartContract)) {
    alert("This contract is already finalized.");
    return;
  }

  const confirmed = confirm("Finalize this contract and lock the current approved quotation data?");
  if (!confirmed) return;

  const records = getSmartContracts();
  const index = records.findIndex(item => String(item.id || "") === String(activeSmartContract.id || ""));
  const finalized = {
    ...activeSmartContract,
    status: "Finalized",
    finalized_at: new Date().toLocaleString("en-PH"),
    updated_at: new Date().toISOString()
  };

  if (index >= 0) {
    records[index] = finalized;
  } else {
    records.unshift(finalized);
  }

  saveSmartContracts(records);
  renderSmartContracts();
  window.viewSmartContract(finalized.id);
};

window.printSmartContract = function() {
  if (!activeSmartContract) return;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow pop-ups to print or save the contract PDF.");
    return;
  }

  const fileName = getContractFileName(activeSmartContract);
  printWindow.document.write(`
    <html>
    <head>
      <title>${escapeProjectHtml(fileName)}</title>
      <style>${getFormalContractStyles()}</style>
    </head>
    <body>
      ${buildFormalContractHtml(activeSmartContract, { showScreenActions: true })}
      <script>
        window.addEventListener("load", function() {
          setTimeout(function() { window.print(); }, 700);
        });
      <\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
};

function getManpowerQuotationDetails(project) {
  const remarks = String(project.remarks || "");
  const lines = remarks.split(/\r?\n/);
  const details = {
    position: project.project_title || "Manpower Services",
    workers: 1,
    days: 1,
    rate: 0,
    scope: "",
    notes: remarks,
    clientEmail: project.client_email || "",
    terms: "",
    workDescription: project.project_title || "",
    additionalComments: "",
    preparedBy: project.ppr_prepared_by || "",
    preparedPosition: "",
    durationDays: 0,
    items: Array.isArray(project.quotation_items) ? project.quotation_items : getLocalQuotationItems(project.id)
  };

  const noteLines = [];
  let activeMultilineField = "";
  const appendMultiline = line => {
    if (!activeMultilineField) return false;
    details[activeMultilineField] = [details[activeMultilineField], line.trim()].filter(Boolean).join("\n");
    return true;
  };

  lines.forEach(line => {
    const trimmed = line.trim();

    if (!trimmed) {
      if (!activeMultilineField) noteLines.push(line);
      return;
    }

    if (/^quotation type:\s*manpower/i.test(trimmed)) return;

    const emailMatch = trimmed.match(/^client email:\s*(.*)$/i);
    if (emailMatch) {
      details.clientEmail = emailMatch[1] || details.clientEmail;
      activeMultilineField = "";
      return;
    }

    const termsMatch = trimmed.match(/^terms of service:\s*(.*)$/i);
    if (termsMatch) {
      details.terms = termsMatch[1] || "";
      activeMultilineField = "terms";
      return;
    }

    const workDescriptionMatch = trimmed.match(/^work description:\s*(.*)$/i);
    if (workDescriptionMatch) {
      details.workDescription = workDescriptionMatch[1] || "";
      activeMultilineField = "workDescription";
      return;
    }

    const commentsMatch = trimmed.match(/^additional comments:\s*(.*)$/i);
    if (commentsMatch) {
      details.additionalComments = commentsMatch[1] || "";
      activeMultilineField = "additionalComments";
      return;
    }

    const preparedByMatch = trimmed.match(/^prepared by:\s*(.*)$/i);
    if (preparedByMatch) {
      details.preparedBy = preparedByMatch[1] || details.preparedBy;
      activeMultilineField = "";
      return;
    }

    const durationDaysMatch = trimmed.match(/^project duration days:\s*(.*)$/i);
    if (durationDaysMatch) {
      details.durationDays = Math.max(0, Math.trunc(Number(String(durationDaysMatch[1]).replace(/[^0-9.]/g, "")) || 0));
      activeMultilineField = "";
      return;
    }

    const preparedPositionMatch = trimmed.match(/^(?:prepared position|position):\s*(.*)$/i);
    if (preparedPositionMatch) {
      details.preparedPosition = preparedPositionMatch[1] || details.preparedPosition;
      activeMultilineField = "";
      return;
    }

    const positionMatch = trimmed.match(/^position \/ service:\s*(.*)$/i);
    if (positionMatch) {
      details.position = positionMatch[1] || details.position;
      activeMultilineField = "";
      return;
    }

    const workersMatch = trimmed.match(/^workers:\s*(.*)$/i);
    if (workersMatch) {
      details.workers = Number(workersMatch[1]) || details.workers;
      activeMultilineField = "";
      return;
    }

    const daysMatch = trimmed.match(/^days:\s*(.*)$/i);
    if (daysMatch) {
      details.days = Number(daysMatch[1]) || details.days;
      activeMultilineField = "";
      return;
    }

    const rateMatch = trimmed.match(/^rate per day:\s*(.*)$/i);
    if (rateMatch) {
      details.rate = Number(String(rateMatch[1]).replace(/[^0-9.]/g, "")) || details.rate;
      activeMultilineField = "";
      return;
    }

    const scopeMatch = trimmed.match(/^scope:\s*(.*)$/i);
    if (scopeMatch) {
      details.scope = scopeMatch[1] || "";
      activeMultilineField = "scope";
      return;
    }

    if (appendMultiline(line)) {
      return;
    }

    noteLines.push(line);
  });

  details.notes = noteLines.join("\n").trim();
  return details;
}

function formatQuotationAmount(value) {
  return Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function quotationText(value = "-") {
  return escapeProjectHtml(value || "-").replace(/\r?\n/g, "<br>");
}

const CCTV_QUOTATION_DEFAULTS = {
  intro: "Supply & Installation Quotation of Tiandy CCTV and Witek Communication Solution\n2MP HYBRID IP CCTV W/ FIBER OPTIC INSTALLATION. We are pleased to offer you the following products for consideration.",
  installationCharge: "INSTALLATION CHARGE",
  summaryComputation: "SUMMARY OF COMPUTATION",
  note: "NOTE:\n- Materials and installation charges are subject to final site validation.\n- Any additional materials, civil works, electrical works, or revisions outside the quoted scope will be charged separately.",
  terms: "TERMS AND CONDITIONS:\n1. Prices are valid within the agreed quotation validity period.\n2. Payment terms are subject to agreement before project implementation.\n3. Schedule of installation is subject to material availability and site readiness.\n4. Warranty applies only to supplied equipment and workmanship under normal use.\n5. Client approval is required before commencement of work."
};

function getDurationDaysFromValue(value) {
  const days = Math.trunc(Number(String(value || "").replace(/[^0-9.]/g, "")) || 0);
  return Math.max(0, days);
}

function getCctvQuotationDetails(project = {}) {
  const details = { ...CCTV_QUOTATION_DEFAULTS };
  const lines = String(project.remarks || "").split(/\r?\n/);
  let activeField = "";

  const fieldLabels = [
    ["intro", /^cctv intro:\s*(.*)$/i],
    ["installationCharge", /^installation charge:\s*(.*)$/i],
    ["summaryComputation", /^summary of computation:\s*(.*)$/i],
    ["note", /^note:\s*(.*)$/i],
    ["terms", /^terms and conditions:\s*(.*)$/i]
  ];

  lines.forEach(line => {
    const trimmed = line.trim();

    if (!trimmed) return;
    if (/^quotation type:\s*cctv/i.test(trimmed)) return;

    const durationDaysMatch = trimmed.match(/^project duration days:\s*(.*)$/i);
    if (durationDaysMatch) {
      details.durationDays = getDurationDaysFromValue(durationDaysMatch[1]);
      activeField = "";
      return;
    }

    for (const [field, pattern] of fieldLabels) {
      const match = trimmed.match(pattern);
      if (match) {
        details[field] = match[1] || "";
        activeField = field;
        return;
      }
    }

    if (activeField) {
      details[activeField] = [details[activeField], trimmed].filter(Boolean).join("\n");
    }
  });

  Object.entries(CCTV_QUOTATION_DEFAULTS).forEach(([key, value]) => {
    if (!details[key]) details[key] = value;
  });

  return details;
}

const EDIT_MANPOWER_HIDDEN_FIELD_IDS = [
  "edit_project_code",
  "edit_project_title",
  "edit_client_name",
  "edit_client_contact_name",
  "edit_contact_number",
  "edit_location",
  "edit_cctv_duration_days",
  "edit_start_date",
  "edit_target_completion",
  "edit_completed_date",
  "edit_status",
  "edit_progress_percentage",
  "edit_project_budget",
  "edit_contract_amount",
  "edit_down_payment",
  "edit_tax_amount",
  "edit_ppr_prepared_by",
  "edit_ppr_noted_by"
];

function createEditManpowerQuotationItemRow(item = {}) {
  const tr = document.createElement("tr");
  const qty = Number(item.qty ?? 1);
  const unitPrice = Number(item.unitPrice ?? item.price ?? item.amount ?? 0);
  tr.innerHTML = `
    <td><input class="edit-manpower-description" placeholder="Description" value="${escapeProjectHtml(item.description || "")}"></td>
    <td><input class="edit-manpower-qty" type="number" min="0" step="0.01" value="${qty}"></td>
    <td><input class="edit-manpower-unit-price" type="number" min="0" step="0.01" value="${unitPrice}"></td>
    <td class="edit-manpower-line-amount">${peso(qty * unitPrice)}</td>
    <td class="quotation-action-cell">
      <button type="button" onclick="addEditManpowerQuotationItem()">Add Item</button>
      <button type="button" class="danger-btn" onclick="removeEditManpowerQuotationItem(this)">Delete</button>
    </td>
  `;

  tr.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", updateEditManpowerAmount);
  });

  return tr;
}

function getEditManpowerQuotationItems() {
  return [...document.querySelectorAll("#editManpowerQuotationItemsBody tr")]
    .map(row => {
      const qty = Number(row.querySelector(".edit-manpower-qty")?.value || 0);
      const unitPrice = Number(row.querySelector(".edit-manpower-unit-price")?.value || 0);
      return {
        description: row.querySelector(".edit-manpower-description")?.value.trim() || "",
        qty,
        unitPrice,
        price: unitPrice,
        amount: qty * unitPrice
      };
    })
    .filter(item => item.description || item.qty || item.amount);
}

function updateEditManpowerAmount() {
  const total = getEditManpowerQuotationItems().reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalCell = document.getElementById("editManpowerQuotationTotal");

  document.querySelectorAll("#editManpowerQuotationItemsBody tr").forEach(row => {
    const qty = Number(row.querySelector(".edit-manpower-qty")?.value || 0);
    const unitPrice = Number(row.querySelector(".edit-manpower-unit-price")?.value || 0);
    const lineAmount = row.querySelector(".edit-manpower-line-amount");
    if (lineAmount) lineAmount.textContent = peso(qty * unitPrice);
  });

  if (totalCell) totalCell.textContent = peso(total);
  edit_contract_amount.value = total;
  edit_project_budget.value = total;
}

function resetEditManpowerQuotationItems(items = []) {
  const body = document.getElementById("editManpowerQuotationItemsBody");
  if (!body) return;

  const rows = items.length ? items : [{ description: "", qty: 1, amount: 0 }];
  body.innerHTML = "";
  rows.forEach(item => body.appendChild(createEditManpowerQuotationItemRow(item)));
  updateEditManpowerAmount();
}

function getMaterialCatalog() {
  try {
    return JSON.parse(localStorage.getItem(MATERIAL_CATALOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalInventoryRecords(records) {
  localStorage.setItem(LOCAL_INVENTORY_KEY, JSON.stringify(records));
}

function saveLocalInventoryRecord(item) {
  const record = {
    ...item,
    id: item.id || `local-inventory-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: item.created_at || new Date().toISOString()
  };
  const records = getLocalInventoryRecords();
  const nextRecords = [record, ...records];
  saveLocalInventoryRecords(nextRecords);
  return record;
}

function saveInventoryMaps(item) {
  const projectCodeMap = JSON.parse(localStorage.getItem("lemyu_inventory_project_codes") || "{}");
  const unitMap = JSON.parse(localStorage.getItem("lemyu_inventory_units") || "{}");
  const pictureMap = JSON.parse(localStorage.getItem("lemyu_inventory_pictures") || "{}");

  projectCodeMap[item.id] = item.project_code || "";
  unitMap[item.id] = item.unit || "";
  if (item.picture_url) pictureMap[item.id] = item.picture_url;

  localStorage.setItem("lemyu_inventory_project_codes", JSON.stringify(projectCodeMap));
  localStorage.setItem("lemyu_inventory_units", JSON.stringify(unitMap));
  localStorage.setItem("lemyu_inventory_pictures", JSON.stringify(pictureMap));
}

function buildEditCctvMaterialOptions(inventoryItems = [], catalogItems = []) {
  const optionMap = new Map();
  const addOption = (item = {}, source = "inventory") => {
    const name = item.name || item.material_name || item.material || item.description || "";
    const description = item.description || "";
    if (!name && !description) return;

    const key = String(name || description).trim().toLowerCase();
    const inventoryId = ["inventory", "local"].includes(source) ? (item.id || item.inventory_id || "") : (item.inventory_id || "");
    const existing = optionMap.get(key);
    if (existing?.inventory_id && !inventoryId) return;

    optionMap.set(key, {
      id: `${source}-${item.id || key}`,
      inventory_id: inventoryId,
      catalog_id: source === "catalog" ? (item.id || item.catalog_id || "") : (item.catalog_id || ""),
      name,
      description,
      qty: 1,
      stock_qty: Number(item.qty ?? item.quantity ?? item.stock ?? 0),
      unit: item.unit || getInventoryUnit(item) || "",
      price: Number(item.price ?? item.unit_price ?? item.amount ?? 0),
      picture_name: item.picture_name || "",
      picture_url: item.picture_url || item.image_url || item.photo_url || ""
    });
  };

  getLocalInventoryRecords().forEach(item => addOption(item, "local"));
  inventoryItems.forEach(item => addOption(item, "inventory"));
  getMaterialCatalog().forEach(item => addOption(item, "catalog"));
  catalogItems.forEach(item => addOption(item, "catalog"));

  return [...optionMap.values()]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function applyEditCctvSelectedMaterial(value = "") {
  const item = editCctvMaterialOptions.find(option => String(option.id || "") === String(value || ""));
  if (!item) return;

  const body = document.getElementById("editCctvMaterialsBody");
  const blankRow = [...body?.querySelectorAll("tr") || []].find(isBlankEditCctvMaterialRow);

  if (blankRow) {
    fillEditCctvMaterialRow(blankRow, item);
  } else {
    window.addEditCctvMaterialRow(item);
  }
}

let editCctvMaterialOptions = [];

function renderEditCctvMaterialOptions(options = []) {
  const select = document.getElementById("edit_cctv_material_select");
  if (!select) return;

  editCctvMaterialOptions = options;
  select.innerHTML = `<option value="">${options.length ? "Select saved material" : "No saved materials found"}</option>` + options
    .map(item => {
      const unit = item.unit ? ` ${item.unit}` : "";
      const stock = item.inventory_id ? ` | Stock: ${Number(item.stock_qty || 0)}${unit}` : "";
      const price = Number(item.price || 0) > 0 ? ` | ${peso(item.price)}` : "";
      return `<option value="${escapeProjectHtml(item.id)}">${escapeProjectHtml(`${item.name || "Unnamed Material"}${stock}${price}`)}</option>`;
    })
    .join("");
}

async function setEditCctvMaterialOptions() {
  renderEditCctvMaterialOptions(buildEditCctvMaterialOptions());

  const [inventoryResult, catalogResult] = await Promise.all([
    supabase.from("inventory").select("*"),
    supabase.from("material_catalog").select("*")
  ]);

  renderEditCctvMaterialOptions(buildEditCctvMaterialOptions(
    inventoryResult.error ? [] : inventoryResult.data || [],
    catalogResult.error ? [] : catalogResult.data || []
  ));
}

function isBlankEditCctvMaterialRow(row) {
  if (!row) return false;

  return !row.querySelector(".edit-cctv-material-name")?.value.trim()
    && !row.querySelector(".edit-cctv-material-description")?.value.trim()
    && Number(row.querySelector(".edit-cctv-material-price")?.value || 0) === 0;
}

function updateEditCctvMaterialsTotal() {
  const total = [...document.querySelectorAll("#editCctvMaterialsBody tr")]
    .reduce((sum, row) => {
      const qty = Number(row.querySelector(".edit-cctv-material-qty")?.value || 0);
      const price = Number(row.querySelector(".edit-cctv-material-price")?.value || 0);
      return sum + (qty * price);
    }, 0);

  const totalCell = document.getElementById("editCctvMaterialsTotal");
  if (totalCell) totalCell.textContent = peso(total);
}

function updateEditCctvMaterialRowTotal(row) {
  if (!row) return;

  const qty = Number(row.querySelector(".edit-cctv-material-qty")?.value || 0);
  const price = Number(row.querySelector(".edit-cctv-material-price")?.value || 0);
  const totalCell = row.querySelector(".edit-cctv-material-total");

  if (totalCell) totalCell.textContent = peso(qty * price);
  updateEditCctvMaterialsTotal();
}

function bindEditCctvMaterialRow(row) {
  row.querySelector(".edit-cctv-material-qty")?.addEventListener("input", () => updateEditCctvMaterialRowTotal(row));
  row.querySelector(".edit-cctv-material-price")?.addEventListener("input", () => updateEditCctvMaterialRowTotal(row));
  updateEditCctvMaterialRowTotal(row);
  return row;
}

function createEditCctvMaterialRow(item = {}) {
  const tr = document.createElement("tr");
  tr.dataset.inventoryId = item.inventory_id || "";
  tr.dataset.catalogId = item.catalog_id || "";
  tr.dataset.pictureName = item.picture_name || "";
  tr.dataset.pictureUrl = item.picture_url || "";
  const selectedUnit = String(item.unit || "").trim().toUpperCase();
  const unitOptions = [
    ...MATERIAL_UNIT_OPTIONS,
    selectedUnit && !MATERIAL_UNIT_OPTIONS.includes(selectedUnit) ? selectedUnit : ""
  ].filter(Boolean);

  tr.innerHTML = `
    <td><input class="edit-cctv-material-name" required value="${escapeProjectHtml(item.name || "")}" placeholder="Material name"></td>
    <td><input class="edit-cctv-material-description" value="${escapeProjectHtml(item.description || "")}" placeholder="Description"></td>
    <td><input class="edit-cctv-material-qty" type="number" min="0" step="0.01" required value="${item.qty ?? 1}"></td>
    <td>
      <select class="edit-cctv-material-unit">
        <option value="">Select Unit</option>
        ${unitOptions.map(unit => `<option value="${escapeProjectHtml(unit)}" ${unit === selectedUnit ? "selected" : ""}>${escapeProjectHtml(unit)}</option>`).join("")}
      </select>
    </td>
    <td><input class="edit-cctv-material-price" type="number" min="0" step="0.01" required value="${item.price ?? 0}"></td>
    <td class="edit-cctv-material-total">${peso(Number(item.qty ?? 1) * Number(item.price ?? 0))}</td>
    <td class="quotation-action-cell">
      <button type="button" onclick="addEditCctvMaterialRow()">Add</button>
      <button type="button" class="danger-btn" onclick="removeEditCctvMaterialRow(this)">Delete</button>
    </td>
  `;
  return bindEditCctvMaterialRow(tr);
}

function fillEditCctvMaterialRow(row, item = {}) {
  if (!row) return;

  row.dataset.inventoryId = item.inventory_id || "";
  row.dataset.catalogId = item.catalog_id || "";
  row.dataset.pictureName = item.picture_name || "";
  row.dataset.pictureUrl = item.picture_url || "";
  const nameField = row.querySelector(".edit-cctv-material-name");
  const descriptionField = row.querySelector(".edit-cctv-material-description");
  const qtyField = row.querySelector(".edit-cctv-material-qty");
  const unitField = row.querySelector(".edit-cctv-material-unit");
  const priceField = row.querySelector(".edit-cctv-material-price");

  if (nameField) nameField.value = item.name || "";
  if (descriptionField) descriptionField.value = item.description || "";
  if (qtyField) qtyField.value = item.qty ?? 1;
  if (unitField) {
    const unit = String(item.unit || "").trim().toUpperCase();
    const hasOption = [...unitField.options].some(option => option.value === unit);
    if (!hasOption && unit) {
      unitField.appendChild(new Option(unit, unit));
    }
    unitField.value = unit;
  }
  if (priceField) priceField.value = item.price ?? 0;
  updateEditCctvMaterialRowTotal(row);
}

function resetEditCctvMaterials(items = []) {
  const body = document.getElementById("editCctvMaterialsBody");
  if (!body) return;

  const rows = items.length ? items : [{ name: "", description: "", qty: 1, unit: "", price: 0 }];
  body.innerHTML = "";
  rows.forEach(item => body.appendChild(createEditCctvMaterialRow(item)));
  updateEditCctvMaterialsTotal();
}

function getEditCctvMaterials() {
  return [...document.querySelectorAll("#editCctvMaterialsBody tr")]
    .map(row => ({
      name: row.querySelector(".edit-cctv-material-name")?.value.trim() || "",
      description: row.querySelector(".edit-cctv-material-description")?.value.trim() || "",
      qty: Number(row.querySelector(".edit-cctv-material-qty")?.value || 0),
      unit: row.querySelector(".edit-cctv-material-unit")?.value.trim() || "",
      price: Number(row.querySelector(".edit-cctv-material-price")?.value || 0),
      amount: Number(row.querySelector(".edit-cctv-material-price")?.value || 0),
      total_amount: Number(row.querySelector(".edit-cctv-material-qty")?.value || 0) * Number(row.querySelector(".edit-cctv-material-price")?.value || 0),
      inventory_id: row.dataset.inventoryId || "",
      catalog_id: row.dataset.catalogId || "",
      picture_name: row.dataset.pictureName || "",
      picture_url: row.dataset.pictureUrl || ""
    }))
    .filter(item => item.name || item.description || item.qty || item.unit || item.price);
}

function setPanelControlsDisabled(panel, disabled) {
  panel?.querySelectorAll("input, select, textarea").forEach(control => {
    control.disabled = disabled;
  });
}

async function loadEditCctvMaterials(project = {}) {
  const projectCode = project.project_code || "";
  const savedQuotationItems = Array.isArray(project.quotation_items)
    ? project.quotation_items
    : getLocalQuotationItems(project.id);

  let supabaseInventory = [];
  const { data = [], error } = await supabase.from("inventory").select("*");
  if (!error) supabaseInventory = data;

  const linkedInventoryItems = projectCode
    ? mergeInventoryRecords(supabaseInventory)
    .filter(item => String(getInventoryProjectCode(item) || "").toLowerCase() === String(projectCode || "").toLowerCase())
    .map(item => ({
      inventory_id: item.id || "",
      catalog_id: item.catalog_id || "",
      name: item.name || "",
      description: item.description || "",
      qty: getQuotationQty(item.qty),
      unit: getInventoryUnit(item),
      price: Number(item.price || 0),
      picture_name: item.picture_name || "",
      picture_url: item.picture_url || ""
    }))
    : [];

  const quotationItems = savedQuotationItems.map(item => ({
    inventory_id: item.inventory_id || "",
    catalog_id: item.catalog_id || "",
    name: item.name || item.description || "",
    description: item.details || item.description || "",
    qty: getQuotationQty(item.qty),
    unit: item.unit || "",
    price: Number(item.price ?? item.unitPrice ?? item.amount ?? 0),
    picture_name: item.picture_name || "",
    picture_url: item.picture_url || ""
  }));

  resetEditCctvMaterials(quotationItems.length ? quotationItems : linkedInventoryItems);
}

function removeLocalInventoryByProjectCode(projectCode = "") {
  if (!projectCode) return;
  const normalizedCode = String(projectCode).toLowerCase();
  const removedIds = new Set();
  const remaining = getLocalInventoryRecords().filter(item => {
    const shouldRemove = String(getInventoryProjectCode(item) || "").toLowerCase() === normalizedCode;
    if (shouldRemove && item.id) removedIds.add(String(item.id));
    return !shouldRemove;
  });

  saveLocalInventoryRecords(remaining);

  ["lemyu_inventory_project_codes", "lemyu_inventory_units", "lemyu_inventory_pictures"].forEach(key => {
    const records = JSON.parse(localStorage.getItem(key) || "{}");
    removedIds.forEach(id => delete records[id]);
    localStorage.setItem(key, JSON.stringify(records));
  });
}

async function saveEditCctvMaterials(projectCode = "", oldProjectCode = projectCode) {
  saveLocalQuotationItems(editingId, getEditCctvMaterials());
}

function getInventoryUsageKey(item = {}) {
  if (item.inventory_id) return `id:${item.inventory_id}`;
  return "";
}

function summarizeInventoryUsage(items = []) {
  const usage = new Map();

  items.forEach(item => {
    const key = getInventoryUsageKey(item);
    if (!key) return;

    const current = usage.get(key) || {
      inventory_id: item.inventory_id,
      name: item.name || item.description || "",
      qty: 0
    };

    current.qty += Number(item.qty || 0);
    usage.set(key, current);
  });

  return usage;
}

function updateLocalInventoryQuantity(inventoryId = "", deltaQty = 0) {
  if (!inventoryId || !deltaQty) return false;

  let changed = false;
  const records = getLocalInventoryRecords().map(item => {
    if (String(item.id || "") !== String(inventoryId || "")) return item;

    changed = true;
    const nextQty = Math.max(Number(item.qty ?? item.quantity ?? 0) - deltaQty, 0);
    return {
      ...item,
      qty: nextQty,
      quantity: nextQty
    };
  });

  if (changed) saveLocalInventoryRecords(records);
  return changed;
}

async function updateSupabaseInventoryQuantity(inventoryId = "", deltaQty = 0) {
  if (!inventoryId || !deltaQty || String(inventoryId).startsWith("local-")) return false;

  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .eq("id", inventoryId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("Inventory stock lookup failed:", error.message || error);
    return false;
  }

  const currentQty = Number(data.qty ?? data.quantity ?? 0);
  const nextQty = Math.max(currentQty - deltaQty, 0);
  const { error: updateError } = await supabase
    .from("inventory")
    .update({ qty: nextQty })
    .eq("id", inventoryId);

  if (updateError) {
    console.warn("Inventory stock update failed:", updateError.message || updateError);
    return false;
  }

  return true;
}

async function syncCctvInventoryUsage(previousItems = [], nextItems = []) {
  const previousUsage = summarizeInventoryUsage(previousItems);
  const nextUsage = summarizeInventoryUsage(nextItems);
  const keys = new Set([...previousUsage.keys(), ...nextUsage.keys()]);

  for (const key of keys) {
    const previousQty = Number(previousUsage.get(key)?.qty || 0);
    const nextQty = Number(nextUsage.get(key)?.qty || 0);
    const deltaQty = nextQty - previousQty;
    const inventoryId = nextUsage.get(key)?.inventory_id || previousUsage.get(key)?.inventory_id || "";

    if (!deltaQty || !inventoryId) continue;

    updateLocalInventoryQuantity(inventoryId, deltaQty);
    await updateSupabaseInventoryQuantity(inventoryId, deltaQty);
  }
}

function toggleEditQuotationTypeView() {
  const isManpower = document.getElementById("edit_quotation_type")?.value === "manpower";
  const isCctv = document.getElementById("edit_quotation_type")?.value === "cctv";
  const panel = document.getElementById("editManpowerQuotationPanel");
  if (panel) panel.style.display = isManpower ? "" : "none";
  const cctvPanel = document.getElementById("editCctvMaterialsPanel");
  if (cctvPanel) cctvPanel.style.display = isCctv ? "" : "none";
  setPanelControlsDisabled(panel, !isManpower);
  setPanelControlsDisabled(cctvPanel, !isCctv);
  if (isManpower && edit_manpower_down_payment) {
    edit_manpower_down_payment.disabled = false;
    edit_manpower_down_payment.readOnly = false;
  }

  EDIT_MANPOWER_HIDDEN_FIELD_IDS.forEach(id => {
    const field = document.getElementById(id);
    const wrapper = field?.closest(".form-grid > div");
    if (wrapper) wrapper.style.display = isManpower ? "none" : "";
  });

  const remarksField = document.getElementById("edit_remarks");
  const remarksLabel = remarksField?.previousElementSibling;
  if (remarksField) remarksField.style.display = isManpower ? "none" : "";
  if (remarksLabel?.tagName === "LABEL") remarksLabel.style.display = isManpower ? "none" : "";
}

function buildEditManpowerRemarks() {
  const lines = [
    "Quotation Type: Manpower",
    edit_manpower_client_email.value ? `Client Email: ${edit_manpower_client_email.value}` : "",
    edit_manpower_down_payment.value ? `Amount Paid: ${edit_manpower_down_payment.value}` : "",
    edit_project_duration_days.value ? `Project Duration Days: ${Math.max(1, Math.trunc(Number(edit_project_duration_days.value || 0)))}` : "",
    edit_manpower_prepared_by.value ? `Prepared By: ${edit_manpower_prepared_by.value}` : "",
    edit_manpower_prepared_position.value ? `Position: ${edit_manpower_prepared_position.value}` : "",
    edit_manpower_terms.value ? `Terms of Service: ${edit_manpower_terms.value}` : "",
    edit_manpower_work_description.value ? `Work Description: ${edit_manpower_work_description.value}` : "",
    edit_manpower_additional_comments.value ? `Additional Comments: ${edit_manpower_additional_comments.value}` : ""
  ].filter(Boolean);

  return lines.join("\n");
}

function buildEditCctvRemarks(currentProject = {}) {
  const details = getCctvQuotationDetails(currentProject);
  const durationInput = document.getElementById("edit_cctv_duration_days");
  const durationDays = getDurationDaysFromValue(durationInput?.value);
  const existingRemarks = String(edit_remarks?.value || currentProject.remarks || "")
    .split(/\r?\n/)
    .filter(line => !/^project duration days:/i.test(line.trim()))
    .join("\n")
    .trim();

  if (existingRemarks) {
    return [
      existingRemarks,
      durationDays ? `Project Duration Days: ${durationDays}` : ""
    ].filter(Boolean).join("\n");
  }

  return [
    "Quotation Type: CCTV",
    `CCTV Intro: ${details.intro}`,
    durationDays ? `Project Duration Days: ${durationDays}` : "",
    `Installation Charge: ${details.installationCharge}`,
    `Summary of Computation: ${details.summaryComputation}`,
    `Note: ${details.note}`,
    `Terms and Conditions: ${details.terms}`
  ].filter(Boolean).join("\n");
}

window.addEditManpowerQuotationItem = function() {
  document.getElementById("editManpowerQuotationItemsBody")?.appendChild(createEditManpowerQuotationItemRow());
  updateEditManpowerAmount();
};

window.removeEditManpowerQuotationItem = function(button) {
  const row = button.closest("tr");
  const body = row?.closest("tbody");

  if (!row || !body) return;

  row.remove();

  if (!body.children.length) {
    body.appendChild(createEditManpowerQuotationItemRow());
  }

  updateEditManpowerAmount();
};

window.generateQuotation = async function(id, options = {}) {
  const shouldPrint = options.print !== false;
  const includeBackButton = options.includeBackButton === true;
  const project = await getProjectForAction(id, "Quotation");

  if (!project) {
    return;
  }

  const manpower = getManpowerQuotationDetails(project);
  const fallbackManpowerQty = Number(manpower.workers || 1) || 1;
  const fallbackManpowerAmount = Number(project.contract_amount || 0)
    ? Number(project.contract_amount || 0) / fallbackManpowerQty
    : Number(manpower.days || 0) * Number(manpower.rate || 0);
  const manpowerItems = (manpower.items || []).length
    ? manpower.items
    : [{
        description: manpower.position || manpower.workDescription || project.project_title || "Manpower Services",
        qty: fallbackManpowerQty,
        amount: fallbackManpowerAmount
      }];
  const normalizedManpowerItems = manpowerItems.map(item => {
    const qty = Number(item.qty || 0);
    const unitPrice = Number(item.unitPrice ?? item.price ?? item.amount ?? 0);
    return {
      ...item,
      qty,
      unitPrice,
      amount: qty * unitPrice
    };
  });
  const contractAmount = normalizedManpowerItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const downPayment = getProjectDownPayment(project);
  const downPaymentPercent = getPercentFromAmount(downPayment, contractAmount);
  const balanceDue = Math.max(contractAmount - downPayment, 0);
  const quoteNumber = `MP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(project.project_code || id).replace(/[^\w-]/g, "").slice(0, 12)}`;
  const quotationDate = new Date().toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const workDescription = manpower.workDescription || manpower.scope || project.project_title || "";
  const preparedByName = cleanSignatoryName(manpower.preparedBy || project.ppr_prepared_by)
    || getCurrentAccountName()
    || "MARK LYNDON LAWAS";
  const preparedPosition = cleanSignatoryName(manpower.preparedPosition) || "OPERATION MANAGER";

  const quotationWindow = window.open("", "_blank");

  if (!quotationWindow) {
    alert("Please allow pop-ups to generate quotation.");
    return;
  }

  quotationWindow.document.write(`
    <html>
    <head>
      <title>${quoteNumber}</title>
      <style>
        @page{
          size:A4;
          margin:12mm;
        }
        *{
          box-sizing:border-box;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
          color-adjust:exact;
          forced-color-adjust:none;
        }
        html{
          background:#fff;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
        }
        body{
          font-family:Arial, Helvetica, sans-serif;
          width:186mm;
          min-height:273mm;
          margin:0 auto;
          padding:0;
          background:#fff;
          color:#111827;
          line-height:1.28;
          font-size:11px;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
        }
        .letterhead{
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:14px;
          border-bottom:2px solid #0b5d66;
          padding-bottom:7px;
          margin-bottom:11px;
        }
        .logo{
          width:236px;
          max-width:48%;
        }
        .quote-meta{
          text-align:right;
          font-size:11px;
        }
        h1{
          margin:0 0 5px;
          color:#0b5d66;
          text-transform:uppercase;
          font-size:21px;
          letter-spacing:.06em;
        }
        .company-name{
          margin:4px 0 0;
          font-weight:bold;
          color:#0b5d66;
          text-align:center;
          text-transform:uppercase;
        }
        .section-title{
          margin:13px 0 5px;
          padding:5px 7px;
          background:#0b5d66;
          color:#fff;
          font-weight:bold;
          text-transform:uppercase;
          font-size:11px;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
        }
        table{
          width:100%;
          border-collapse:collapse;
        }
        th,
        td{
          border:1px solid #8fa3af;
          padding:6px 7px;
          font-size:11px;
          vertical-align:top;
        }
        th{
          background:#d9edf0;
          color:#082f35;
          text-align:center;
          text-transform:uppercase;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
        }
        .details td:first-child{
          width:22%;
          font-weight:bold;
          background:#f4f8f9;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
        }
        .scope-box{
          border:1px solid #8fa3af;
          min-height:54px;
          padding:8px 9px;
          white-space:pre-wrap;
        }
        .amount{
          text-align:right;
          white-space:nowrap;
        }
        .manpower-items th{
          background:#0b5d66;
          color:#fff;
          border:1px solid #111;
          padding:5px 7px;
        }
        .manpower-items td{
          border:1px solid #111;
          padding:4px 7px;
          font-size:12px;
        }
        .manpower-items .description-cell{
          text-align:center;
          font-size:14px;
        }
        .manpower-items .qty-cell{
          width:8%;
          text-align:center;
        }
        .manpower-items .price-cell{
          width:18%;
          text-align:right;
        }
        .manpower-items .amount-cell{
          width:18%;
          text-align:right;
          background:#c7e7f7;
        }
        .manpower-items .blank-cell{
          height:25px;
        }
        .manpower-items .final-total td{
          background:#0b5d66;
          height:25px;
          border-color:#111;
        }
        .manpower-items .final-total .amount-cell{
          background:#c7e7f7;
          color:#0b1f35;
          font-weight:800;
          font-size:14px;
        }
        .total-row td{
          font-weight:bold;
          background:#f4f8f9;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
        }
        .total-label{
          text-align:right;
          font-weight:bold;
        }
        .thank-you{
          margin-top:18px;
          padding:4px 8px;
          background:#0b5d66;
          color:#fff;
          text-align:center;
          text-transform:uppercase;
          font-size:15px;
          font-weight:bold;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
          break-after:avoid;
          page-break-after:avoid;
        }
        .prepared{
          display:inline-block;
          margin-top:14px;
          width:330px;
          min-height:0;
          font-size:15px;
          text-transform:uppercase;
          break-inside:avoid;
          page-break-inside:avoid;
          page-break-before:avoid;
        }
        .prepared-line{
          border-top:1px solid #111;
          width:330px;
          height:1px;
          margin:0 0 5px 0;
          padding:0;
        }
        .prepared-label,
        .prepared-name,
        .prepared-position{
          display:block;
          font-weight:normal;
          line-height:1.35;
        }
        .prepared-signature{
          width:160px;
          height:42px;
          margin:0 0 -6px 52px;
          opacity:1;
          overflow:hidden;
        }
        .prepared-signature .signature-svg{
          width:100%;
          height:100%;
          object-fit:contain;
          display:block;
          mix-blend-mode:multiply;
        }
        @media print{
          *{
            -webkit-print-color-adjust:exact !important;
            print-color-adjust:exact !important;
            color-adjust:exact !important;
            forced-color-adjust:none !important;
          }
          html,
          body{
            width:186mm;
            min-height:0;
            background:#fff !important;
          }
          .section-title,
          .thank-you,
          th,
          .details td:first-child,
          .total-row td,
          td[style*="background"]{
            -webkit-print-color-adjust:exact !important;
            print-color-adjust:exact !important;
          }
          .letterhead{break-inside:avoid;}
          table,
          .scope-box{
            break-inside:avoid;
          }
          .thank-you,
          .prepared{
            break-inside:avoid;
            page-break-inside:avoid;
          }
        }
        ${includeBackButton ? getPrintableViewControlsStyle() : ""}
      </style>
    </head>
    <body>
      ${includeBackButton ? getPrintableViewControls() : ""}
      <div class="letterhead">
        <img src="${assetUrl("pdf-image-1.jpg")}" class="logo" onerror="this.src='${assetUrl("assets/logo.jpg")}'">
        <div class="quote-meta">
          <h1>Manpower Quotation</h1>
          <div><b>Quotation No:</b> ${quoteNumber}</div>
          <div><b>Date:</b> ${quotationDate}</div>
        </div>
      </div>
      <div class="company-name">LEMYU Fiber Optic Installation and Services</div>

      <div class="section-title">Client Details</div>
      <table class="details">
        <tr>
          <td>CLIENT NAME:</td>
          <td>${escapeProjectHtml(getProjectClientName(project) || project.client_name || "-")}</td>
          <td style="width:17%;background:#0b5d66;color:#fff;font-weight:bold;text-align:center;">Date</td>
          <td style="width:16%;">${escapeProjectHtml(new Date().toLocaleDateString("en-US"))}</td>
        </tr>
        <tr><td>CLIENT CONTACT NUMBER:</td><td>${escapeProjectHtml(project.contact_number || "-")}</td></tr>
        <tr><td>CLIENT EMAIL:</td><td>${escapeProjectHtml(manpower.clientEmail || project.client_email || "-")}</td></tr>
      </table>

      <div class="section-title">Terms of Service</div>
      <div class="scope-box">${escapeProjectHtml(manpower.terms || "-")}</div>

      <div class="section-title">Work Description</div>
      <div class="scope-box">${escapeProjectHtml(workDescription || "-")}</div>

      <div class="section-title">Additional Comments</div>
      <div class="scope-box">${escapeProjectHtml(manpower.additionalComments || manpower.notes || "-")}</div>

      <div class="section-title">Quotation Items</div>
      <table class="manpower-items">
        <thead>
          <tr>
            <th>Description</th>
            <th class="qty-cell">Qty</th>
            <th class="price-cell">Unit Price</th>
            <th style="width:22%;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${normalizedManpowerItems.map(item => `
            <tr>
              <td class="description-cell">${escapeProjectHtml(item.description || "-")}</td>
              <td class="qty-cell">${escapeProjectHtml(item.qty || 0)}</td>
              <td class="price-cell">${formatQuotationAmount(item.unitPrice || 0)}</td>
              <td class="amount-cell">${formatQuotationAmount(item.amount || 0)}</td>
            </tr>
          `).join("")}
          ${Array.from({ length: Math.max(0, 7 - normalizedManpowerItems.length) }).map(() => `
            <tr>
              <td class="blank-cell"></td>
              <td class="blank-cell"></td>
              <td class="blank-cell"></td>
              <td class="amount-cell blank-cell"></td>
            </tr>
          `).join("")}
          <tr class="final-total">
            <td colspan="3"></td>
            <td class="amount-cell">${formatQuotationAmount(contractAmount)}</td>
          </tr>
          <tr class="total-row">
            <td colspan="3" class="total-label">Down Payment (${downPaymentPercent.toFixed(2)}%)</td>
            <td class="amount-cell">${formatQuotationAmount(downPayment)}</td>
          </tr>
          <tr class="total-row">
            <td colspan="3" class="total-label">Balance Due</td>
            <td class="amount-cell">${formatQuotationAmount(balanceDue)}</td>
          </tr>
        </tbody>
      </table>

      <div class="thank-you">Thank You</div>

      <div class="prepared">
        <div class="prepared-signature">${markSignatureSvg()}</div>
        <div class="prepared-line"></div>
        <span class="prepared-name">${escapeProjectHtml(preparedByName)}</span>
        <span class="prepared-label">Prepared By</span>
        <span class="prepared-position">${escapeProjectHtml(preparedPosition)}</span>
      </div>
    </body>
    </html>
  `);

  quotationWindow.document.close();
  if (shouldPrint) {
    setTimeout(() => quotationWindow.print(), 800);
  }
};

window.generateSupplyInstallationQuotation = async function(id, options = {}) {
  const shouldPrint = options.print !== false;
  const includeBackButton = options.includeBackButton === true;
  const project = await getProjectForAction(id, "Supply quotation");

  if (!project) {
    return;
  }

  const { data: inventory = [] } = await supabase
    .from("inventory")
    .select("*");

  const projectCode = project.project_code || "";
  const materials = mergeInventoryRecords(inventory)
    .filter(item => getInventoryProjectCode(item) === projectCode)
    .map(item => {
      const qty = getQuotationQty(item.qty);
      const unitPrice = Number(item.price || 0);
      return {
        description: item.name || item.description || "Material",
        details: item.description || "",
        qty,
        unit: getInventoryUnit(item),
        unitPrice,
        amount: qty * unitPrice,
        picture_url: item.picture_url || ""
      };
    });

  const serviceRows = (Array.isArray(project.quotation_items)
    ? project.quotation_items
    : getLocalQuotationItems(project.id)
  ).map(item => {
    const qty = getQuotationQty(item.qty);
    const unitPrice = Number(item.price ?? item.unitPrice ?? item.amount ?? 0);
    return {
      description: item.name || item.description || "-",
      details: item.details || item.description || "",
      qty,
      unit: item.unit || "",
      unitPrice,
      amount: qty * unitPrice,
      picture_url: item.picture_url || ""
    };
  });

  const rows = [
    ...materials,
    ...serviceRows
  ].filter(hasQuotationPrice)
  .filter((item, index, list) => {
    const key = [
      String(item.description || "").trim().toLowerCase(),
      String(item.details || "").trim().toLowerCase(),
      String(item.unit || "").trim().toLowerCase(),
      String(item.unitPrice || 0),
      String(item.picture_url || "")
    ].join("|");

    return list.findIndex(candidate => [
      String(candidate.description || "").trim().toLowerCase(),
      String(candidate.details || "").trim().toLowerCase(),
      String(candidate.unit || "").trim().toLowerCase(),
      String(candidate.unitPrice || 0),
      String(candidate.picture_url || "")
    ].join("|") === key) === index;
  });

  if (!rows.length) {
    rows.push({
      description: project.remarks || project.project_title || "Supply and installation services",
      details: "",
      qty: 1,
      unit: "LOT",
      unitPrice: Number(project.contract_amount || 0),
      amount: Number(project.contract_amount || 0)
    });
  }

  const cctvDetails = getCctvQuotationDetails(project);
  const totalAmount = Number(project.contract_amount || 0);
  const quotationDate = new Date().toLocaleDateString("en-US");
  const quoteNumber = `SIQ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(projectCode || id).replace(/[^\w-]/g, "").slice(0, 12)}`;
  const companyName = project.client_name || getProjectClientName(project) || "-";
  const contactName = getProjectClientName(project) || project.client_name || "-";
  const quotationTitle = (cctvDetails.intro || CCTV_QUOTATION_DEFAULTS.intro).split(/\r?\n/);
  const mainQuotationLine = quotationTitle[0] || CCTV_QUOTATION_DEFAULTS.intro.split(/\r?\n/)[0];
  const subQuotationLine = quotationTitle[1] || "2MP HYBRID IP CCTV W/ FIBER OPTIC INSTALLATION";
  const remarksLine = quotationTitle.slice(2).join(" ") || "We are pleased to offer you the following products for consideration.";
  const supplyWindow = window.open("", "_blank");

  if (!supplyWindow) {
    alert("Please allow pop-ups to generate supply and installation quotation.");
    return;
  }

  supplyWindow.document.write(`
    <html>
    <head>
      <title>${quoteNumber}</title>
      <style>
        @page{size:A4;margin:10mm;}
        *{box-sizing:border-box;}
        body{
          font-family:Arial,Helvetica,sans-serif;
          width:190mm;
          margin:0 auto;
          color:#000;
          font-size:8px;
          line-height:1.15;
          -webkit-print-color-adjust:exact;
          print-color-adjust:exact;
        }
        .top-header{
          display:flex;
          justify-content:space-between;
          align-items:flex-end;
          gap:16px;
          margin:24px 6px 4px;
        }
        .tel-box{width:52px;font-weight:700;font-size:8px;padding-bottom:58px;}
        .logo{width:365px;height:auto;display:block;}
        .company-meta{width:270px;font-size:8px;}
        .company-meta .row{display:grid;grid-template-columns:75px 1fr;margin-bottom:2px;}
        .company-meta .label{font-weight:700;}
        .gray-rule{height:11px;background:#bfbfbf;margin:0 0 9px;}
        table{width:100%;border-collapse:collapse;}
        .client-info{margin-bottom:2px;}
        .client-info td{border:0;padding:1px 2px;font-size:9px;}
        .client-info .label{width:105px;font-weight:800;}
        .client-info .value{font-size:14px;}
        .yellow-title{
          border:1px solid #000;
          background:#ffff00;
          text-align:center;
          font-weight:800;
          font-size:8.2px;
          padding:1px;
        }
        .subtitle{text-align:center;font-weight:800;font-size:9px;margin:1px 0 0;}
        .subtitle.small{font-size:8.3px;}
        .items{table-layout:fixed;margin-top:2px;}
        .items th{
          border:1px solid #000;
          background:#00d737;
          color:#000;
          text-align:center;
          font-weight:800;
          padding:4px 2px;
          font-size:7.3px;
          text-transform:uppercase;
        }
        .items td{
          border:1px solid #111;
          vertical-align:middle;
          padding:3px;
          font-size:7.5px;
        }
        .item-no{width:5%;text-align:center;font-weight:700;}
        .qty{width:5%;text-align:center;font-weight:700;font-size:12px;}
        .photo{width:25%;text-align:center;}
        .description{width:34%;vertical-align:top!important;}
        .unit-price{width:10%;text-align:right;vertical-align:top!important;}
        .total-amount{width:21%;text-align:right;vertical-align:top!important;}
        .product-photo{max-width:100%;max-height:105px;object-fit:contain;display:block;margin:auto;}
        .photo-placeholder{height:105px;}
        .item-name{font-weight:800;color:#e00000;}
        .item-details{margin-top:3px;white-space:pre-wrap;}
        .item-row td{height:132px;}
        .subtotal-note{background:#b6d7a8;font-weight:800;color:#d90000;text-align:center;}
        .subtotal-label{background:#ffff00;font-weight:800;text-align:center;}
        .subtotal-value{background:#ffff00;font-weight:800;text-align:center;font-size:12px;}
        .vat-row td{border:0;}
        .vat-cell{background:#808080;color:#000;font-weight:800;text-align:center;padding:4px!important;}
        .install-table,.computation-table{table-layout:fixed;margin-top:12px;}
        .install-table th,.computation-table th{
          border:1px solid #000;
          background:#00d737;
          color:#000;
          font-weight:800;
          text-align:center;
          text-transform:uppercase;
          padding:4px 2px;
          font-size:7.5px;
        }
        .install-title,.computation-title{
          background:#00d737!important;
          color:#ff0000!important;
          font-size:14px!important;
          letter-spacing:.03em;
        }
        .install-table td,.computation-table td{
          border:1px solid #000;
          padding:5px;
          font-size:8px;
          vertical-align:middle;
        }
        .install-system{width:10%;text-align:center;font-weight:800;}
        .install-scope{width:70%;}
        .install-amount{width:20%;text-align:right;}
        .charge-title{font-size:12px;font-weight:800;}
        .install-subtotal-label{
          background:#ffff00;
          font-weight:800;
          text-align:center;
          width:16%;
        }
        .install-subtotal-value{
          background:#ffff00;
          font-weight:800;
          text-align:right;
          font-size:13px!important;
        }
        .computation-table .lot{width:10%;text-align:center;}
        .computation-table .desc{text-align:center;font-weight:800;text-decoration:underline;}
        .computation-table .amount{width:21%;text-align:right;}
        .total-label{background:#ffff00;font-weight:800;text-align:center;color:#000;}
        .total-value{background:#ffff00;font-weight:800;text-align:right;color:#ff0000;font-size:12px!important;}
        .terms-title{
          margin:14px auto 8px;
          width:80%;
          border:1px solid #000;
          background:#ffff00;
          color:#ff0000;
          text-align:center;
          font-weight:800;
          font-size:8px;
          padding:2px;
        }
        .note-area{
          margin:5px auto 8px;
          width:78%;
          font-size:8px;
        }
        .note-row{display:grid;grid-template-columns:95px 1fr;margin-bottom:5px;}
        .note-label{font-weight:800;}
        .highlight{background:#ffff00;font-weight:800;color:#ff0000;display:inline-block;padding:1px 4px;}
        .red{color:#ff0000;font-weight:800;}
        .terms-grid{
          width:78%;
          margin:0 auto;
          font-size:7.4px;
        }
        .terms-row{display:grid;grid-template-columns:115px 1fr;margin-bottom:12px;}
        .terms-label{font-weight:800;}
        .terms-body{
          white-space:pre-wrap;
        }
        .closing{margin:18px 8px 0;font-size:8px;}
        .sign-block{
          margin:55px auto 0;
          width:86%;
          display:grid;
          grid-template-columns:1fr 1fr;
          column-gap:70px;
          align-items:start;
          font-size:7px;
          font-weight:800;
          font-family:Arial,Helvetica,sans-serif;
          text-align:center;
        }
        .sign-col{min-height:82px;display:flex;flex-direction:column;align-items:center;}
        .prepared-heading{font-weight:800;margin-bottom:4px;}
        .signature-space{
          width:260px;
          height:60px;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .signatory-signature-svg{
          width:260px;
          height:58px;
          display:block;
          margin:0 auto;
          object-fit:contain;
          mix-blend-mode:multiply;
        }
        .prepared-line{
          border-top:1px solid #000;
          width:260px;
          margin:0 auto;
          padding-top:5px;
          font-weight:800;
        }
        .prepared-name{font-weight:800;}
        .approved-heading{font-weight:800;margin-bottom:4px;}
        .approved-line{
          border-top:1px solid #000;
          width:260px;
          margin:0 auto;
          padding-top:5px;
          font-weight:800;
        }
        .signature-svg{width:190px;height:60px;}
        ${includeBackButton ? getPrintableViewControlsStyle() : ""}
      </style>
    </head>
    <body>
      ${includeBackButton ? getPrintableViewControls() : ""}
      <div class="top-header">
        <div class="tel-box">Tel<br>No:</div>
        <img src="${assetUrl("pdf-image-1.jpg")}" class="logo" onerror="this.src='${assetUrl("assets/logo.jpg")}'">
        <div class="company-meta">
          <div class="row"><div class="label">Address:</div><div>Blk 06 Lot 06 Phase 1EA Mabuhay<br>City Mamatid Cabuyao Laguna</div></div>
          <div class="row"><div class="label">Mobile No:</div><div>+63 9169088063</div></div>
          <div class="row"><div class="label">Manager:</div><div>Mark Lyndon Lawas</div></div>
          <div class="row"><div class="label">Email:</div><div></div></div>
          <div class="row"><div class="label">FB Account:</div><div>FB/Lawas Lyndon Mark</div></div>
          <div class="row"><div class="label">Date:</div><div>${escapeProjectHtml(quotationDate)}</div></div>
        </div>
      </div>
      <div class="gray-rule"></div>

      <table class="client-info">
        <tr>
          <td class="label">Company Name:</td>
          <td rowspan="2" class="value">${escapeProjectHtml(companyName)}</td>
        </tr>
        <tr><td class="label">Address:</td></tr>
        <tr><td class="label">Email Add:</td><td>${escapeProjectHtml(project.client_email || "")}</td></tr>
        <tr><td class="label">ATTENTION:</td><td>${escapeProjectHtml(contactName)}</td></tr>
      </table>

      <div class="yellow-title">${escapeProjectHtml(mainQuotationLine)}</div>
      <div class="subtitle">${escapeProjectHtml(subQuotationLine)}</div>
      <div class="subtitle small">${escapeProjectHtml(remarksLine)}</div>

      <table class="items">
        <thead>
          <tr>
            <th class="item-no">Item<br>No.</th>
            <th class="qty">Qty</th>
            <th class="photo">Reference Photo</th>
            <th class="description">Item Description</th>
            <th class="unit-price">Unit Price</th>
            <th class="total-amount">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((item, index) => `
            <tr class="item-row">
              <td class="item-no">${index + 1}</td>
              <td class="qty">${escapeProjectHtml(item.qty || 1)}</td>
              <td class="photo">
                ${item.picture_url
                  ? `<img class="product-photo" src="${escapeProjectHtml(item.picture_url)}" alt="">`
                  : `<div class="photo-placeholder"></div>`}
              </td>
              <td class="description">
                <div><span class="item-name">${escapeProjectHtml(item.description || "-")}</span>${item.unit ? ` <b>Unit:</b> ${escapeProjectHtml(item.unit)}` : ""}</div>
                ${item.details ? `<div class="item-details">${quotationText(item.details)}</div>` : ""}
              </td>
              <td class="unit-price">${formatQuotationAmount(item.unitPrice || 0)}</td>
              <td class="total-amount">${formatQuotationAmount(item.amount || 0)}</td>
            </tr>
          `).join("")}
          <tr>
            <td colspan="4" class="subtotal-note">NOTE: ITEMS / MODEL / QUANTITY are SUBJECT TO CHANGE w/o PRIOR NOTICE</td>
            <td class="subtotal-label">SUBTOTAL:</td>
            <td class="subtotal-value">${formatQuotationAmount(totalAmount)}</td>
          </tr>
          <tr class="vat-row"><td colspan="4"></td><td colspan="2" class="vat-cell">VAT EXCLUSIVE</td></tr>
        </tbody>
      </table>

      <table class="install-table">
        <thead>
          <tr><th colspan="3" class="install-title">INSTALLATION CHARGE</th></tr>
          <tr>
            <th class="install-system">CCTV<br>SYSTEM</th>
            <th class="install-scope">SCOPE OF WORK</th>
            <th class="install-amount">TOTAL AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="install-system">1 lot</td>
            <td class="install-scope"><span class="charge-title">LABOR CHARGE</span> Setup of Units and Peripherals, Wiring, Termination via Open cabling Setup, Network Switches, Mounting, Focusing, Testing & Commissioning, Assembling, NVR Configuration with Mobilization.</td>
            <td class="install-amount"></td>
          </tr>
          <tr>
            <td class="install-system">1 lot</td>
            <td class="install-scope"><span class="charge-title">HARDWARE MATERIALS:</span> Tools, Equipment & other miscellaneous unit used for installation, assembling and cabling works.</td>
            <td class="install-amount"></td>
          </tr>
          <tr>
            <td style="background:#ffd966;"></td>
            <td class="install-subtotal-label">SUBTOTAL:</td>
            <td class="install-subtotal-value">${formatQuotationAmount(totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <table class="computation-table">
        <thead>
          <tr><th colspan="3" class="computation-title">SUMMARY OF COMPUTATION</th></tr>
          <tr>
            <th class="lot">LOT NO#.</th>
            <th>DESCRIPTION</th>
            <th class="amount">TOTAL AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          <tr><td class="lot">1 lot</td><td class="desc">IP CCTV & NETWORK SOLUTIONS SYSTEM PRODUCTS</td><td class="amount"></td></tr>
          <tr><td class="lot">1 lot</td><td class="desc">INSTALLATION CHARGE & HARDWARE MATERIALS</td><td class="amount"></td></tr>
          <tr><td colspan="2" class="total-label">TOTAL<br>AMOUNT:</td><td class="total-value">${formatQuotationAmount(totalAmount)}</td></tr>
          <tr class="vat-row"><td colspan="2"></td><td class="vat-cell">VAT EXCLUSIVE</td></tr>
        </tbody>
      </table>

      <div class="note-area">
        <div class="note-row"><div class="note-label">Note:</div><div><b>Supply/ Installation details only.</b><br>Above quotation is based on quantity requested by customer.</div></div>
        <div class="note-row"><div></div><div>Upgradable cctv camera up to 40pcs cctv<br><br>android tv 32" included in this cctv package<br>CONSUMABLES AND OTHER MATERIALS</div></div>
      </div>

      <div class="terms-title">TERMS AND CONDITIONS</div>
      <div class="terms-grid">
        <div class="terms-row"><div class="terms-label">AVAILABILITY:</div><div class="terms-body">- 5-7 days if on stock upon receipt of approved P.O.<br>- For items not on stock/indent order, an estimate of 60-90 days upon receipt of approved P.O. & down payment. Barring any delay in shipping and customs clearance beyond Lemyu.<br>- In the event of a conflict or inconsistency in estimated days under Availability and another estimate indicated elsewhere in this quotation, the latter will prevail.</div></div>
        <div class="terms-row"><div class="terms-label">WARRANTY:</div><div class="terms-body"><span class="red">* 1 year from time of purchased for TIANDY CCTV Products and WI-TEK Network Solution Products. 6 months from time of purchased for Monitor, HDD, PSU Unit.</span><br>The warranty will be VOID under the following circumstances:<br>* If the unit is being tampered with.<br>* If the item(s) is/are altered in any way by unauthorized technicians.<br>* If it has been subjected to misuse, mishandling, neglect, or accident.<br>* If damaged, due to spillage of liquids, near corrosion, rusting or stains.<br><br>* This warranty does not cover loss product accessories. Shipping costs for warranty claims are for customer's account.</div></div>
        <div class="terms-row"><div class="terms-label">RETURN:</div><div class="terms-body"><span class="red">7 Days Return Policy</span> - if the product received is defective, damaged, or incomplete. With has duly acknowledged communication as received within a maximum of 7 days to qualify for replacement.</div></div>
        <div class="terms-row"><div class="terms-label">PAYMENT:</div><div class="terms-body"><span class="red">Cash on Pick up (COP), Bank Transfer, Bank Deposit, Cheque Payment (for clearing)<br>Fifty Percent (50%) DOWNPAYMENT,20% Upon Delivery of materials 30% UPON completion</span></div></div>
        <div class="terms-row"><div class="terms-label">VALIDITY:</div><div class="terms-body"><span class="red">Fifteen (15) calendar days from date of this offer.</span> In the event of changes in prevailing market conditions, duties, taxes, and all other importation charges, offer details are subject to change.</div></div>
      </div>

      <div class="closing">
        Thank you for the opportunity to quote.<br>
        For and in Behalf of:<br><br>
        <b><i>Lemyu Fiber Optic Installation.</i></b> : Blk 06 Lot 06 Phase 1EA Mabuhay City Mamatid Cabuyao Laguna
      </div>

      <div class="sign-block">
        <div class="sign-col">
          <div class="prepared-heading">PREPARED BY:</div>
          <div class="signature-space">${markSignatureSvg("signatory-signature-svg")}</div>
          <div class="prepared-line">
            Mr. <span class="prepared-name">Mark Lyndon Lawas</span><br>
            Operational Manager<br>
            Mobile No. 0916908063<br>
            <span style="color:#0563c1;">markslawas218@gmail.com</span>
          </div>
        </div>
        <div class="sign-col">
          <div class="approved-heading">APPROVED & VERIFIED BY:</div>
          <div class="signature-space"></div>
          <div class="approved-line">COMPANY AUTHORIZED REPRESENTATIVE<br>(PLEASE SIGN OVER PRINTED NAME & DATE)</div>
        </div>
      </div>
    </body>
    </html>
  `);

  supplyWindow.document.close();
  if (shouldPrint) {
    setTimeout(() => supplyWindow.print(), 800);
  }
};

function getProjectDateForList(project = {}) {
  return project.start_date || project.created_at || project.updated_at || "";
}

function getProjectSearchText(project = {}) {
  return [
    project.project_code,
    project.project_title,
    project.client_name,
    project.client_contact_name,
    project.contact_number,
    project.location,
    project.company_name,
    project.status,
    project.prepared_by,
    project.ppr_prepared_by,
    project.ppr_noted_by,
    getProjectQuotationLabel(project)
  ].join(" ").toLowerCase();
}

function isWithinProjectDateFilter(project = {}) {
  const dateFilter = projectListState.date;
  if (dateFilter === "all") return true;

  const rawDate = getProjectDateForList(project);
  if (!rawDate) return dateFilter === "no_date";

  const projectDate = new Date(rawDate);
  if (Number.isNaN(projectDate.getTime())) return dateFilter === "no_date";

  const today = new Date();
  if (dateFilter === "this_month") {
    return projectDate.getFullYear() === today.getFullYear()
      && projectDate.getMonth() === today.getMonth();
  }

  if (dateFilter === "this_year") {
    return projectDate.getFullYear() === today.getFullYear();
  }

  return true;
}

function getFilteredProjects() {
  const search = projectListState.search.trim().toLowerCase();

  return allProjects
    .filter(project => {
      if (!search) return true;
      return getProjectSearchText(project).includes(search);
    })
    .filter(project => {
      if (projectListState.status === "all") return true;
      return String(project.status || "").toLowerCase() === projectListState.status.toLowerCase();
    })
    .filter(project => isWithinProjectDateFilter(project))
    .filter(project => {
      if (projectListState.type === "all") return true;
      return getProjectQuotationLabel(project).toLowerCase().includes(projectListState.type);
    })
    .sort((a, b) => {
      const dateA = new Date(getProjectDateForList(a) || 0).getTime() || 0;
      const dateB = new Date(getProjectDateForList(b) || 0).getTime() || 0;
      const titleA = String(a.project_title || "").toLowerCase();
      const titleB = String(b.project_title || "").toLowerCase();
      const statusA = String(a.status || "").toLowerCase();
      const statusB = String(b.status || "").toLowerCase();
      const contractA = Number(a.contract_amount || 0);
      const contractB = Number(b.contract_amount || 0);

      if (projectListState.sort === "oldest") return dateA - dateB || titleA.localeCompare(titleB);
      if (projectListState.sort === "title_asc") return titleA.localeCompare(titleB) || dateB - dateA;
      if (projectListState.sort === "status_asc") return statusA.localeCompare(statusB) || dateB - dateA;
      if (projectListState.sort === "contract_desc") return contractB - contractA || titleA.localeCompare(titleB);
      if (projectListState.sort === "contract_asc") return contractA - contractB || titleA.localeCompare(titleB);
      return dateB - dateA || titleA.localeCompare(titleB);
    });
}

function hasActiveProjectFilters() {
  return Boolean(projectListState.search.trim())
    || projectListState.status !== "all"
    || projectListState.date !== "all"
    || projectListState.type !== "all";
}

function renderProjectPagination(totalItems) {
  const pagination = document.getElementById("projectPagination");
  const summary = document.getElementById("projectPaginationSummary");
  const controls = document.getElementById("projectPaginationControls");
  if (!pagination || !summary || !controls) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / PROJECT_PAGE_SIZE));
  projectCurrentPage = Math.min(Math.max(projectCurrentPage, 1), totalPages);
  const startIndex = totalItems ? ((projectCurrentPage - 1) * PROJECT_PAGE_SIZE) + 1 : 0;
  const endIndex = Math.min(projectCurrentPage * PROJECT_PAGE_SIZE, totalItems);

  pagination.hidden = false;
  summary.textContent = totalItems
    ? `Showing ${startIndex}-${endIndex} of ${totalItems} projects`
    : "Showing 0 of 0 projects";

  const pageWindow = 5;
  const firstPage = Math.max(1, Math.min(projectCurrentPage - 2, totalPages - pageWindow + 1));
  const lastPage = Math.min(totalPages, firstPage + pageWindow - 1);
  const pageButtons = [];

  for (let page = firstPage; page <= lastPage; page += 1) {
    pageButtons.push(`
      <button type="button" class="${page === projectCurrentPage ? "active" : ""}" ${page === projectCurrentPage ? "aria-current=\"page\"" : ""} onclick="goToProjectPage(${page})">${page}</button>
    `);
  }

  controls.innerHTML = `
    <button type="button" onclick="goToProjectPage(${projectCurrentPage - 1})" ${projectCurrentPage <= 1 ? "disabled" : ""}>Previous</button>
    ${pageButtons.join("")}
    <button type="button" onclick="goToProjectPage(${projectCurrentPage + 1})" ${projectCurrentPage >= totalPages ? "disabled" : ""}>Next</button>
  `;
}

function renderProjectList() {
  const projectTableBody = document.getElementById("projectTable");
  if (!projectTableBody) return;

  const headerRow = document.querySelector(".monitoring-table thead tr");
  if (headerRow) {
    headerRow.innerHTML = `
    <th>Code</th>
    <th>Title</th>
    <th>Client</th>
    <th>Contact</th>
    <th>Quotation Type</th>
    <th>Status</th>
    <th>Actions</th>
  `;
  }

  const projects = getFilteredProjects();
  const totalItems = projects.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PROJECT_PAGE_SIZE));
  projectCurrentPage = Math.min(Math.max(projectCurrentPage, 1), totalPages);
  const startIndex = (projectCurrentPage - 1) * PROJECT_PAGE_SIZE;
  const pageProjects = projects.slice(startIndex, startIndex + PROJECT_PAGE_SIZE);
  const isOperations = isOperationsScope();

  if (!pageProjects.length) {
    const message = allProjects.length && hasActiveProjectFilters()
      ? "No projects match the selected filters."
      : "No project records found.";
    projectTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">${message}</td></tr>`;
    renderProjectPagination(totalItems);
    return;
  }

  projectTableBody.innerHTML = pageProjects.map(project => {
    const statusValue = project.status || "Pending";
    const quotationLabel = getProjectQuotationLabel(project);
    const actionLinks = isOperations
      ? `<a href="#" onclick="generatePPR('${project.id}'); return false;">Generate PPR</a>`
      : isFinanceScope()
      ? `<a href="#" onclick="viewProject('${project.id}'); return false;">View Costing</a>`
      : `
          <a href="#" onclick="viewProject('${project.id}'); return false;">View</a>
          <a href="#" onclick="editProject('${project.id}'); return false;">Edit</a>
          <a href="#" onclick="generateProjectQuotation('${project.id}'); return false;">${escapeHtml(quotationLabel)}</a>
          ${getContractAction(project)}
          <a href="#" onclick="generatePPR('${project.id}'); return false;">Generate PPR</a>
          <a href="#" class="danger-link" onclick="deleteProject('${project.id}'); return false;">Delete</a>
        `;

    return `
      <tr>
        <td>${escapeHtml(project.project_code || "-")}</td>
        <td>${escapeHtml(project.project_title || "-")}</td>
        <td>${escapeHtml(project.client_name || "-")}</td>
        <td>${escapeHtml(project.contact_number || "-")}</td>
        <td>${escapeHtml(quotationLabel)}</td>
        <td><span class="status ${escapeHtml(statusValue)}">${escapeHtml(statusValue)}</span></td>
        <td class="action-links">
          ${actionLinks}
        </td>
      </tr>
    `;
  }).join("");

  renderProjectPagination(totalItems);
}

// LOAD PROJECTS
async function loadProjects() {
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Loading project records...</td></tr>`;
  }

  const { data: supabaseProjects, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.log(error);
    if (!getLocalSavedProjects().length) {
      allProjects = [];
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Unable to load project records. Please try again.</td></tr>`;
      }
      renderProjectPagination(0);
      return;
    }
  }

  const projects = mergeProjects(error ? [] : (supabaseProjects || []));
  allProjects = projects;
  setNextProjectCode(allProjects);

  const { data: expenseData = [], error: expenseError } = await supabase
    .from("expenses")
    .select("*");

  if (expenseError) {
    console.warn("Project list loaded without expense records.", expenseError);
  }

  const expenses = Array.isArray(expenseData) ? expenseData : [];

  await syncProjectContracts(allProjects, expenses);
  renderSmartContracts();
  renderProjectList();

  if (pendingDetailProjectId) {
    const projectId = pendingDetailProjectId;
    pendingDetailProjectId = "";
    window.viewProject(projectId, { skipStateSave: true });
  }
}

window.addEventListener("storage", event => {
  if (event.key === LOCAL_PROJECTS_KEY) {
    loadProjects();
  }
});
window.addEventListener("lemyu:data-sync-complete", loadProjects);
window.addEventListener("popstate", () => {
  const projectId = new URLSearchParams(window.location.search).get("view");
  if (projectId) {
    window.viewProject(projectId, { skipStateSave: true });
  } else {
    window.backToProjectList();
  }
});

// SAVE OR UPDATE PROJECT
if (form) {
form.addEventListener("submit", async function(e) {
  e.preventDefault();

  let fileUrl = "";
  let fileName = "";

  const fileInput = document.getElementById("contract_file");

  if (fileInput && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    try {
      const uploadedFile = await uploadProjectFile(file, "project-uploads");
      fileName = uploadedFile.filePath;
      fileUrl = uploadedFile.publicUrl;
    } catch (uploadError) {
      alert("File upload error: " + uploadError.message);
      return;
    }
  }

  const quotationItems = getQuotationItemsFromForm();

  const projectProgressInput = document.getElementById("progress_percentage");
  const record = {
    project_code: project_code.value,
    project_title: project_title.value,
    client_name: client_name.value,
    client_contact_name: client_contact_name.value,
    contact_number: contact_number.value,
    location: location.value,
    start_date: start_date.value || null,
    target_completion: target_completion.value || null,
    status: status.value,
    project_budget: Number(project_budget.value || 0),
    contract_amount: Number(contract_amount.value || 0),
    down_payment: Number(down_payment.value || 0),
    tax_amount: tax_amount.value === "" ? null : Number(tax_amount.value || 0),
    ppr_prepared_by: ppr_prepared_by.value,
    ppr_noted_by: ppr_noted_by.value,
    remarks: remarks.value,
    quotation_items: quotationItems
  };

  if (projectProgressInput) {
    record.progress_percentage = getProjectProgressInputValue(projectProgressInput);
  }

  if (fileUrl) {
    record.contract_file_url = fileUrl;
    record.contract_file_name = fileName;
  }

  let result;

  if (editingId) {
    result = await updateWithOptionalColumns(
      "projects",
      record,
      "id",
      editingId,
      ["progress_percentage", "quotation_items", "contract_file_url", "contract_file_name"],
      { returnRecord: true }
    );
  } else {
    result = await supabase
      .from("projects")
      .insert([record])
      .select("*")
      .single();
  }

  if (result.error) {
    alert("Supabase save failed: " + result.error.message + "\n\nPlease run supabase/cloud_required_schema.sql in Supabase SQL Editor, then try again.");
    return;
  }

  saveLocalQuotationItems(result.data.id, quotationItems);
  saveLocalClientName(result.data.id, client_contact_name.value);
  saveLocalDownPayment(result.data.id, down_payment.value);
  saveLocalProjectMirror(result.data);
  await saveProjectContract(result.data);

  alert(editingId ? "Project updated successfully!" : "Project saved successfully!");
  document.getElementById("editProjectSection").style.display = "none";
  document.getElementById("addProjectSection").style.display = "block";
  document.getElementById("projectListSection").style.display = "block";
  editingId = null;
  form.reset();
  resetQuotationItems();
  setNextProjectCode(allProjects);

  const saveBtn = form.querySelector("button[type='submit']");
  saveBtn.textContent = "Save Project";

  loadProjects();
});
}

function updateProjectDetailHeader(project = {}) {
  const title = document.getElementById("viewProjectTitle");
  const status = document.getElementById("viewProjectStatus");
  if (title) title.textContent = project.project_title || project.project_code || "Project Details";
  if (status) {
    const statusValue = project.status || "Pending";
    status.className = `status ${statusValue}`;
    status.textContent = statusValue;
  }
}

function openProjectDetailModal(project) {
  updateProjectDetailHeader(project);
  viewModal.style.display = "flex";
}

// VIEW FULL PROJECT DETAILS
window.viewProject = async function(id, options = {}) {
  if (!options.skipStateSave) {
    saveProjectListState();
    const url = new URL(window.location.href);
    url.searchParams.set("view", id);
    window.history.pushState({ projectView: id }, "", url);
  }

  if (viewContent) {
    viewContent.innerHTML = `<p class="muted">Loading project details...</p>`;
  }

  const project = await getProjectForAction(id, "Project");

  if (!project) {
    if (viewContent) viewContent.innerHTML = `<p class="muted">Unable to load project details.</p>`;
    if (viewModal) viewModal.style.display = "flex";
    return;
  }

  if (isFinanceScope()) {
    const { data: expenses = [] } = await supabase
      .from("expenses")
      .select("*")
      .eq("project_id", id);
    const financials = getProjectFinancials(project, expenses);
    const profit = financials.contract - financials.budget - financials.tax - financials.expenses;

    viewContent.innerHTML = `
      <div class="details-grid">
        <div class="detail-item"><small>Project Code</small><strong>${project.project_code || "-"}</strong></div>
        <div class="detail-item"><small>Project Title</small><strong>${project.project_title || "-"}</strong></div>
        <div class="detail-item"><small>Status</small><strong>${project.status || "-"}</strong></div>
        <div class="detail-item"><small>Project Budget</small><strong>${peso(financials.budget)}</strong></div>
        <div class="detail-item"><small>Contract Amount</small><strong>${peso(financials.contract)}</strong></div>
        <div class="detail-item"><small>Amount Paid</small><strong>${peso(financials.downPayment)}</strong></div>
        <div class="detail-item"><small>Tax Amount</small><strong>${peso(financials.tax)}</strong></div>
        <div class="detail-item"><small>Total Expenses</small><strong>${peso(financials.expenses)}</strong></div>
        <div class="detail-item"><small>Balance Due</small><strong>${peso(Math.max(financials.contract - financials.downPayment, 0))}</strong></div>
        <div class="detail-item"><small>Projected Profit</small><strong>${peso(profit)}</strong></div>
      </div>
    `;
    openProjectDetailModal(project);
    return;
  }

  if (isOperationsScope()) {
    viewContent.innerHTML = `
      <div class="details-grid">
        <div class="detail-item"><small>Project Code</small><strong>${project.project_code || "-"}</strong></div>
        <div class="detail-item"><small>Project Title</small><strong>${project.project_title || "-"}</strong></div>
        <div class="detail-item"><small>Company Name</small><strong>${project.client_name || "-"}</strong></div>
        <div class="detail-item"><small>Client Name</small><strong>${getProjectClientName(project) || "-"}</strong></div>
        <div class="detail-item"><small>Contact Number</small><strong>${project.contact_number || "-"}</strong></div>
        <div class="detail-item"><small>Location</small><strong>${project.location || "-"}</strong></div>
        <div class="detail-item"><small>Start Date</small><strong>${project.start_date || "-"}</strong></div>
        <div class="detail-item"><small>Target Completion</small><strong>${project.target_completion || "-"}</strong></div>
        <div class="detail-item"><small>Status</small><strong>${project.status || "-"}</strong></div>
        <div class="detail-item full-row"><small>Remarks</small><strong>${project.remarks || "-"}</strong></div>
      </div>
    `;
    openProjectDetailModal(project);
    return;
  }

  return window.generateProjectQuotation(id, {
    print: false,
    includeBackButton: true
  });
};

window.closeViewModal = function() {
  window.backToProjectList();
};

window.backToProjectList = function() {
  if (viewModal) {
    viewModal.style.display = "none";
  }

  const scrollY = restoreProjectListState();
  renderProjectList();

  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  window.history.replaceState({}, "", url);

  const listSection = document.getElementById("projectListSection");
  if (listSection) {
    listSection.style.display = "block";
  }

  requestAnimationFrame(() => {
    window.scrollTo({ top: scrollY, behavior: "smooth" });
  });
};


window.deleteSmartContract = function(contractId) {
  if (!confirm("Delete this smart contract record?")) return;

  const records = getSmartContracts().filter(item => item.id !== contractId);
  saveSmartContracts(records);
  renderSmartContracts();
};

window.deleteProject = async function(projectId) {
  if (isFinanceScope() || isOperationsScope()) {
    alert("Only admin/owner project access can delete project records.");
    return;
  }

  const project = getProjectById(projectId);

  if (!project) {
    alert("Project record was not found. Please refresh the Project Monitoring List.");
    return;
  }

  const label = [project.project_code, project.project_title].filter(Boolean).join(" - ") || "this project";
  if (!confirm(`Delete ${label}? This will remove the project from Project Monitoring.`)) return;

  deleteLocalProjectRelatedRecords(project);
  allProjects = allProjects.filter(item => {
    return String(item.id || "") !== String(project.id || "")
      && String(item.project_code || "").toLowerCase() !== String(project.project_code || "").toLowerCase();
  });
  renderSmartContracts();
  setNextProjectCode(allProjects);

  let cloudDeleteFailed = false;

  if (!isLocalProjectId(project.id)) {
    const childDeletes = [
      supabase.from("feedback").delete().eq("project_id", project.id),
      supabase.from("project_files").delete().eq("project_id", project.id)
    ];

    await Promise.all(childDeletes.map(async request => {
      const { error } = await request;
      if (error && !/does not exist|schema cache|column/i.test(error.message || "")) {
        cloudDeleteFailed = true;
      }
    }));

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", project.id);

    if (error) {
      cloudDeleteFailed = true;
      console.warn("Supabase project delete failed:", error.message || error);
    }
  }

  await loadProjects();
  alert(cloudDeleteFailed
    ? "Project deleted locally. Supabase delete did not finish, so please sync/check the cloud record."
    : "Project deleted successfully.");
};

// EDIT PROJECT
window.editProject = async function(id) {
  if (isFinanceScope()) {
    alert("Finance Officer / Accountant can review project cost and budget only.");
    return;
  }

  let project = getProjectById(id);

  if (!project && !isLocalProjectId(id)) {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    project = data;
  }

  if (!project) {
    alert("Project record was not found. Please refresh the Project Monitoring List.");
    return;
  }

  editingId = id;
  editingProjectCode = project.project_code || "";
  pendingProgressFiles = [];
  const progressInput = document.getElementById("progress_files");
  if (progressInput) progressInput.value = "";
  renderPendingProgressFiles();
   const addProjectSection = document.getElementById("addProjectSection");
   const projectListSection = document.getElementById("projectListSection");
   const editProjectSection = document.getElementById("editProjectSection");

   if (addProjectSection) addProjectSection.style.display = "none";
   if (projectListSection) projectListSection.style.display = "none";
  if (editProjectSection) editProjectSection.style.display = "block";

  const editQuotationType = document.getElementById("edit_quotation_type");
  if (editQuotationType) editQuotationType.value = getProjectQuotationType(project);
  const manpowerDetails = getManpowerQuotationDetails(project);
  const cctvDetails = getCctvQuotationDetails(project);
  edit_project_code.value = project.project_code || "";
  edit_project_title.value = project.project_title || "";
  edit_client_name.value = project.client_name || "";
  edit_client_contact_name.value = getProjectClientName(project) || "";
  edit_contact_number.value = project.contact_number || "";
  edit_location.value = project.location || "";
  edit_start_date.value = project.start_date || "";
  edit_target_completion.value = project.target_completion || "";
  edit_project_duration_days.value = manpowerDetails.durationDays || "";
  const editCctvDurationDays = document.getElementById("edit_cctv_duration_days");
  if (editCctvDurationDays) editCctvDurationDays.value = cctvDetails.durationDays || "";
  edit_completed_date.value = project.completed_date || "";
  edit_status.value = project.status || "Pending";
  edit_progress_percentage.value = getExplicitProjectProgress(project) || 0;
  const editManpowerProgress = document.getElementById("edit_manpower_progress_percentage");
  if (editManpowerProgress) editManpowerProgress.value = edit_progress_percentage.value;
  edit_project_budget.value = project.project_budget || 0;
  edit_contract_amount.value = project.contract_amount || 0;
  edit_down_payment.value = getProjectDownPayment(project);
  edit_tax_amount.value = project.tax_amount ?? "";
  edit_ppr_prepared_by.value = project.ppr_prepared_by || "";
  edit_ppr_noted_by.value = project.ppr_noted_by || "";
  edit_remarks.value = project.remarks || "";
  edit_manpower_client_name.value = getProjectClientName(project) || project.client_name || "";
  edit_manpower_client_contact.value = project.contact_number || "";
  edit_manpower_client_email.value = manpowerDetails.clientEmail || project.client_email || "";
  edit_manpower_location.value = project.location || "";
  edit_manpower_down_payment.value = getProjectDownPayment(project);
  edit_down_payment.value = edit_manpower_down_payment.value;
  const editManpowerStatus = document.getElementById("edit_manpower_status");
  if (editManpowerStatus) editManpowerStatus.value = project.status || "Pending";
  edit_manpower_prepared_by.value = manpowerDetails.preparedBy || project.ppr_prepared_by || "";
  edit_manpower_prepared_position.value = manpowerDetails.preparedPosition || "";
  edit_manpower_terms.value = manpowerDetails.terms || "";
  edit_manpower_work_description.value = manpowerDetails.workDescription || manpowerDetails.scope || project.project_title || "";
  edit_manpower_additional_comments.value = manpowerDetails.additionalComments || manpowerDetails.notes || "";
  const editManpowerItems = (manpowerDetails.items || []).length
    ? manpowerDetails.items
    : [{
        description: manpowerDetails.position || manpowerDetails.workDescription || project.project_title || "Manpower Services",
        qty: manpowerDetails.workers || 1,
        amount: Number(project.contract_amount || 0)
          || (Number(manpowerDetails.workers || 0) * Number(manpowerDetails.days || 0) * Number(manpowerDetails.rate || 0))
      }];
  resetEditManpowerQuotationItems(editManpowerItems);
  await setEditCctvMaterialOptions();
  if (getProjectQuotationType(project) === "cctv") {
    await loadEditCctvMaterials(project);
  } else {
    resetEditCctvMaterials();
  }
  toggleEditQuotationTypeView();

  await loadProgressFiles(id);

  document.getElementById("editProjectSection").scrollIntoView({
    behavior: "smooth"
  });
};

const editProjectForm = document.getElementById("editProjectForm");
document.getElementById("edit_quotation_type")?.addEventListener("change", toggleEditQuotationTypeView);
document.getElementById("edit_manpower_down_payment")?.addEventListener("input", event => {
  if (edit_down_payment) edit_down_payment.value = event.target.value;
});
document.getElementById("progress_files")?.addEventListener("change", event => {
  const selectedFiles = Array.from(event.target.files || []);
  if (!selectedFiles.length) return;
  pendingProgressFiles = [
    ...pendingProgressFiles,
    ...selectedFiles.map(file => ({ file, comment: "" }))
  ];
  event.target.value = "";
  renderPendingProgressFiles();
});
document.getElementById("edit_cctv_material_select")?.addEventListener("change", event => {
  applyEditCctvSelectedMaterial(event.target.value);
  event.target.value = "";
});

window.handleEditCctvMaterialSelect = function(select) {
  applyEditCctvSelectedMaterial(select?.value || "");
  if (select) select.value = "";
};

window.addEditCctvMaterialRow = function(item = {}) {
  document.getElementById("editCctvMaterialsBody")?.appendChild(createEditCctvMaterialRow(item));
};

window.removeEditCctvMaterialRow = function(button) {
  const row = button.closest("tr");
  const body = row?.closest("tbody");

  if (!row || !body) return;

  row.remove();

  if (!body.children.length) {
    body.appendChild(createEditCctvMaterialRow());
  }

  updateEditCctvMaterialsTotal();
};

if (editProjectForm) {
  editProjectForm.addEventListener("submit", async function(e) {
    e.preventDefault();

    if (!editingId) {
      alert("No project selected for update.");
      return;
    }

    const quotationType = document.getElementById("edit_quotation_type")?.value || "manpower";
    const isManpower = quotationType === "manpower";
    const isCctv = quotationType === "cctv";
    const quotationItems = isManpower
      ? getEditManpowerQuotationItems()
      : isCctv
      ? getEditCctvMaterials()
      : getQuotationItemsFromForm("editQuotationItemsBody");
    const manpowerAmount = quotationItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const currentProject = getProjectById(editingId) || {};
    const previousQuotationItems = Array.isArray(currentProject.quotation_items)
      ? currentProject.quotation_items
      : getLocalQuotationItems(editingId);
    const manpowerContractAmount = Number(manpowerAmount || currentProject.contract_amount || 0);
    const manpowerDownPaymentAmount = Math.max(Number(edit_manpower_down_payment.value || 0), 0);

    const record = {
      quotation_type: quotationType,
      project_code: edit_project_code.value || currentProject.project_code || "",
      project_title: isManpower
        ? (edit_manpower_work_description.value.trim() || quotationItems[0]?.description || edit_project_title.value || currentProject.project_title || "Manpower Quotation")
        : edit_project_title.value,
      client_name: isManpower ? (edit_manpower_client_name.value || currentProject.client_name || "") : edit_client_name.value,
      client_contact_name: isManpower ? (edit_manpower_client_name.value || currentProject.client_contact_name || currentProject.client_name || "") : edit_client_contact_name.value,
      contact_number: isManpower ? (edit_manpower_client_contact.value || currentProject.contact_number || "") : edit_contact_number.value,
      client_email: isManpower ? (edit_manpower_client_email.value || currentProject.client_email || "") : "",
      location: isManpower ? (edit_manpower_location.value || edit_location.value || currentProject.location || "") : (edit_location.value || currentProject.location || ""),
      start_date: isCctv ? null : (edit_start_date.value || currentProject.start_date || null),
      target_completion: isCctv ? null : (edit_target_completion.value || currentProject.target_completion || null),
      completed_date: edit_completed_date.value || currentProject.completed_date || null,
      status: isManpower
        ? (document.getElementById("edit_manpower_status")?.value || currentProject.status || "Pending")
        : (edit_status.value || currentProject.status || "Pending"),
      progress_percentage: getProjectProgressInputValue(isManpower
        ? document.getElementById("edit_manpower_progress_percentage")
        : edit_progress_percentage),
      project_budget: isManpower ? Number(manpowerAmount || edit_project_budget.value || currentProject.project_budget || 0) : Number(edit_project_budget.value || currentProject.project_budget || 0),
      contract_amount: isManpower ? manpowerContractAmount : Number(edit_contract_amount.value || currentProject.contract_amount || 0),
      down_payment: isManpower ? manpowerDownPaymentAmount : Number(edit_down_payment.value || currentProject.down_payment || 0),
      tax_amount: edit_tax_amount.value === "" ? null : Number(edit_tax_amount.value || 0),
      ppr_prepared_by: isManpower ? edit_manpower_prepared_by.value : edit_ppr_prepared_by.value,
      ppr_noted_by: isCctv ? "" : (edit_ppr_noted_by.value || currentProject.ppr_noted_by || ""),
      remarks: isManpower ? buildEditManpowerRemarks() : isCctv ? buildEditCctvRemarks(currentProject) : edit_remarks.value,
      quotation_items: quotationItems
    };

    let savedProject = null;

    if (isLocalProjectId(editingId)) {
      savedProject = updateLocalProjectMirror(editingId, record);
    } else {
      const { data, error } = await updateWithOptionalColumns(
        "projects",
        record,
        "id",
        editingId,
        ["completed_date", "client_email", "progress_percentage", "quotation_type", "quotation_items"],
        { returnRecord: true }
      );

      if (error) {
        alert("Supabase update failed: " + error.message + "\n\nPlease run supabase/cloud_required_schema.sql in Supabase SQL Editor, then try again.");
        return;
      }

      savedProject = { ...(data || getProjectById(editingId) || {}), ...record, id: editingId };
      saveLocalProjectMirror(savedProject);
    }

    saveLocalClientName(editingId, record.client_contact_name);
    saveLocalDownPayment(editingId, record.down_payment);
    if (isCctv) {
      await syncCctvInventoryUsage(previousQuotationItems, quotationItems);
    }
    saveLocalQuotationItems(editingId, quotationItems);
    let materialsOk = true;
    if (isCctv) {
      try {
        await saveEditCctvMaterials(record.project_code, editingProjectCode || record.project_code);
      } catch (materialError) {
        materialsOk = false;
        console.warn("CCTV materials were not saved:", materialError.message || materialError);
      }
    }

    const uploadOk = await uploadProgressFiles(editingId);

    if (savedProject) await saveProjectContract(savedProject);
    alert(materialsOk === false
      ? "Project updated successfully. CCTV materials were not saved because the inventory table is not ready."
      : uploadOk === false
      ? "Project updated successfully. Progress files were not uploaded because file storage or project_files table is not ready."
      : "Project updated successfully.");
    editingId = null;
    editingProjectCode = "";
    editProjectForm.reset();
    resetQuotationItems([], "editQuotationItemsBody");
    resetEditManpowerQuotationItems();
    resetEditCctvMaterials();
    const addProjectSection = document.getElementById("addProjectSection");
    const projectListSection = document.getElementById("projectListSection");
    const editProjectSection = document.getElementById("editProjectSection");

    if (editProjectSection) editProjectSection.style.display = "none";
    if (addProjectSection) addProjectSection.style.display = "block";
    if (projectListSection) projectListSection.style.display = "block";
    await loadProjects();
  });
}

// PRINT REPORT WITH LOGO
window.printProject = async function(id) {
  if (isOperationsScope()) {
    alert("Project Manager / Operations Staff can generate PPR only.");
    return;
  }

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    alert(error.message);
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
  alert("Please allow pop-ups for this website to print report.");
  return;
}

  const financialRows = isOperationsScope() ? "" : `
        <tr><td>Project Budget</td><td>${peso(project.project_budget)}</td></tr>
        <tr><td>Contract Amount</td><td>${peso(project.contract_amount)}</td></tr>
        <tr><td>Amount Paid</td><td>${peso(getProjectDownPayment(project))}</td></tr>
        <tr><td>Tax Percent</td><td>${optionalPercent(project.tax_amount)}</td></tr>
  `;

  printWindow.document.write(`
    <html>
    <head>
      <title>Project Report</title>
      <style>
        body{
          font-family:Arial, sans-serif;
          padding:35px;
          color:#0b1f35;
        }
        .header{
          text-align:center;
          border-bottom:2px solid #164f96;
          padding-bottom:15px;
          margin-bottom:25px;
        }
        .logo{
          width:190px;
          margin-bottom:10px;
        }
        h1{
          color:#164f96;
          margin:5px 0;
        }
        .company{
          font-weight:bold;
          font-size:14px;
        }
        table{
          width:100%;
          border-collapse:collapse;
          margin-top:20px;
        }
        td{
          border:1px solid #ccc;
          padding:10px;
          font-size:14px;
        }
        td:first-child{
          font-weight:bold;
          background:#f6f9fd;
          width:35%;
        }
      </style>
    </head>
    <body>

      <div class="header">
        <img src="assets/logo.jpg" class="logo">
        <h1>Project Monitoring Report</h1>
        <div class="company">LEMYU FIBER OPTIC INSTALLATION AND SERVICES</div>
      </div>

      <table>
        <tr><td>Project Code</td><td>${project.project_code || "-"}</td></tr>
        <tr><td>Project Title</td><td>${project.project_title || "-"}</td></tr>
        <tr><td>Company Name</td><td>${project.client_name || "-"}</td></tr>
        <tr><td>Client Name</td><td>${getProjectClientName(project) || "-"}</td></tr>
        <tr><td>Contact Number</td><td>${project.contact_number || "-"}</td></tr>
        <tr><td>Location</td><td>${project.location || "-"}</td></tr>
        <tr><td>Status</td><td>${project.status || "-"}</td></tr>
        ${financialRows}
        <tr><td>PPR Prepared By</td><td>${project.ppr_prepared_by || "-"}</td></tr>
        <tr><td>PPR Noted By</td><td>${project.ppr_noted_by || "-"}</td></tr>
        <tr><td>Remarks</td><td>${project.remarks || "-"}</td></tr>
      </table>

    </body>
    </html>
  `);

  printWindow.document.close();

  setTimeout(() => {
    printWindow.print();
  }, 500);
};

// GENERATE ERP-STYLE PROJECT PROGRESS REPORT
window.generatePPR = async function(id) {
  const project = await getProjectForAction(id, "PPR");
  if (!project) return;

  let feedbacks = [];
  let projectFiles = [];

  if (!isLocalProjectId(id)) {
    const [feedbackResult, filesResult] = await Promise.all([
      supabase.from("feedback").select("*").eq("project_id", id),
      supabase.from("project_files").select("*").eq("project_id", id).order("created_at", { ascending: false })
    ]);

    if (feedbackResult.error) console.warn("PPR feedback records could not be loaded.", feedbackResult.error);
    if (filesResult.error) console.warn("PPR project files could not be loaded.", filesResult.error);

    feedbacks = feedbackResult.data || [];
    projectFiles = filesResult.data || [];
  }

  const generatedDate = new Date();
  const generatedBy = getPprGeneratedBy();
  const pprConfig = getProjectPprConfig(project);
  const reportPeriod = getPprCoveragePeriod(project, pprConfig);
  const completionValue = getPprCompletionValue(project);
  const completionText = completionValue === null ? "Not Available" : `${completionValue}%`;
  const completionBar = completionValue === null ? 0 : completionValue;
  const contractAmount = Number(project.contract_amount || 0);
  const amountPaid = getProjectDownPayment(project);
  const photos = getPprPhotos(projectFiles);
  const photoPages = chunkPprPhotos(photos, 4);
  const scopeItems = getPprScopeItems(project);
  const hasFeedback = feedbacks.length > 0;
  const avgRating = hasFeedback
    ? (feedbacks.reduce((sum, f) => sum + Number(f.rating || f.overall_satisfaction || 0), 0) / feedbacks.length).toFixed(1)
    : "Not Available";
  const latestFeedback = feedbacks
    .slice()
    .sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0))[0];
  const { feedbackLink, qrUrl } = buildPprQrUrl(id);
  const pages = [];
  const pprFileName = `PPR_${String(project.project_code || "PROJECT").replace(/[^\w-]+/g, "_")}_${generatedDate.toISOString().slice(0, 10)}.pdf`;

  const pprWindow = window.open("", "_blank");
  if (!pprWindow) {
    alert("Please allow pop-ups to generate PPR.");
    return;
  }

  const infoRows = rows => rows
    .filter(row => row.value !== null && row.value !== undefined && row.value !== "")
    .map(row => `<div class="info-row"><span>${escapeProjectHtml(row.label)}</span><strong>${safePprText(row.value)}</strong></div>`)
    .join("");

  const progressBar = (value, label = "") => `
    <div class="progress-wrap" role="img" aria-label="${escapeProjectHtml(label || `Progress ${value}%`)}">
      <div class="progress-fill" style="width:${Math.min(Math.max(Number(value || 0), 0), 100)}%;"></div>
    </div>`;

  const statusBadge = value => `<span class="badge ${getPprStatusClass(value)}">${safePprText(value, "Not Available")}</span>`;

  pages.push(`
    <section class="ppr-page cover-page">
      <div class="cover-top">
        <div class="brand-lockup">
          <img src="${assetUrl("assets/logo.jpg")}" alt="LEMYU logo" onerror="this.style.display='none'">
          <div>
            <strong>LEMYU</strong>
            <span>Fiber Optic Installation and Services</span>
          </div>
        </div>
        <div class="finsight-mark">FinSight</div>
      </div>
      <div class="cover-main">
        <p class="eyebrow">CONFIDENTIAL PROJECT DOCUMENT</p>
        <h1>PROJECT PROGRESS REPORT</h1>
        <h2>${safePprText(project.project_title)}</h2>
        <div class="cover-meta">
          <div><span>Project Code</span><strong>${safePprText(project.project_code)}</strong></div>
          <div><span>Client</span><strong>${safePprText(project.client_name || getProjectClientName(project))}</strong></div>
          <div><span>Location</span><strong>${safePprText(project.location)}</strong></div>
        </div>
      </div>
      <div class="cover-footer-grid">
        <div><span>Report Period</span><strong>${safePprText(reportPeriod)}</strong></div>
        <div><span>Generated Date</span><strong>${escapeProjectHtml(generatedDate.toLocaleString("en-PH"))}</strong></div>
        <div><span>Generated By</span><strong>${safePprText(generatedBy)}</strong></div>
      </div>
      <p class="cover-system">Generated by FinSight - Cloud-Based Financial Management System with Business Intelligence Dashboard</p>
    </section>
  `);

  pages.push(`
    <section class="ppr-page">
      <header class="ppr-header"><img src="${assetUrl("assets/logo.jpg")}" alt="LEMYU logo" onerror="this.style.display='none'"><div><strong>FinSight</strong><span>Project Progress Report - ${safePprText(project.project_code)}</span></div></header>
      <h2>Executive Project Dashboard</h2>
      <div class="kpi-grid">
        <div class="kpi-card"><span>Overall Project Progress</span><strong>${completionText}</strong>${progressBar(completionBar)}</div>
        <div class="kpi-card"><span>Contract Amount</span><strong>${contractAmount ? peso(contractAmount) : "Not Available"}</strong></div>
        <div class="kpi-card"><span>Amount Paid</span><strong>${amountPaid ? peso(amountPaid) : "Not Available"}</strong></div>
        <div class="kpi-card"><span>Project Duration</span><strong>${safePprText(getProjectDurationText(project))}</strong></div>
      </div>
      <div class="section-card">
        <h3>Overall Progress</h3>
        <div class="progress-head"><strong>${completionText}</strong>${statusBadge(project.status)}</div>
        ${progressBar(completionBar)}
      </div>
      <div class="section-card">
        <h3>Executive Summary</h3>
        <p>${getPprSectionText(pprConfig.executiveSummary || project.remarks)}</p>
      </div>
    </section>
  `);

  pages.push(`
    <section class="ppr-page">
      <header class="ppr-header"><img src="${assetUrl("assets/logo.jpg")}" alt="LEMYU logo" onerror="this.style.display='none'"><div><strong>FinSight</strong><span>Project Progress Report - ${safePprText(project.project_code)}</span></div></header>
      <h2>Project Information and Scope</h2>
      <div class="two-col">
        <div class="section-card">
          <h3>Client Information</h3>
          ${infoRows([
            { label: "Client Name", value: getProjectClientName(project) || project.client_name },
            { label: "Company Name", value: project.client_name },
            { label: "Contact Number", value: project.contact_number },
            { label: "Email Address", value: project.client_email },
            { label: "Project Site Address", value: project.location }
          ])}
        </div>
        <div class="section-card">
          <h3>Project Information</h3>
          ${infoRows([
            { label: "Project Code", value: project.project_code },
            { label: "Project Name", value: project.project_title },
            { label: "Project Category", value: getProjectQuotationLabel(project) },
            { label: "Project Manager", value: project.ppr_prepared_by },
            { label: "Project Location", value: project.location },
            { label: "Status", value: project.status },
            { label: "Completion", value: completionText },
            { label: "Quotation No.", value: getQuotationNumber(project) },
            { label: "Contract No.", value: getContractNumber(project) }
          ])}
        </div>
      </div>
      <div class="section-card">
        <h3>Scope of Work</h3>
        ${scopeItems.length ? `<ul class="scope-list">${scopeItems.map(item => `<li>${escapeProjectHtml(item)}</li>`).join("")}</ul>` : `<p class="empty-text">No saved scope of work was recorded for this project.</p>`}
      </div>
      <div class="section-card">
        <h3>Important Dates</h3>
        ${infoRows([
          { label: "Project Creation Date", value: formatDate(project.created_at, "") },
          { label: "Start Date", value: formatDate(project.start_date, "") },
          { label: "Target Completion Date", value: formatDate(project.target_completion, "") },
          { label: "Actual Completion Date", value: formatDate(project.completed_date, "") },
          { label: "Report Date", value: generatedDate.toLocaleDateString("en-PH") }
        ]) || `<p class="empty-text">No project dates were recorded.</p>`}
      </div>
    </section>
  `);

  photoPages.forEach((photoChunk, pageIndex) => {
    pages.push(`
      <section class="ppr-page">
        <header class="ppr-header"><img src="${assetUrl("assets/logo.jpg")}" alt="LEMYU logo" onerror="this.style.display='none'"><div><strong>FinSight</strong><span>Project Progress Report - ${safePprText(project.project_code)}</span></div></header>
        <h2>PROJECT ACCOMPLISHMENT PHOTOGRAPHS</h2>
        ${
          photoChunk.length
            ? `<div class="photo-grid ${photoChunk.length === 1 ? "single-photo" : ""}">
                ${photoChunk.map((file, index) => {
                  const photoNumber = pageIndex * 4 + index + 1;
                  const photoComment = getPprPhotoDescription(file);
                  return `
                    <article class="photo-card">
                      <img src="${escapeProjectHtml(file.file_url)}" alt="${escapeProjectHtml(getPprPhotoTitle(file, photoNumber - 1))}" onerror="console.warn('Skipped broken PPR image:', this.src); this.closest('.photo-card').style.display='none';">
                      <div class="photo-caption">
                        <div><strong>PHOTO ${String(photoNumber).padStart(2, "0")}</strong></div>
                        <p><b>Comment:</b> ${escapeProjectHtml(photoComment || "No comment saved")}</p>
                      </div>
                    </article>
                  `;
                }).join("")}
              </div>`
            : `<div class="empty-state">No project accomplishment photographs have been uploaded for this reporting period.</div>`
        }
      </section>
    `);
  });

  pages.push(`
    <section class="ppr-page">
      <header class="ppr-header"><img src="${assetUrl("assets/logo.jpg")}" alt="LEMYU logo" onerror="this.style.display='none'"><div><strong>FinSight</strong><span>Project Progress Report - ${safePprText(project.project_code)}</span></div></header>
      <h2>Client Feedback and Approval</h2>
      <div class="feedback-qr-grid">
        <div class="section-card">
          <h3>Client Feedback</h3>
          <div class="feedback-summary">
            <div><span>Average Rating</span><strong>${avgRating}${hasFeedback ? "/5" : ""}</strong></div>
            <div><span>Responses</span><strong>${feedbacks.length}</strong></div>
            <div><span>Status</span><strong>${hasFeedback ? "Submitted" : "No Feedback"}</strong></div>
          </div>
          ${
            hasFeedback
              ? `<p><b>Latest Client Comment:</b> ${escapeProjectHtml(latestFeedback.comments || latestFeedback.recommendations || "No written remarks submitted.")}</p>`
              : `<p>No client feedback has been submitted for this project.</p>`
          }
        </div>
        <div class="qr-card">
          <img src="${qrUrl}" alt="Client feedback QR code">
          <strong>Scan the QR code to submit project feedback.</strong>
          <small>${escapeProjectHtml(feedbackLink)}</small>
        </div>
      </div>
      <div class="signature-grid">
        <div class="signature-block"><span>Prepared By</span><div class="line"></div><strong>MARK LYNDON LAWAS</strong><small>Owner / Operational Manager</small><small>Date: ____________________</small></div>
        <div class="signature-block"><span>Approved By</span><div class="line"></div><strong>&nbsp;</strong><small>Authorized Client Representative</small><small>Date: ____________________</small></div>
      </div>
    </section>
  `);

  const totalPages = pages.length;
  const numberedPages = pages.map((page, index) => page.replace("</section>", `
      <footer class="ppr-footer"><span>Generated by FinSight</span><span>${escapeProjectHtml(generatedDate.toLocaleString("en-PH"))}</span><span>Confidential</span><span>Page ${index + 1} of ${totalPages}</span></footer>
    </section>`)).join("");

  pprWindow.document.write(`
    <html>
    <head>
      <title>Project Progress Report</title>
      <style>
        @page{size:A4;margin:0;}
        *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
        body{margin:0;background:#e9eef3;color:#1F2937;font-family:Arial, Helvetica, sans-serif;}
        .print-view-actions{position:sticky;top:0;z-index:10;display:flex;justify-content:flex-end;gap:8px;padding:10px 18px;background:#fff;border-bottom:1px solid #DCE4EA;}
        .print-view-actions button{border:1px solid #12304A;border-radius:5px;background:#12304A;color:#fff;padding:8px 12px;font-weight:700;cursor:pointer;}
        .print-view-actions .secondary-print-action{background:#fff;color:#12304A;}
        .ppr-page{position:relative;width:210mm;min-height:297mm;margin:14px auto;padding:18mm 16mm 17mm;background:#fff;page-break-after:always;overflow:hidden;}
        .cover-page{display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(180deg,#FFFFFF 0%,#F4F7F9 100%);}
        .cover-top,.ppr-header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #DCE4EA;padding-bottom:10px;}
        .brand-lockup,.ppr-header>div{display:flex;align-items:center;gap:10px;}
        .brand-lockup img,.ppr-header img{width:44px;height:44px;object-fit:contain;}
        .brand-lockup strong,.ppr-header strong{display:block;color:#12304A;font-size:18px;letter-spacing:.04em;}
        .brand-lockup span,.ppr-header span{display:block;color:#64748B;font-size:10px;text-transform:uppercase;}
        .finsight-mark{color:#168C8C;font-weight:800;font-size:16px;}
        .cover-main{text-align:center;padding:24mm 0 12mm;}
        .eyebrow{color:#168C8C;font-size:10px;font-weight:800;letter-spacing:.16em;}
        h1{margin:8px 0;color:#12304A;font-size:30px;letter-spacing:.04em;}
        h2{margin:14px 0 12px;color:#12304A;font-size:19px;}
        h3{margin:0 0 8px;color:#12304A;font-size:12px;text-transform:uppercase;letter-spacing:.04em;}
        p{font-size:10px;line-height:1.45;margin:6px 0;white-space:pre-wrap;}
        .cover-meta,.cover-footer-grid,.kpi-grid,.two-col,.feedback-qr-grid,.signature-grid{display:grid;gap:10px;}
        .cover-meta{grid-template-columns:repeat(3,1fr);margin:20px 0;text-align:left;}
        .cover-meta div,.cover-footer-grid div,.kpi-card,.section-card,.qr-card,.empty-state{border:1px solid #DCE4EA;background:#F8FAFC;border-radius:7px;padding:12px;}
        .cover-meta span,.cover-footer-grid span,.kpi-card span,.feedback-summary span{display:block;color:#64748B;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;}
        .cover-meta strong,.cover-footer-grid strong,.kpi-card strong{display:block;margin-top:4px;color:#111827;font-size:13px;}
        .cover-system{text-align:center;color:#64748B;font-size:9px;}
        .ppr-header{margin-bottom:14px;}
        .kpi-grid{grid-template-columns:repeat(3,1fr);margin-bottom:12px;}
        .kpi-card{break-inside:avoid;min-height:72px;}
        .kpi-card strong{font-size:16px;}
        .progress-wrap{height:8px;background:#E2E8F0;border-radius:999px;margin-top:8px;overflow:hidden;}
        .progress-fill{height:100%;background:#168C8C;border-radius:999px;}
        .progress-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
        .badge{display:inline-block;border-radius:999px;padding:4px 8px;font-size:8px;font-weight:800;text-transform:uppercase;}
        .badge.success{background:#DCFCE7;color:#15803D;}.badge.warning{background:#FEF3C7;color:#D97706;}.badge.critical{background:#FEE2E2;color:#B91C1C;}.badge.active{background:#DDF7F5;color:#168C8C;}.badge.neutral{background:#E5E7EB;color:#4B5563;}
        .two-col{grid-template-columns:1fr 1fr;}
        .info-row{display:grid;grid-template-columns:42% 58%;gap:8px;border-top:1px solid #E5EDF4;padding:7px 0;font-size:9.5px;}
        .info-row:first-of-type{border-top:0;}
        .info-row span{color:#64748B;font-weight:700;}
        .info-row strong{font-weight:700;word-break:break-word;}
        .scope-list{margin:0;padding-left:18px;font-size:10px;line-height:1.5;}
        .section-subtitle,.empty-text,.disclaimer{color:#64748B;}
        .empty-state{text-align:center;color:#64748B;margin-top:20px;padding:24px;}
        .photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .photo-grid.single-photo{grid-template-columns:1fr;}
        .photo-card{border:1px solid #DCE4EA;border-radius:7px;background:#fff;overflow:hidden;break-inside:avoid;}
        .photo-card img{display:block;width:100%;height:122mm;object-fit:contain;background:#F4F7F9;border-bottom:1px solid #DCE4EA;}
        .photo-grid:not(.single-photo) .photo-card img{height:65mm;object-fit:cover;}
        .photo-caption{padding:9px;}
        .photo-caption>div{display:flex;justify-content:space-between;gap:8px;align-items:center;}
        .photo-caption h3{margin-top:6px;font-size:10px;text-transform:none;letter-spacing:0;}
        .photo-caption small{display:block;color:#64748B;font-size:8px;line-height:1.35;}
        .feedback-qr-grid{grid-template-columns:2fr 1fr;margin-top:12px;}
        .feedback-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;}
        .feedback-summary div{border:1px solid #DCE4EA;border-radius:6px;padding:8px;background:#fff;}
        .feedback-summary strong{font-size:14px;}
        .qr-card{text-align:center;}
        .qr-card img{width:150px;height:150px;display:block;margin:0 auto 8px;}
        .qr-card small{display:block;color:#64748B;font-size:7px;word-break:break-all;}
        .signature-grid{grid-template-columns:repeat(2,1fr);margin-top:18px;}
        .signature-block{break-inside:avoid;text-align:center;font-size:10px;}
        .signature-block span{display:block;color:#64748B;font-weight:800;text-transform:uppercase;font-size:8px;margin-bottom:22px;}
        .signature-block .line{border-top:1px solid #111827;margin:0 0 6px;}
        .signature-block strong,.signature-block small{display:block;margin:4px 0;}
        .ppr-footer{position:absolute;left:16mm;right:16mm;bottom:8mm;display:flex;justify-content:space-between;border-top:1px solid #DCE4EA;padding-top:5px;color:#64748B;font-size:8px;}
        @media print{body{background:#fff;}.print-view-actions{display:none!important;}.ppr-page{margin:0;box-shadow:none;page-break-after:always;}}
      </style>
    </head>
    <body>
      <div class="print-view-actions">
        <button type="button" class="secondary-print-action" onclick="if (window.opener && !window.opener.closed) { window.opener.focus(); } window.close();">Back to Project List</button>
        <button type="button" onclick="window.print()">Print / Save PDF</button>
      </div>
      ${numberedPages}
      <script>
        document.title = ${JSON.stringify(pprFileName)};
        window.addEventListener("load", function() {
          setTimeout(function() { window.print(); }, 1000);
        });
      <\/script>
    </body>
    </html>
  `);

  pprWindow.document.close();
};

async function uploadProgressFiles(projectId) {
  const progressInput = document.getElementById("progress_files");
  const files = pendingProgressFiles.length
    ? [...pendingProgressFiles]
    : Array.from(progressInput?.files || []).map(file => ({ file, comment: "" }));

  if (!files.length) return true;

  if (isLocalProjectId(projectId)) {
    alert("Progress file uploads are available after the project is synced to the database.");
    return false;
  }

  for (const entry of files) {
    const file = entry.file || entry;
    const comment = String(entry.comment || "").trim();
    let uploadedFile;

    try {
      uploadedFile = await uploadProjectFile(file, "progress-files", ["progress-files", "contracts"]);
    } catch (uploadError) {
      alert("Upload error: " + uploadError.message);
      return false;
    }

    const { error } = await supabase.from("project_files").insert([{
      project_id: projectId,
      file_name: file.name,
      file_url: uploadedFile.publicUrl,
      description: comment
    }]);

    if (error) {
      console.warn("Progress file record was not saved:", error.message || error);
      return false;
    }
  }

  pendingProgressFiles = [];
  if (progressInput) progressInput.value = "";
  renderPendingProgressFiles();
  return true;
}

function renderPendingProgressFiles() {
  const pendingBox = document.getElementById("progressPendingFiles");
  if (!pendingBox) return;

  pendingBox.innerHTML = pendingProgressFiles.length
    ? `
      <div class="file-row pending-file-row">
        <div class="file-info">
          <strong>Pending upload</strong>
          <span>${pendingProgressFiles.length} file${pendingProgressFiles.length === 1 ? "" : "s"} ready. Add comments, choose more files, or press Update Project.</span>
        </div>
      </div>
      ${pendingProgressFiles.map((entry, index) => {
        const file = entry.file || entry;
        return `
        <div class="file-row pending-file-row">
          <div class="file-info">
            <strong>${escapeProjectHtml(file.name || "Selected file")}</strong>
            <span>${file.type || "File"}${file.size ? ` - ${(file.size / 1024).toFixed(1)} KB` : ""}</span>
            <label class="inline-upload-comment">
              Photo Comment
              <textarea rows="2" placeholder="Comment shown in PPR for this photo" oninput="updatePendingProgressComment(${index}, this.value)">${escapeProjectHtml(entry.comment || "")}</textarea>
            </label>
          </div>
          <button type="button" class="danger-btn" onclick="removePendingProgressFile(${index})">Remove</button>
        </div>
      `;
      }).join("")}
    `
    : "";
}

window.updatePendingProgressComment = function(index, value) {
  if (!pendingProgressFiles[index]) return;
  pendingProgressFiles[index].comment = value;
};

window.removePendingProgressFile = function(index) {
  pendingProgressFiles.splice(index, 1);
  renderPendingProgressFiles();
};

async function loadProgressFiles(projectId) {
  if (isLocalProjectId(projectId)) {
    uploadedProgressFiles.innerHTML = `<p class="muted">Progress file uploads are available after this project is synced to the database.</p>`;
    return;
  }

  const { data: files = [] } = await supabase
    .from("project_files")
    .select("*")
    .eq("project_id", projectId)
    .order("uploaded_at", { ascending: false });

  uploadedProgressFiles.innerHTML = files.length
    ? files.map(file => `
        <div class="file-row">
          <div class="file-preview">
            ${
              isImageFile(file.file_name, file.file_url)
                ? `<img src="${file.file_url}" alt="${file.file_name || "Uploaded image"}">`
                : isPdfFile(file.file_name, file.file_url)
                  ? `<iframe src="${file.file_url}" title="${file.file_name || "Uploaded PDF"}"></iframe>`
                  : isVideoFile(file.file_name, file.file_url)
                    ? `<video src="${file.file_url}" controls></video>`
                    : `<div class="file-icon">FILE</div>`
            }
          </div>
          <div class="file-info">
            <strong>${file.file_name || "Uploaded file"}</strong>
            <span>${file.uploaded_at ? new Date(file.uploaded_at).toLocaleString() : ""}</span>
            <label class="inline-upload-comment">
              Photo Comment
              <textarea id="progress_file_comment_${file.id}" rows="2" placeholder="Comment shown in PPR for this photo">${escapeProjectHtml(file.description || "")}</textarea>
            </label>
            <button type="button" onclick="updateProgressFileComment('${file.id}')">Save Comment</button>
          </div>
          <button type="button" class="danger-btn" onclick="deleteProgressFile('${file.id}')">Delete</button>
        </div>
      `).join("")
    : `<p class="muted">No uploaded progress files yet.</p>`;
}

window.updateProgressFileComment = async function(fileId) {
  const input = document.getElementById(`progress_file_comment_${fileId}`);
  const description = input?.value || "";
  const { error } = await supabase
    .from("project_files")
    .update({ description, updated_at: new Date().toISOString() })
    .eq("id", fileId);

  if (error) {
    alert("Photo comment was not saved: " + error.message);
    return;
  }

  alert("Photo comment saved.");
  if (editingId) await loadProgressFiles(editingId);
};

window.deleteProgressFile = async function(fileId) {
  if (isFinanceScope()) {
    alert("Finance Officer / Accountant cannot delete project files.");
    return;
  }

  if (!confirm("Delete this uploaded file?")) return;

  const { data: file, error: fileError } = await supabase
    .from("project_files")
    .select("*")
    .eq("id", fileId)
    .single();

  if (fileError) {
    alert("File lookup error: " + fileError.message);
    return;
  }

  const storageReference = getStorageReferenceFromUrl(file.file_url || "");

  if (storageReference) {
    const { error: storageError } = await supabase.storage
      .from(storageReference.bucket)
      .remove([storageReference.path]);

    if (storageError) {
      alert("File delete error: " + storageError.message);
      return;
    }
  }

  const { error } = await supabase
    .from("project_files")
    .delete()
    .eq("id", fileId);

  if (error) {
    alert("Delete error: " + error.message);
    return;
  }

  await loadProgressFiles(editingId);
};
window.showProjectQR = function(projectId) {
  const feedbackLink = `${window.location.origin}${window.location.pathname.replace("projects.html", "public-feedback.html")}?project_id=${projectId}`;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(feedbackLink)}`;

  const qrWindow = window.open("", "_blank");

  qrWindow.document.write(`
    <html>
    <head>
      <title>Project Feedback QR</title>
      <style>
        body{
          font-family:Arial;
          text-align:center;
          padding:40px;
          color:#0b1f35;
        }
        img{
          width:220px;
          height:220px;
          margin:20px 0;
        }
        h1{
          color:#1557a6;
        }
      </style>
    </head>
    <body>
      <h1>Client Feedback QR</h1>
      <p>Scan this QR code to submit feedback for this project.</p>
      <img src="${qrUrl}">
      <p>${feedbackLink}</p>
    </body>
    </html>
  `);

  qrWindow.document.close();
};

window.goToProjectPage = function(page) {
  const totalPages = Math.max(1, Math.ceil(getFilteredProjects().length / PROJECT_PAGE_SIZE));
  projectCurrentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  saveProjectListState();
  renderProjectList();
};

function bindProjectListFilters() {
  const controls = [
    ["projectSearch", "search"],
    ["projectStatusFilter", "status"],
    ["projectDateFilter", "date"],
    ["projectTypeFilter", "type"],
    ["projectSort", "sort"]
  ];

  controls.forEach(([id, stateKey]) => {
    const element = document.getElementById(id);
    if (!element) return;

    const eventName = element.type === "search" ? "input" : "change";
    element.addEventListener(eventName, event => {
      projectListState[stateKey] = event.target.value || (stateKey === "search" ? "" : "all");
      projectCurrentPage = 1;
      saveProjectListState();
      renderProjectList();
    });
  });
}

// INITIAL LOAD
applyFinanceProjectScope();
applyOperationsProjectScope();
bindProjectListFilters();
restoreProjectListState();
resetQuotationItems();
loadProjects();
