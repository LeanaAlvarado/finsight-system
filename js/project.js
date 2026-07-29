import { supabase, peso, escapeHtml, updateWithOptionalColumns } from "./supabase.js";

const form = document.getElementById("projectForm");
const tbody = document.getElementById("projectTable");

let editingId = null;
let editingProjectCode = "";
let allProjects = [];
let activeSmartContract = null;
let projectCurrentPage = 1;
const PROJECT_UPLOAD_BUCKETS = ["contracts", "progress-files"];
const MARK_SIGNATURE_IMAGE = "assets/mark-lyndon-lawas-signature.jpg";
const LOCAL_PROJECTS_KEY = "lemyu_saved_projects";
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

function evaluateSmartContract(project, financials = getProjectFinancials(project)) {
  const balanceDue = Math.max(financials.contract - financials.downPayment, 0);
  const totalCost = financials.budget + financials.tax + financials.expenses;
  const projectedProfit = financials.contract - totalCost;
  const status = String(project.status || "Pending");
  const targetDate = project.target_completion ? new Date(project.target_completion) : null;
  const isDelayed = targetDate && status !== "Completed" && targetDate < new Date();
  const missingFields = [];

  if (!project.project_title) missingFields.push("Project Title");
  if (!project.client_name) missingFields.push("Company Name");
  if (!project.contact_number) missingFields.push("Contact Number");
  if (!project.contract_amount) missingFields.push("Contract Amount");
  if (!project.target_completion) missingFields.push("Target Completion");

  const paymentState = financials.downPayment <= 0
    ? "No down payment recorded"
    : balanceDue > 0
      ? "Partial payment"
      : "Fully paid";

  const rules = [
    {
      name: "Required Details",
      result: missingFields.length ? `Missing: ${missingFields.join(", ")}` : "Complete",
      passed: !missingFields.length
    },
    {
      name: "Payment Rule",
      result: `${paymentState}; balance due is ${peso(balanceDue)}`,
      passed: financials.downPayment > 0
    },
    {
      name: "Project Status Rule",
      result: status === "Completed" ? "Ready for final acceptance review" : `Current status: ${status}`,
      passed: status === "Completed"
    },
    {
      name: "Schedule Rule",
      result: isDelayed ? "Target completion has passed" : "No schedule delay detected",
      passed: !isDelayed
    },
    {
      name: "Profit Rule",
      result: projectedProfit >= 0 ? `Projected profit: ${peso(projectedProfit)}` : `Projected loss: ${peso(projectedProfit)}`,
      passed: projectedProfit >= 0
    }
  ];

  const failedRules = rules.filter(rule => !rule.passed).length;

  return {
    balanceDue,
    totalCost,
    projectedProfit,
    paymentState,
    missingFields,
    rules,
    smartStatus: failedRules === 0
      ? "Approved for Completion Review"
      : failedRules <= 2
        ? "For Monitoring"
        : "Action Required"
  };
}

function buildSmartContractText(contract) {
  return `
PROJECT SERVICE AGREEMENT

Contract ID: ${contract.id}
Status: ${contract.status}
Created: ${contract.created_at}

Project Code: ${contract.project_code}
Project Title: ${contract.project_title}
Company Name: ${contract.client_name}
Client Name: ${contract.client_contact_name || "-"}
Contact Number: ${contract.contact_number}
Location: ${contract.location}
Start Date: ${contract.start_date || "Not specified"}
Target Completion: ${contract.target_completion || "Not specified"}
Contract Amount: ${contract.contract_amount}
Down Payment: ${contract.down_payment}
Balance Due: ${contract.balance_due}
Projected Profit: ${contract.projected_profit}
Status: ${contract.project_status}
Smart Contract Status: ${contract.smart_status}
Remarks: ${contract.remarks || "No remarks."}

Agreement Terms:
1. The client and LEMYU Fiber Optic Installation and Services agree to the project scope, location, schedule, and financial terms stated in this agreement.
2. Project completion, payment review, and acceptance will be based on the saved project status and supporting documents in the Project Monitoring module.
3. Any change in project scope, contract amount, target completion date, or special remarks must be documented and approved by both parties.
4. This contract draft is generated from the official project record and is intended for internal review, printing, and client confirmation.

Monolithic Smart Contract Rules:
${contract.rules.map((rule, index) => `${index + 1}. ${rule.name}: ${rule.result}`).join("\n")}
  `.trim();
}

function buildProjectContractRecord(project, existingRecord = null, financials = getProjectFinancials(project)) {
  const smartEvaluation = evaluateSmartContract(project, financials);
  const record = {
    id: existingRecord?.id || createContractId(),
    project_id: project.id,
    project_code: project.project_code || "-",
    project_title: project.project_title || "-",
    client_name: project.client_name || "-",
    client_contact_name: getProjectClientName(project) || "-",
    contact_number: project.contact_number || "-",
    location: project.location || "-",
    start_date: project.start_date || "",
    target_completion: project.target_completion || "",
    contract_amount: peso(project.contract_amount || 0),
    down_payment: peso(getProjectDownPayment(project)),
    balance_due: peso(smartEvaluation.balanceDue),
    total_cost: peso(smartEvaluation.totalCost),
    projected_profit: peso(smartEvaluation.projectedProfit),
    project_status: project.status || "Pending",
    smart_status: smartEvaluation.smartStatus,
    payment_state: smartEvaluation.paymentState,
    rules: smartEvaluation.rules,
    remarks: project.remarks || "",
    company_logo_url: getContractLogo(project),
    status: "Draft",
    created_at: existingRecord?.created_at || new Date().toLocaleString()
  };

  record.contract_text = buildSmartContractText(record);
  return record;
}

function saveProjectContract(project, financials) {
  if (!project?.id) return null;

  const records = getSmartContracts();
  const existingIndex = records.findIndex(item => item.project_id == project.id);
  const existingRecord = existingIndex >= 0 ? records[existingIndex] : null;
  const contractRecord = buildProjectContractRecord(project, existingRecord, financials);

  if (existingIndex >= 0) {
    records[existingIndex] = contractRecord;
  } else {
    records.unshift(contractRecord);
  }

  saveSmartContracts(records);
  renderSmartContracts();
  return contractRecord;
}

function syncProjectContracts(projects, expenses = []) {
  const records = getSmartContracts();
  const syncedRecords = [...records];

  projects.forEach(project => {
    if (!project?.id) return;

    const existingIndex = syncedRecords.findIndex(item => item.project_id == project.id);
    const existingRecord = existingIndex >= 0 ? syncedRecords[existingIndex] : null;
    const contractRecord = buildProjectContractRecord(project, existingRecord, getProjectFinancials(project, expenses));

    if (existingIndex >= 0) {
      syncedRecords[existingIndex] = contractRecord;
    } else {
      syncedRecords.unshift(contractRecord);
    }
  });

  saveSmartContracts(syncedRecords);
}

function renderSmartContracts() {
  const table = document.getElementById("smartContractTable");

  if (!table) return;

  const records = getSmartContracts();

  if (!records.length) {
    table.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;">No project contract records yet.</td>
      </tr>
    `;
    return;
  }

  table.innerHTML = records.map(record => `
    <tr>
      <td>${record.id}</td>
      <td>${record.project_title || "-"}</td>
      <td>${record.client_name || "-"}</td>
      <td>${record.contract_amount || "PHP 0.00"}</td>
      <td>${record.project_code || "-"}</td>
      <td><span class="badge Pending">${record.status}</span></td>
      <td>${record.created_at}</td>
      <td class="action-links">
        <a href="#" onclick="viewSmartContract('${record.id}')">View</a>
        <a href="#" onclick="deleteSmartContract('${record.id}')">Delete</a>
      </td>
    </tr>
  `).join("");
}

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
      ? `<a href="#" onclick="generatePPR('${project.id}')">Generate PPR</a>`
      : isFinanceScope()
      ? `<a href="#" onclick="viewProject('${project.id}')">View Costing</a>`
      : `
          <a href="#" onclick="viewProject('${project.id}')">View</a>
          <a href="#" onclick="editProject('${project.id}')">Edit</a>
          <a href="#" onclick="generateProjectQuotation('${project.id}')">${escapeHtml(quotationLabel)}</a>
          <a href="#" onclick="generatePPR('${project.id}')">Generate PPR</a>
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

  syncProjectContracts(allProjects, expenses);
  renderSmartContracts();
  renderProjectList();
}

window.addEventListener("storage", event => {
  if (event.key === LOCAL_PROJECTS_KEY) {
    loadProjects();
  }
});
window.addEventListener("lemyu:data-sync-complete", loadProjects);

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
      ["quotation_items", "contract_file_url", "contract_file_name"],
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
  saveProjectContract(result.data);

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

// VIEW FULL PROJECT DETAILS
window.viewProject = async function(id) {
  const project = await getProjectForAction(id, "Project");

  if (!project) {
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
        <div class="detail-item"><small>Down Payment</small><strong>${peso(financials.downPayment)}</strong></div>
        <div class="detail-item"><small>Tax Amount</small><strong>${peso(financials.tax)}</strong></div>
        <div class="detail-item"><small>Total Expenses</small><strong>${peso(financials.expenses)}</strong></div>
        <div class="detail-item"><small>Balance Due</small><strong>${peso(Math.max(financials.contract - financials.downPayment, 0))}</strong></div>
        <div class="detail-item"><small>Projected Profit</small><strong>${peso(profit)}</strong></div>
      </div>
    `;
    viewModal.style.display = "flex";
    return;
  }

  return window.generateProjectQuotation(id, { print: false });

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
    viewModal.style.display = "flex";
    return;
  }

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

      <div class="detail-item"><small>Project Budget</small><strong>${peso(project.project_budget)}</strong></div>
      <div class="detail-item"><small>Contract Amount</small><strong>${peso(project.contract_amount)}</strong></div>
      <div class="detail-item"><small>Down Payment</small><strong>${peso(getProjectDownPayment(project))}</strong></div>

      <div class="detail-item"><small>Tax Percent</small><strong>${optionalPercent(project.tax_amount)}</strong></div>
      <div class="detail-item"><small>PPR Prepared By</small><strong>${project.ppr_prepared_by || "-"}</strong></div>

      <div class="detail-item"><small>PPR Noted By</small><strong>${project.ppr_noted_by || "-"}</strong></div>

      <div class="detail-item">
        <small>Uploaded File</small>
        ${
          project.contract_file_url
            ? `<a href="${project.contract_file_url}" target="_blank">Open File</a>`
            : `<strong>No uploaded file</strong>`
        }
      </div>

      <div class="detail-item full-row">
        <small>Remarks</small>
        <strong>${project.remarks || "-"}</strong>
      </div>
    </div>
  `;

  viewModal.style.display = "flex";
};

window.closeViewModal = function() {
  viewModal.style.display = "none";
};

async function getOrCreateProjectContract(projectId) {
  const project = await getProjectForAction(projectId, "Contract");

  if (!project) return null;

  const { data: expenses = [] } = await supabase
    .from("expenses")
    .select("*")
    .eq("project_id", projectId);

  return saveProjectContract(project, getProjectFinancials(project, expenses));
}

window.viewProjectContract = async function(projectId) {
  const record = await getOrCreateProjectContract(projectId);

  if (!record) return;

  viewSmartContract(record.id);
};

window.printProjectContract = async function(projectId) {
  const record = await getOrCreateProjectContract(projectId);

  if (!record) return;

  activeSmartContract = record;
  printSmartContract();
};

window.viewSmartContract = function(contractId) {
  const record = getSmartContracts().find(item => item.id === contractId);

  if (!record) {
    alert("Smart contract record not found.");
    return;
  }

  activeSmartContract = record;
  const internalReviewHtml = canViewInternalContractReview()
    ? `
      <div class="details-grid">
        <div class="detail-item"><small>Projected Profit</small><strong>${record.projected_profit || "PHP 0.00"}</strong></div>
        <div class="detail-item"><small>Smart Contract Status</small><strong>${record.smart_status || "For Monitoring"}</strong></div>
      </div>

      <div class="contract-clause internal-only">
        <h3>Internal Smart Contract Review</h3>
        <p class="muted">Visible for admin, owner, and HR review only. This section is not included in the printed client contract.</p>
        <table class="smart-rules-table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Result</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${(record.rules || []).map(rule => `
              <tr>
                <td>${rule.name}</td>
                <td>${rule.result}</td>
                <td><span class="${rule.passed ? "good" : "bad"}">${rule.passed ? "Passed" : "Needs Action"}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `
    : "";

  smartContractContent.innerHTML = `
    <div class="contract-preview">
      <div class="contract-brand-row">
        <img src="assets/logo.jpg" alt="LEMYU Logo">
        <img src="${record.company_logo_url || assetUrl("assets/logo.jpg")}" alt="Client Logo">
      </div>

      <div class="contract-title-block">
        <h2>Project Service Agreement</h2>
        <p>Contract ID: ${record.id} | Status: ${record.status} | Created: ${record.created_at}</p>
      </div>

      <div class="details-grid">
        <div class="detail-item"><small>Project Code</small><strong>${record.project_code || "-"}</strong></div>
        <div class="detail-item"><small>Project Title</small><strong>${record.project_title || "-"}</strong></div>
        <div class="detail-item"><small>Company Name</small><strong>${record.client_name || "-"}</strong></div>
        <div class="detail-item"><small>Client Name</small><strong>${record.client_contact_name || "-"}</strong></div>
        <div class="detail-item"><small>Location</small><strong>${record.location || "-"}</strong></div>
        <div class="detail-item"><small>Contact Number</small><strong>${record.contact_number || "-"}</strong></div>
        <div class="detail-item"><small>Start Date</small><strong>${record.start_date || "Not specified"}</strong></div>
        <div class="detail-item"><small>Target Completion</small><strong>${record.target_completion || "Not specified"}</strong></div>
        <div class="detail-item"><small>Contract Amount</small><strong>${record.contract_amount}</strong></div>
        <div class="detail-item"><small>Down Payment</small><strong>${record.down_payment || "PHP 0.00"}</strong></div>
        <div class="detail-item"><small>Balance Due</small><strong>${record.balance_due || "PHP 0.00"}</strong></div>
      </div>

      ${internalReviewHtml}

      <div class="contract-clause">
        <h3>Agreement Terms</h3>
        <p>The client and LEMYU Fiber Optic Installation and Services agree to the project scope, location, schedule, and financial terms stated in this agreement.</p>
        <p>Project completion, payment review, and acceptance will be based on the saved project status and supporting documents in the Project Monitoring module.</p>
        <p>Any change in project scope, contract amount, target completion date, or special remarks must be documented and approved by both parties.</p>
      </div>

      <div class="contract-clause">
        <h3>Remarks / Scope Notes</h3>
        <p>${record.remarks || "No additional remarks."}</p>
      </div>

      <div class="contract-signatures">
        <div class="contract-signature">
          ${markSignatureSvg()}
          <div class="signature-line"></div>
          <strong>Mark Lyndon Lawas</strong>
          <span>Operation Manager</span>
        </div>
        <div class="contract-signature">
          <div class="signature-placeholder"></div>
          <div class="signature-line"></div>
          <strong>${record.client_contact_name || "Client Representative"}</strong>
          <span>Client / Conforme</span>
        </div>
      </div>
    </div>
  `;
  smartContractModal.style.display = "flex";
};

window.closeSmartContractModal = function() {
  smartContractModal.style.display = "none";
};

window.printSmartContract = function() {
  if (!activeSmartContract) return;

  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    alert("Please allow pop-ups to print smart contract.");
    return;
  }

  printWindow.document.write(`
    <html>
    <head>
      <title>${activeSmartContract.id}</title>
      <style>
        @page{size:A4;margin:14mm;}
        *{box-sizing:border-box;}
        body{
          font-family:Arial,sans-serif;
          color:#17212b;
          line-height:1.38;
          font-size:12px;
          margin:0;
        }
        .brand-row{
          display:flex;
          justify-content:space-between;
          align-items:center;
          border-bottom:3px solid #0b5d66;
          padding-bottom:10px;
          margin-bottom:14px;
        }
        .brand-row img{
          max-width:230px;
          max-height:74px;
          object-fit:contain;
        }
        h1{
          text-align:center;
          color:#0b5d66;
          text-transform:uppercase;
          letter-spacing:.08em;
          margin:10px 0 4px;
          font-size:22px;
        }
        .meta{
          text-align:center;
          color:#52616f;
          margin-bottom:14px;
        }
        table{
          width:100%;
          border-collapse:collapse;
          margin:10px 0 14px;
        }
        td{
          border:1px solid #b9c6d2;
          padding:7px 8px;
          vertical-align:top;
        }
        td:first-child{
          width:28%;
          font-weight:bold;
          background:#f6fafb;
        }
        h2{
          color:#0b5d66;
          font-size:14px;
          margin:14px 0 6px;
          text-transform:uppercase;
        }
        .clause{
          border:1px solid #b9c6d2;
          padding:10px 12px;
          margin-bottom:10px;
        }
        .clause p{
          margin:5px 0;
        }
        .signatures{
          display:flex;
          justify-content:space-between;
          gap:60px;
          margin-top:56px;
        }
        .sig{
          flex:1;
          text-align:center;
        }
        .signature-line{
          border-top:1px solid #111;
          margin:0 0 7px;
        }
        .signature-placeholder{
          height:42px;
        }
        .signature-svg{
          display:block;
          width:115px;
          height:42px;
          margin:0 auto 3px;
        }
      </style>
    </head>
    <body>
      <div class="brand-row">
        <img src="${assetUrl("assets/logo.jpg")}">
        <img src="${activeSmartContract.company_logo_url || assetUrl("assets/logo.jpg")}">
      </div>

      <h1>Project Service Agreement</h1>
      <div class="meta">
        Contract ID: ${activeSmartContract.id} | Status: ${activeSmartContract.status} | Created: ${activeSmartContract.created_at}
      </div>

      <table>
        <tr><td>Project Code</td><td>${activeSmartContract.project_code || "-"}</td></tr>
        <tr><td>Project Title</td><td>${activeSmartContract.project_title || "-"}</td></tr>
        <tr><td>Company Name</td><td>${activeSmartContract.client_name || "-"}</td></tr>
        <tr><td>Client Name</td><td>${activeSmartContract.client_contact_name || "-"}</td></tr>
        <tr><td>Contact Number</td><td>${activeSmartContract.contact_number || "-"}</td></tr>
        <tr><td>Location</td><td>${activeSmartContract.location || "-"}</td></tr>
        <tr><td>Start Date</td><td>${activeSmartContract.start_date || "Not specified"}</td></tr>
        <tr><td>Target Completion</td><td>${activeSmartContract.target_completion || "Not specified"}</td></tr>
        <tr><td>Contract Amount</td><td>${activeSmartContract.contract_amount}</td></tr>
        <tr><td>Down Payment</td><td>${activeSmartContract.down_payment || "PHP 0.00"}</td></tr>
        <tr><td>Balance Due</td><td>${activeSmartContract.balance_due || "PHP 0.00"}</td></tr>
      </table>

      <h2>Agreement Terms</h2>
      <div class="clause">
        <p>1. The client and LEMYU Fiber Optic Installation and Services agree to the project scope, location, schedule, and financial terms stated in this agreement.</p>
        <p>2. Project completion, payment review, and acceptance will be based on the saved project status and supporting documents in the Project Monitoring module.</p>
        <p>3. Any change in project scope, contract amount, target completion date, or special remarks must be documented and approved by both parties.</p>
        <p>4. This agreement is generated from the official project record and is intended for review, printing, and client confirmation.</p>
      </div>

      <h2>Remarks / Scope Notes</h2>
      <div class="clause">
        <p>${activeSmartContract.remarks || "No additional remarks."}</p>
      </div>

      <div class="signatures">
        <div class="sig">
          ${markSignatureSvg()}
          <div class="signature-line"></div>
          Mark Lyndon Lawas<br>
          Operation Manager
        </div>
        <div class="sig">
          <div class="signature-placeholder"></div>
          <div class="signature-line"></div>
          ${activeSmartContract.client_contact_name || activeSmartContract.client_name || "Client Representative"}<br>
          Client / Conforme
        </div>
      </div>
    </body>
    </html>
  `);

  printWindow.document.close();
  setTimeout(() => printWindow.print(), 500);
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
  "edit_start_date",
  "edit_target_completion",
  "edit_completed_date",
  "edit_status",
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
    edit_manpower_down_payment.value ? `Down Payment Percent: ${edit_manpower_down_payment.value}%` : "",
    edit_manpower_prepared_by.value ? `Prepared By: ${edit_manpower_prepared_by.value}` : "",
    edit_manpower_prepared_position.value ? `Position: ${edit_manpower_prepared_position.value}` : "",
    edit_manpower_terms.value ? `Terms of Service: ${edit_manpower_terms.value}` : "",
    edit_manpower_work_description.value ? `Work Description: ${edit_manpower_work_description.value}` : "",
    edit_manpower_additional_comments.value ? `Additional Comments: ${edit_manpower_additional_comments.value}` : ""
  ].filter(Boolean);

  return lines.join("\n");
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
        }
        .prepared{
          margin-top:34px;
          width:360px;
          min-height:0;
          font-size:15px;
          text-transform:uppercase;
        }
        .prepared-line{
          border-top:1px solid #111;
          width:330px;
          margin:2px 0 6px 0;
          padding-top:6px;
          margin-bottom:6px;
        }
        .prepared-label,
        .prepared-name,
        .prepared-position{
          font-weight:normal;
        }
        .prepared-signature{
          width:245px;
          height:78px;
          margin:0 0 0 42px;
          opacity:1;
        }
        .prepared-signature .signature-svg{
          width:100%;
          height:100%;
          object-fit:contain;
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
        }
      </style>
    </head>
    <body>
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
        <div class="prepared-line">
          <span class="prepared-label">Prepared By: </span>
          <span class="prepared-name">${escapeProjectHtml(manpower.preparedBy || project.ppr_prepared_by || "-")}</span>
        </div>
        <div class="prepared-position">${escapeProjectHtml(manpower.preparedPosition || "Position")}</div>
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
      </style>
    </head>
    <body>
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
   const addProjectSection = document.getElementById("addProjectSection");
   const projectListSection = document.getElementById("projectListSection");
   const editProjectSection = document.getElementById("editProjectSection");

   if (addProjectSection) addProjectSection.style.display = "none";
   if (projectListSection) projectListSection.style.display = "none";
  if (editProjectSection) editProjectSection.style.display = "block";

  const editQuotationType = document.getElementById("edit_quotation_type");
  if (editQuotationType) editQuotationType.value = getProjectQuotationType(project);
  const manpowerDetails = getManpowerQuotationDetails(project);
  edit_project_code.value = project.project_code || "";
  edit_project_title.value = project.project_title || "";
  edit_client_name.value = project.client_name || "";
  edit_client_contact_name.value = getProjectClientName(project) || "";
  edit_contact_number.value = project.contact_number || "";
  edit_location.value = project.location || "";
  edit_start_date.value = project.start_date || "";
  edit_target_completion.value = project.target_completion || "";
  edit_completed_date.value = project.completed_date || "";
  edit_status.value = project.status || "Pending";
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
  edit_manpower_down_payment.value = getPercentFromAmount(getProjectDownPayment(project), project.contract_amount).toFixed(2);
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
    const manpowerDownPaymentPercent = Math.min(Math.max(Number(edit_manpower_down_payment.value || 0), 0), 100);
    const manpowerDownPaymentAmount = manpowerContractAmount * (manpowerDownPaymentPercent / 100);

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
      location: edit_location.value || currentProject.location || "",
      start_date: edit_start_date.value || currentProject.start_date || null,
      target_completion: edit_target_completion.value || currentProject.target_completion || null,
      completed_date: edit_completed_date.value || currentProject.completed_date || null,
      status: isManpower
        ? (document.getElementById("edit_manpower_status")?.value || currentProject.status || "Pending")
        : (edit_status.value || currentProject.status || "Pending"),
      project_budget: isManpower ? Number(manpowerAmount || edit_project_budget.value || currentProject.project_budget || 0) : Number(edit_project_budget.value || currentProject.project_budget || 0),
      contract_amount: isManpower ? manpowerContractAmount : Number(edit_contract_amount.value || currentProject.contract_amount || 0),
      down_payment: isManpower ? manpowerDownPaymentAmount : Number(edit_down_payment.value || currentProject.down_payment || 0),
      tax_amount: edit_tax_amount.value === "" ? null : Number(edit_tax_amount.value || 0),
      ppr_prepared_by: isManpower ? edit_manpower_prepared_by.value : edit_ppr_prepared_by.value,
      ppr_noted_by: edit_ppr_noted_by.value || currentProject.ppr_noted_by || "",
      remarks: isManpower ? buildEditManpowerRemarks() : edit_remarks.value,
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
        ["completed_date", "client_email", "quotation_type", "quotation_items"],
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

    if (savedProject) saveProjectContract(savedProject);
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
        <tr><td>Down Payment</td><td>${peso(getProjectDownPayment(project))}</td></tr>
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

// GENERATE PPR WITH LOGO
window.generatePPR = async function(id) {
  const project = await getProjectForAction(id, "PPR");

  if (!project) {
    return;
  }

  let feedbacks = [];
  let projectFiles = [];

  if (!isLocalProjectId(id)) {
    const feedbackResult = await supabase
      .from("feedback")
      .select("*")
      .eq("project_id", id);

    feedbacks = feedbackResult.data || [];

    const filesResult = await supabase
      .from("project_files")
      .select("*")
      .eq("project_id", id)
      .order("uploaded_at", { ascending: false });

    projectFiles = filesResult.data || [];
  }

  const uploadedFiles = [];

  if (project.contract_file_url) {
    uploadedFiles.push({
      file_name: project.contract_file_name || "Uploaded project file",
      file_url: project.contract_file_url,
      uploaded_at: null
    });
  }

  projectFiles.forEach(file => {
    uploadedFiles.push({
      file_name: file.file_name || "Uploaded file",
      file_url: file.file_url,
      uploaded_at: file.uploaded_at || null
    });
  });

  const hasFeedback = feedbacks.length > 0;

  const avgRating = hasFeedback
    ? (
        feedbacks.reduce((sum, f) => {
          return sum + Number(f.rating || f.overall_satisfaction || 0);
        }, 0) / feedbacks.length
      ).toFixed(1)
    : "No feedback yet";

  const feedbackLink = `${window.location.origin}${window.location.pathname.replace("projects.html", "public-feedback.html")}?project_id=${id}`;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(feedbackLink)}`;

  const pprWindow = window.open("", "_blank");

  if (!pprWindow) {
    alert("Please allow pop-ups to generate PPR.");
    return;
  }

  pprWindow.document.write(`
    <html>
    <head>
      <title>Project Progress Report</title>
      <style>
        body{
          font-family:Arial, sans-serif;
          padding:35px;
          color:#0b1f35;
        }
        .header{
          text-align:center;
          border-bottom:2px solid #1557a6;
          padding-bottom:15px;
          margin-bottom:25px;
        }
        .logo{
          width:160px;
          margin-bottom:10px;
        }
        h1{
          color:#1557a6;
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
          background:#f1f7ff;
          width:35%;
        }
        .qr-box{
          margin-top:30px;
          border:1px solid #dbe7f3;
          padding:20px;
          border-radius:12px;
          display:flex;
          align-items:center;
          gap:20px;
        }
        .qr-box img{
          width:140px;
          height:140px;
        }
        .signatures{
          display:flex;
          justify-content:space-between;
          margin-top:70px;
        }
        .sig{
          width:40%;
          text-align:center;
          border-top:1px solid #000;
          padding-top:8px;
        }
        .files-section{
          margin-top:28px;
        }
        .file-list{
          margin:12px 0 0;
          padding-left:18px;
        }
        .file-list li{
          margin-bottom:8px;
          font-size:14px;
        }
        .file-list a{
          color:#1557a6;
          word-break:break-all;
        }
        .ppr-file-card{
          break-inside:avoid;
          margin:14px 0;
          padding:12px;
          border:1px solid #dbe7f3;
          border-radius:8px;
          background:#fbfdff;
        }
        .ppr-file-card img{
          display:block;
          width:100%;
          max-width:680px;
          max-height:520px;
          object-fit:contain;
          margin:8px 0;
          border:1px solid #d7e2ee;
          border-radius:6px;
        }
        .ppr-file-card a{
          color:#1557a6;
          word-break:break-all;
        }
        .file-date{
          display:block;
          color:#52616f;
          font-size:12px;
          margin-top:2px;
        }
      </style>
    </head>

    <body>

      <div class="header">
        <img src="assets/logo.jpg" class="logo">
        <h1>PROJECT PROGRESS REPORT</h1>
        <strong>LEMYU FIBER OPTIC INSTALLATION AND SERVICES</strong>
      </div>

      <table>
        <tr><td>Project Code</td><td>${project.project_code || "-"}</td></tr>
        <tr><td>Project Title</td><td>${project.project_title || "-"}</td></tr>
        <tr><td>Company Name</td><td>${project.client_name || "-"}</td></tr>
        <tr><td>Client Name</td><td>${getProjectClientName(project) || "-"}</td></tr>
        <tr><td>Contact Number</td><td>${project.contact_number || "-"}</td></tr>
        <tr><td>Location</td><td>${project.location || "-"}</td></tr>
        <tr><td>Status</td><td>${project.status || "-"}</td></tr>
        ${isOperationsScope() ? "" : `<tr><td>Down Payment</td><td>${peso(getProjectDownPayment(project))}</td></tr>`}
        <tr><td>Remarks</td><td>${project.remarks || "-"}</td></tr>
      </table>

      <div class="files-section">
        <h3>Uploaded Project Files</h3>
        ${
          uploadedFiles.length
            ? `
              <div class="file-list">
                ${uploadedFiles.map(file => `
                  <div class="ppr-file-card">
                    <strong>${file.file_name}</strong>
                    ${
                      isImageFile(file.file_name, file.file_url)
                        ? `<img src="${file.file_url}" alt="${file.file_name || "Uploaded project photo"}">`
                        : `<div><a href="${file.file_url}" target="_blank">Open file</a></div>`
                    }
                    ${
                      file.uploaded_at
                        ? `<span class="file-date">Uploaded: ${new Date(file.uploaded_at).toLocaleString()}</span>`
                        : ""
                    }
                  </div>
                `).join("")}
              </div>
            `
            : `<p>No uploaded files for this project.</p>`
        }
      </div>

      ${
        hasFeedback
          ? `
          <div class="qr-box">
            <img src="${qrUrl}">
            <div>
              <h3>Client Feedback Included</h3>
              <p><b>Total Feedback:</b> ${feedbacks.length}</p>
              <p><b>Average Rating:</b> ${avgRating}/5</p>
              <p>Scan the QR code to view or submit additional feedback.</p>
            </div>
          </div>
          `
          : `
          <div class="qr-box">
            <img src="${qrUrl}">
            <div>
              <h3>Client Feedback QR</h3>
              <p>No feedback has been submitted yet.</p>
              <p>Scan this QR code so the client can submit feedback for this project.</p>
            </div>
          </div>
          `
      }

      <div class="signatures">
        <div class="sig">
          ${escapeProjectHtml(project.ppr_prepared_by || "") || "&nbsp;"}<br>
          Prepared By
        </div>

        <div class="sig">
          &nbsp;<br>
          Noted By
        </div>
      </div>

    </body>
    </html>
  `);

  pprWindow.document.close();

  setTimeout(() => {
    pprWindow.print();
  }, 1200);
};

async function uploadProgressFiles(projectId) {
  const files = document.getElementById("progress_files").files;

  if (!files.length) return true;

  if (isLocalProjectId(projectId)) {
    alert("Progress file uploads are available after the project is synced to the database.");
    return false;
  }

  for (const file of files) {
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
      file_url: uploadedFile.publicUrl
    }]);

    if (error) {
      console.warn("Progress file record was not saved:", error.message || error);
      return false;
    }
  }

  document.getElementById("progress_files").value = "";
  return true;
}

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
          </div>
          <button type="button" class="danger-btn" onclick="deleteProgressFile('${file.id}')">Delete</button>
        </div>
      `).join("")
    : `<p class="muted">No uploaded progress files yet.</p>`;
}

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
      renderProjectList();
    });
  });
}

// INITIAL LOAD
applyFinanceProjectScope();
applyOperationsProjectScope();
bindProjectListFilters();
resetQuotationItems();
loadProjects();
