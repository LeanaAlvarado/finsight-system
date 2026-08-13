import { supabase, peso, escapeHtml, formatDate, insertWithOptionalColumns, number, readTable, setText } from "./supabase.js?v=20260813-collection-unpaid-list-v200";

const proposalForm = document.getElementById("proposalForm");
const proposalQuotationItemsBody = document.getElementById("proposalQuotationItemsBody");
const manpowerQuotationItemsBody = document.getElementById("manpowerQuotationItemsBody");
const manpowerQuotationPanel = document.getElementById("manpowerQuotationPanel");
const cctvQuotationPanel = document.getElementById("cctvQuotationPanel");
const quotationTypeInput = document.getElementById("quotation_type");
const project_code = document.getElementById("project_code");
const project_title = document.getElementById("project_title");
const client_name = document.getElementById("client_name");
const client_contact_name = document.getElementById("client_contact_name");
const contact_number = document.getElementById("contact_number");
const location = document.getElementById("location");
const start_date = document.getElementById("start_date");
const target_completion = document.getElementById("target_completion");
const status = document.getElementById("status");
const progress_percentage = document.getElementById("progress_percentage");
const project_budget = document.getElementById("project_budget");
const contract_amount = document.getElementById("contract_amount");
const down_payment = document.getElementById("down_payment");
const ppr_prepared_by = document.getElementById("ppr_prepared_by");
const ppr_noted_by = document.getElementById("ppr_noted_by");
const contract_file = document.getElementById("contract_file");
const remarks = document.getElementById("remarks");
const manpower_client_name = document.getElementById("manpower_client_name");
const manpower_client_contact = document.getElementById("manpower_client_contact");
const manpower_client_email = document.getElementById("manpower_client_email");
const manpower_location = document.getElementById("manpower_location");
const manpower_duration_days = document.getElementById("manpower_duration_days");
const manpower_amount_paid = document.getElementById("manpower_amount_paid");
const manpower_contract_amount = document.getElementById("manpower_contract_amount");
const manpower_purchase_order_number = document.getElementById("manpower_purchase_order_number");
const manpower_purchase_order_file = document.getElementById("manpower_purchase_order_file");
const manpower_project_budget = document.getElementById("manpower_project_budget");
const manpower_progress_percentage = document.getElementById("manpower_progress_percentage");
const manpower_prepared_by = document.getElementById("manpower_prepared_by");
const manpower_prepared_position = document.getElementById("manpower_prepared_position");
const manpower_terms = document.getElementById("manpower_terms");
const manpower_work_description = document.getElementById("manpower_work_description");
const manpower_additional_comments = document.getElementById("manpower_additional_comments");
const manpowerQuotationTotal = document.getElementById("manpowerQuotationTotal");
const cctv_intro = document.getElementById("cctv_intro");
const cctv_installation_charge = document.getElementById("cctv_installation_charge");
const cctv_summary_computation = document.getElementById("cctv_summary_computation");
const cctv_note = document.getElementById("cctv_note");
const cctv_terms = document.getElementById("cctv_terms");
const cctv_purchase_order_number = document.getElementById("cctv_purchase_order_number");
const cctv_purchase_order_file = document.getElementById("cctv_purchase_order_file");
const cctv_down_payment_percent = document.getElementById("cctv_down_payment_percent");
const cctv_duration_days = document.getElementById("cctv_duration_days");
const feedbackTable = document.getElementById("feedbackTable");
const PROPOSAL_UPLOAD_BUCKETS = ["contracts", "progress-files"];
const LOCAL_PROJECTS_KEY = "lemyu_saved_projects";
const MATERIAL_CATALOG_KEY = "lemyu_material_catalog";
const LOCAL_INVENTORY_KEY = "lemyu_saved_inventory";
const FEEDBACK_PAGE_SIZE = 10;
let proposalMaterialOptions = [];
let feedbackRecords = [];
let feedbackProjects = [];
let feedbackCurrentPage = 1;
let feedbackLoadError = "";
const feedbackListState = {
  search: "",
  rating: "all",
  status: "all",
  date: "all",
  sort: "newest"
};
const CCTV_DEFAULTS = {
  intro: "Supply & Installation Quotation of Tiandy CCTV and Witek Communication Solution\n2MP HYBRID IP CCTV W/ FIBER OPTIC INSTALLATION. We are pleased to offer you the following products for consideration.",
  installationCharge: "INSTALLATION CHARGE",
  summaryComputation: "SUMMARY OF COMPUTATION",
  note: "NOTE:\n- Materials and installation charges are subject to final site validation.\n- Any additional materials, civil works, electrical works, or revisions outside the quoted scope will be charged separately.",
  terms: "TERMS AND CONDITIONS:\n1. Prices are valid within the agreed quotation validity period.\n2. Payment terms are subject to agreement before project implementation.\n3. Schedule of installation is subject to material availability and site readiness.\n4. Warranty applies only to supplied equipment and workmanship under normal use.\n5. Client approval is required before commencement of work."
};
const MANPOWER_HIDDEN_FIELD_IDS = [
  "project_title",
  "client_name",
  "client_contact_name",
  "contact_number",
  "location",
  "start_date",
  "target_completion",
  "status",
  "progress_percentage",
  "project_budget",
  "contract_amount",
  "down_payment",
  "ppr_prepared_by",
  "ppr_noted_by",
  "contract_file"
];

function isFinanceScope() {
  return document.body.dataset.roleScope === "finance"
    || String(localStorage.getItem("lemyu_user_role") || "").toLowerCase() === "finance officer/accountant";
}

function isOwnerRole() {
  const role = String(localStorage.getItem("lemyu_user_role") || localStorage.getItem("lemyu_user_role_label") || "").toLowerCase();
  return ["owner/manager", "system administrator"].includes(role);
}

function applyFinanceScope() {
  if (!isFinanceScope()) return;

  const heroText = document.querySelector(".hero p");
  if (heroText) {
    heroText.textContent = "Review proposal and quotation amounts for costing support. Client feedback controls are not available for this role.";
  }

  document.querySelectorAll("#proposalForm input, #proposalForm select, #proposalForm textarea").forEach(field => {
    field.disabled = true;
  });

  document.querySelectorAll("#proposalForm button").forEach(button => {
    button.style.display = "none";
  });

  const proposalHeading = document.querySelector("#proposalSection h3");
  if (proposalHeading) proposalHeading.innerHTML = `<span class="num">01</span> Proposal / Quotation Costing View`;

  const proposalNote = document.querySelector("#proposalSection .muted");
  if (proposalNote) proposalNote.textContent = "Finance can review costing fields only and cannot create project contracts from this module.";

  document.querySelectorAll(".grid .card.kpi").forEach(card => {
    if (!/LINKED REVENUE/i.test(card.textContent || "")) {
      card.style.display = "none";
    }
  });

  const feedbackSection = document.querySelector("#feedbackTable")?.closest(".card");
  if (feedbackSection) feedbackSection.style.display = "none";
}

function applyContractOwnerScope() {
  if (isOwnerRole() || isFinanceScope()) return;

  document.querySelectorAll("#proposalForm input, #proposalForm select, #proposalForm textarea").forEach(field => {
    field.disabled = true;
  });

  document.querySelectorAll("#proposalForm button").forEach(button => {
    button.style.display = "none";
  });

  const proposalNote = document.querySelector("#proposalSection .muted");
  if (proposalNote) {
    proposalNote.textContent = "Only Owner/Manager or System Administrator accounts can add new project contracts.";
  }
}

function saveLocalProposalQuotationItems(projectId, items) {
  if (!projectId) return;

  const records = JSON.parse(localStorage.getItem("lemyu_quotation_items") || "{}");
  records[projectId] = items;
  localStorage.setItem("lemyu_quotation_items", JSON.stringify(records));
}

function getLocalSavedProjects() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PROJECTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalProjectMirror(project) {
  if (!project) return null;

  const projectCode = String(project.project_code || "").trim();
  const localRecord = {
    ...project,
    id: project.id || `local-${Date.now()}`,
    project_code: projectCode || generateFallbackProjectCode(),
    created_at: project.created_at || new Date().toISOString(),
    local_only: !project.id
  };

  const records = getLocalSavedProjects();
  const existingIndex = records.findIndex(item => {
    return String(item.id || "") === String(localRecord.id || "")
      || String(item.project_code || "").toLowerCase() === String(localRecord.project_code || "").toLowerCase();
  });

  const nextRecords = existingIndex >= 0
    ? records.map((item, index) => index === existingIndex ? { ...item, ...localRecord } : item)
    : [localRecord, ...records];

  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(nextRecords));
  window.dispatchEvent(new StorageEvent("storage", {
    key: LOCAL_PROJECTS_KEY,
    newValue: JSON.stringify(nextRecords)
  }));
  return localRecord;
}

async function resetProposalFormAfterSave() {
  proposalForm.reset();
  resetProposalQuotationItems();
  resetManpowerQuotationItems();
  resetProposalMaterials();
  setProposalMaterialOptions();
  toggleProposalQuotationType();
  await setProposalProjectCode();
  await loadFeedback();
}

function generateProjectCode(projects = []) {
  const maxNumber = (projects || []).reduce((max, project) => {
    const code = String(project?.project_code || "").trim();
    const match = code.match(/^PRJ-(\d+)$/i) || code.match(/(\d+)$/);
    const currentNumber = match ? number(match[1]) : 0;
    return Math.max(max, currentNumber);
  }, 0);

  return `PRJ-${String(maxNumber + 1).padStart(4, "0")}`;
}

function generateFallbackProjectCode() {
  const stamp = new Date()
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14);
  return `PRJ-${stamp}`;
}

async function setProposalProjectCode() {
  const field = document.getElementById("project_code");
  if (!field) return "";

  let projects = [];

  try {
    const result = await readTable("projects");
    projects = [...(result.data || []), ...getLocalSavedProjects()];
  } catch {
    projects = [];
  }

  field.value = projects.length ? generateProjectCode(projects) : generateFallbackProjectCode();
  return field.value;
}

async function ensureUniqueProposalProjectCode() {
  const field = document.getElementById("project_code");
  if (!field) return "";

  let projects = [];

  try {
    const result = await readTable("projects");
    projects = [...(result.data || []), ...getLocalSavedProjects()];
  } catch {
    if (!field.value) field.value = generateFallbackProjectCode();
    return field.value;
  }

  const existingCodes = new Set(projects.map(project => String(project.project_code || "").trim().toLowerCase()));

  if (!field.value || existingCodes.has(field.value.trim().toLowerCase())) {
    field.value = generateProjectCode(projects);
  }

  return field.value;
}

async function uploadProposalFile(file) {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filePath = `proposal-files/${Date.now()}_${safeName}`;
  let lastError = null;

  for (const bucket of PROPOSAL_UPLOAD_BUCKETS) {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file);

    if (!uploadError) {
      const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      return {
        fileName: file.name,
        publicUrl: data.publicUrl
      };
    }

    lastError = uploadError;

    if (!/bucket/i.test(uploadError.message || "")) {
      break;
    }
  }

  throw lastError || new Error("Unable to upload proposal file.");
}

function createProposalQuotationItemRow(item = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="quotation-description" placeholder="e.g. 4CH DVR / Bullet Camera / Labor" value="${escapeHtml(item.description || "")}"></td>
    <td><input class="quotation-qty" type="number" min="0" step="0.01" value="${item.qty ?? 1}"></td>
    <td><input class="quotation-unit" placeholder="e.g. PCS / BOX / LOT" value="${escapeHtml(item.unit || "")}"></td>
    <td><input class="quotation-amount" type="number" min="0" step="0.01" value="${item.amount ?? 0}"></td>
    <td class="quotation-action-cell">
      <button type="button" onclick="addProposalQuotationItem()">Add Item</button>
      <button type="button" class="danger-btn" onclick="removeProposalQuotationItem(this)">Delete</button>
    </td>
  `;

  tr.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", updateProposalComputedAmount);
  });

  return tr;
}

function resetProposalQuotationItems(items = []) {
  if (!proposalQuotationItemsBody) return;

  const rows = items.length
    ? items
    : [{ description: "", qty: 1, unit: "PCS", amount: 0 }];

  proposalQuotationItemsBody.innerHTML = "";
  rows.forEach(item => proposalQuotationItemsBody.appendChild(createProposalQuotationItemRow(item)));
}

function createManpowerQuotationItemRow(item = {}) {
  const tr = document.createElement("tr");
  const qty = number(item.qty ?? 1);
  const unitPrice = number(item.unitPrice ?? item.price ?? item.amount);
  tr.innerHTML = `
    <td><input class="manpower-description" placeholder="Description" value="${escapeHtml(item.description || "")}"></td>
    <td><input class="manpower-qty" type="number" min="0" step="0.01" value="${qty}"></td>
    <td><input class="manpower-unit-price" type="number" min="0" step="0.01" value="${unitPrice}"></td>
    <td class="manpower-line-amount">${peso(qty * unitPrice)}</td>
    <td class="quotation-action-cell">
      <button type="button" onclick="addManpowerQuotationItem()">Add Item</button>
      <button type="button" class="danger-btn" onclick="removeManpowerQuotationItem(this)">Delete</button>
    </td>
  `;

  tr.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", updateProposalComputedAmount);
  });

  return tr;
}

function resetManpowerQuotationItems(items = []) {
  if (!manpowerQuotationItemsBody) return;

  const rows = items.length
    ? items
    : [{ description: "", qty: 1, amount: 0 }];

  manpowerQuotationItemsBody.innerHTML = "";
  rows.forEach(item => manpowerQuotationItemsBody.appendChild(createManpowerQuotationItemRow(item)));
}

function getProposalQuotationItems() {
  return [...document.querySelectorAll("#proposalQuotationItemsBody tr")]
    .map(row => ({
      description: row.querySelector(".quotation-description")?.value.trim() || "",
      qty: number(row.querySelector(".quotation-qty")?.value),
      unit: row.querySelector(".quotation-unit")?.value.trim() || "",
      amount: number(row.querySelector(".quotation-amount")?.value)
    }))
    .filter(item => item.description || item.qty || item.unit || item.amount);
}

function getMaterialCatalog() {
  try {
    return JSON.parse(localStorage.getItem(MATERIAL_CATALOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function getProposalMaterialKey(item = {}) {
  const name = String(item.name || item.material || "").trim().toLowerCase();
  if (name) return name;

  return String(item.description || "").trim().toLowerCase();
}

function buildProposalMaterialOptions(inventoryItems = []) {
  const optionMap = new Map();
  const addOption = (item = {}, source = "inventory") => {
    const option = {
      id: `${source}-${item.id || getProposalMaterialKey(item)}`,
      name: item.name || item.material || "",
      description: item.description || "",
      qty: 1,
      unit: item.unit || "",
      price: number(item.price),
      picture_name: item.picture_name || "",
      picture_url: item.picture_url || ""
    };

    if (!option.name && !option.description) return;

    const key = getProposalMaterialKey(option);
    if (!optionMap.has(key)) optionMap.set(key, option);
  };

  getMaterialCatalog().forEach(item => addOption(item, "catalog"));
  getLocalInventoryRecords().forEach(item => addOption(item, "inventory-local"));
  inventoryItems.forEach(item => addOption(item, "inventory"));

  return [...optionMap.values()]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function renderProposalMaterialOptions(options = []) {
  const select = document.getElementById("proposal_material_select");
  if (!select) return;

  proposalMaterialOptions = options;

  select.innerHTML = `<option value="">Select from inventory / material catalog</option>` + options
    .map(material => `<option value="${escapeHtml(material.id)}">${escapeHtml(material.name || "Unnamed Material")}</option>`)
    .join("");
}

async function setProposalMaterialOptions() {
  renderProposalMaterialOptions(buildProposalMaterialOptions());

  const result = await readTable("inventory");
  if (!result.error) {
    renderProposalMaterialOptions(buildProposalMaterialOptions(result.data || []));
  }
}

function getProposalMaterialById(materialId) {
  return proposalMaterialOptions.find(material => String(material.id || "") === String(materialId || ""));
}

function createProposalMaterialRow(item = {}) {
  const tr = document.createElement("tr");
  tr.dataset.pictureName = item.picture_name || "";
  tr.dataset.pictureUrl = item.picture_url || "";
  tr.innerHTML = `
    <td><input class="proposal-material-name" required value="${escapeHtml(item.name || "")}" placeholder="Material name"></td>
    <td><input class="proposal-material-description" value="${escapeHtml(item.description || "")}" placeholder="Description"></td>
    <td><input class="proposal-material-qty" type="number" min="0" step="0.01" required value="${item.qty ?? 1}"></td>
    <td><input class="proposal-material-unit" value="${escapeHtml(item.unit || "")}" placeholder="PCS / MTR / SET"></td>
    <td><input class="proposal-material-price" type="number" min="0" step="0.01" required value="${item.price ?? 0}"></td>
    <td class="quotation-action-cell">
      <button type="button" onclick="addProposalMaterialRow()">Add</button>
      <button type="button" class="danger-btn" onclick="removeProposalMaterialRow(this)">Delete</button>
    </td>
  `;

  tr.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", updateProposalComputedAmount);
  });

  return tr;
}

function resetProposalMaterials(items = []) {
  const body = document.getElementById("proposalMaterialsBody");
  if (!body) return;

  const rows = items.length ? items : [{ name: "", description: "", qty: 1, unit: "", price: 0 }];
  body.innerHTML = "";
  rows.forEach(item => body.appendChild(createProposalMaterialRow(item)));
}

function getProposalMaterials() {
  return [...document.querySelectorAll("#proposalMaterialsBody tr")]
    .map(row => ({
      name: row.querySelector(".proposal-material-name")?.value.trim() || "",
      description: row.querySelector(".proposal-material-description")?.value.trim() || "",
      qty: number(row.querySelector(".proposal-material-qty")?.value),
      unit: row.querySelector(".proposal-material-unit")?.value.trim() || "",
      price: number(row.querySelector(".proposal-material-price")?.value),
      picture_name: row.dataset.pictureName || "",
      picture_url: row.dataset.pictureUrl || ""
    }))
    .filter(item => item.name || item.description || item.qty || item.unit || item.price);
}

function getProposalMaterialsAmount() {
  return getProposalMaterials().reduce((sum, item) => sum + (number(item.qty) * number(item.price)), 0);
}

function getLocalInventoryRecords() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_INVENTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalInventoryRecord(item) {
  const record = {
    ...item,
    id: item.id || `local-inventory-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: item.created_at || new Date().toISOString()
  };
  const records = getLocalInventoryRecords();
  const nextRecords = [record, ...records];
  localStorage.setItem(LOCAL_INVENTORY_KEY, JSON.stringify(nextRecords));
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

async function saveProposalMaterials(projectCode) {
  const materials = getProposalMaterials().map(item => ({
    project_code: projectCode,
    name: item.name,
    description: item.description,
    qty: number(item.qty),
    unit: item.unit,
    price: number(item.price),
    picture_name: item.picture_name || "",
    picture_url: item.picture_url || ""
  }));

  for (const material of materials) {
    const result = await supabase
      .from("inventory")
      .insert([material])
      .select("*")
      .single();

    if (result.error) {
      alert("Supabase inventory save failed: " + result.error.message + "\n\nPlease run supabase/cloud_required_schema.sql in Supabase SQL Editor, then try again.");
      throw result.error;
    }

    const savedItem = saveLocalInventoryRecord({ ...material, ...result.data });
    saveInventoryMaps(savedItem);
  }

  return { count: materials.length, localOnlyCount: 0 };
}

function getManpowerQuotationItems() {
  return [...document.querySelectorAll("#manpowerQuotationItemsBody tr")]
    .map(row => {
      const qty = number(row.querySelector(".manpower-qty")?.value);
      const unitPrice = number(row.querySelector(".manpower-unit-price")?.value);
      return {
        description: row.querySelector(".manpower-description")?.value.trim() || "",
        qty,
        unitPrice,
        price: unitPrice,
        amount: qty * unitPrice
      };
    })
    .filter(item => item.description || item.qty || item.amount);
}

function getManpowerAmount() {
  return getManpowerQuotationItems().reduce((sum, item) => sum + number(item.amount), 0);
}

function getCctvItemsAmount() {
  return getProposalQuotationItems().reduce((sum, item) => sum + number(item.amount), 0);
}

function getOverallProjectProgressValue() {
  const source = quotationTypeInput.value === "manpower" ? manpower_progress_percentage : progress_percentage;
  const value = Number(source?.value || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), 100);
}

function updateProposalComputedAmount() {
  if (quotationTypeInput.value === "manpower") {
    const manpowerAmount = getManpowerAmount();
    document.querySelectorAll("#manpowerQuotationItemsBody tr").forEach(row => {
      const qty = number(row.querySelector(".manpower-qty")?.value);
      const unitPrice = number(row.querySelector(".manpower-unit-price")?.value);
      const lineAmount = row.querySelector(".manpower-line-amount");
      if (lineAmount) lineAmount.textContent = peso(qty * unitPrice);
    });
    if (manpowerQuotationTotal) manpowerQuotationTotal.textContent = peso(manpowerAmount);
    if (manpowerAmount > 0) {
      contract_amount.value = manpowerAmount;
      if (manpower_contract_amount) manpower_contract_amount.value = manpowerAmount;
    }
    return;
  }

  const cctvAmount = getCctvItemsAmount() + getProposalMaterialsAmount();
  if (cctvAmount > 0) {
    contract_amount.value = cctvAmount;
  }
}

function buildProposalRemarks() {
  const baseRemarks = remarks.value.trim();

  if (quotationTypeInput.value === "cctv") {
    const cctvLines = [
      "Quotation Type: CCTV",
      cctv_duration_days?.value ? `Project Duration Days: ${Math.max(1, Math.trunc(number(cctv_duration_days.value)))}` : "",
      cctv_purchase_order_number?.value ? `Purchase Order Number: ${cctv_purchase_order_number.value}` : "",
      cctv_intro.value ? `CCTV Intro: ${cctv_intro.value}` : "",
      cctv_installation_charge.value ? `Installation Charge: ${cctv_installation_charge.value}` : "",
      cctv_summary_computation.value ? `Summary of Computation: ${cctv_summary_computation.value}` : "",
      cctv_note.value ? `Note: ${cctv_note.value}` : "",
      cctv_terms.value ? `Terms and Conditions: ${cctv_terms.value}` : ""
    ].filter(Boolean);

    return [baseRemarks, cctvLines.join("\n")].filter(Boolean).join("\n\n");
  }

  if (quotationTypeInput.value !== "manpower") {
    return baseRemarks;
  }

  const manpowerLines = [
    "Quotation Type: Manpower",
    manpower_client_email.value ? `Client Email: ${manpower_client_email.value}` : "",
    manpower_duration_days.value ? `Project Duration Days: ${Math.max(1, Math.trunc(number(manpower_duration_days.value)))}` : "",
    manpower_purchase_order_number?.value ? `Purchase Order Number: ${manpower_purchase_order_number.value}` : "",
    manpower_prepared_by.value ? `Prepared By: ${manpower_prepared_by.value}` : "",
    manpower_prepared_position.value ? `Position: ${manpower_prepared_position.value}` : "",
    manpower_terms.value ? `Terms of Service: ${manpower_terms.value}` : "",
    manpower_work_description.value ? `Work Description: ${manpower_work_description.value}` : "",
    manpower_additional_comments.value ? `Additional Comments: ${manpower_additional_comments.value}` : ""
  ].filter(Boolean);

  return [baseRemarks, manpowerLines.join("\n")].filter(Boolean).join("\n\n");
}

function setCctvDefaultFields(force = false) {
  const defaults = [
    [cctv_intro, CCTV_DEFAULTS.intro],
    [cctv_installation_charge, CCTV_DEFAULTS.installationCharge],
    [cctv_summary_computation, CCTV_DEFAULTS.summaryComputation],
    [cctv_note, CCTV_DEFAULTS.note],
    [cctv_terms, CCTV_DEFAULTS.terms]
  ];

  defaults.forEach(([field, value]) => {
    if (field && (force || !field.value.trim())) {
      field.value = value;
    }
  });
}

function toggleProposalQuotationType() {
  const isCctv = quotationTypeInput.value === "cctv";
  const isManpower = quotationTypeInput.value === "manpower";

  manpowerQuotationPanel.style.display = isManpower ? "" : "none";
  cctvQuotationPanel.style.display = isCctv ? "" : "none";
  manpowerQuotationPanel.querySelectorAll("input, select, textarea, button").forEach(field => {
    field.disabled = !isManpower;
  });
  cctvQuotationPanel.querySelectorAll("input, select, textarea, button").forEach(field => {
    field.disabled = !isCctv;
  });
  if (isCctv) setCctvDefaultFields();
  MANPOWER_HIDDEN_FIELD_IDS.forEach(id => {
    const field = document.getElementById(id);
    const wrapper = field?.closest(".form-grid > div");
    if (wrapper) wrapper.style.display = isManpower ? "none" : "";
    if (field) field.disabled = isManpower;
    if ((id === "project_code" || id === "project_title") && field) field.required = !isManpower;
  });
  const remarksField = document.getElementById("remarks");
  const remarksLabel = remarksField?.previousElementSibling;
  if (remarksField) remarksField.style.display = isManpower ? "none" : "";
  if (remarksLabel?.tagName === "LABEL") remarksLabel.style.display = isManpower ? "none" : "";
  updateProposalComputedAmount();
}

window.addProposalQuotationItem = function() {
  proposalQuotationItemsBody?.appendChild(createProposalQuotationItemRow());
};

window.removeProposalQuotationItem = function(button) {
  const row = button.closest("tr");
  const body = row?.closest("tbody");

  if (!row || !body) return;

  row.remove();

  if (!body.children.length) {
    body.appendChild(createProposalQuotationItemRow());
  }

  updateProposalComputedAmount();
};

window.addProposalMaterialRow = function(item = {}) {
  document.getElementById("proposalMaterialsBody")?.appendChild(createProposalMaterialRow(item));
};

window.removeProposalMaterialRow = function(button) {
  const row = button.closest("tr");
  const body = row?.closest("tbody");

  if (!row || !body) return;

  row.remove();

  if (!body.children.length) {
    body.appendChild(createProposalMaterialRow());
  }

  updateProposalComputedAmount();
};

document.getElementById("proposal_material_select")?.addEventListener("change", event => {
  const material = getProposalMaterialById(event.target.value);
  if (!material) return;

  window.addProposalMaterialRow(material);
  event.target.value = "";
  updateProposalComputedAmount();
});

window.addManpowerQuotationItem = function() {
  manpowerQuotationItemsBody?.appendChild(createManpowerQuotationItemRow());
};

window.removeManpowerQuotationItem = function(button) {
  const row = button.closest("tr");
  const body = row?.closest("tbody");

  if (!row || !body) return;

  row.remove();

  if (!body.children.length) {
    body.appendChild(createManpowerQuotationItemRow());
  }

  updateProposalComputedAmount();
};

quotationTypeInput.addEventListener("change", toggleProposalQuotationType);

proposalForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isOwnerRole()) {
    alert("Only Owner/Manager or System Administrator accounts can add and save new project contracts.");
    return;
  }

  if (isFinanceScope()) {
    alert("Finance Officer / Accountant has costing view only in this module.");
    return;
  }

  let didSaveLocalProject = false;

  try {
    updateProposalComputedAmount();
    await ensureUniqueProposalProjectCode();

    const selectedFile = contract_file.files[0];
    let uploadedFile = null;
    let uploadedPurchaseOrder = null;
    const isManpower = quotationTypeInput.value === "manpower";
    const manpowerItems = isManpower ? getManpowerQuotationItems() : [];
    const quotationItems = quotationTypeInput.value === "cctv" ? [] : manpowerItems;
    const selectedPurchaseOrderFile = isManpower
      ? manpower_purchase_order_file?.files?.[0]
      : cctv_purchase_order_file?.files?.[0];

    if (selectedFile) {
      try {
        uploadedFile = await uploadProposalFile(selectedFile);
      } catch (uploadError) {
        alert("Upload error: " + uploadError.message);
        return;
      }
    }

    if (selectedPurchaseOrderFile) {
      try {
        uploadedPurchaseOrder = await uploadProposalFile(selectedPurchaseOrderFile);
      } catch (uploadError) {
        alert("Purchase Order upload error: " + uploadError.message);
        return;
      }
    }

    const generatedProjectCode = document.getElementById("project_code")?.value.trim() || await setProposalProjectCode();
    const workDescription = manpower_work_description.value.trim();
    const fallbackTitle = manpowerItems[0]?.description || "Manpower Quotation";
    const contractValue = isManpower ? number(manpower_contract_amount?.value || contract_amount.value) : number(contract_amount.value);
    const downPaymentPercent = Math.min(Math.max(number(isManpower ? manpower_amount_paid?.value : cctv_down_payment_percent?.value || down_payment.value), 0), 100);
    const downPaymentAmount = contractValue * (downPaymentPercent / 100);

    const localRecord = {
      project_code: generatedProjectCode,
      project_title: isManpower ? (project_title.value || workDescription || fallbackTitle) : project_title.value,
      client_name: isManpower ? (client_name.value || manpower_client_name.value) : client_name.value,
      client_contact_name: isManpower ? (client_contact_name.value || manpower_client_name.value) : client_contact_name.value,
      contact_number: isManpower ? (contact_number.value || manpower_client_contact.value) : contact_number.value,
      client_email: isManpower ? manpower_client_email.value : "",
      location: isManpower ? (location.value || manpower_location.value) : location.value,
      start_date: start_date?.value || null,
      target_completion: target_completion?.value || null,
      status: status.value || "Pending",
      progress_percentage: getOverallProjectProgressValue(),
      project_budget: isManpower ? number(manpower_project_budget?.value || project_budget.value) : number(project_budget.value),
      contract_amount: contractValue,
      down_payment: downPaymentAmount,
      tax_amount: null,
      ppr_prepared_by: isManpower ? (ppr_prepared_by.value || manpower_prepared_by.value) : ppr_prepared_by.value,
      ppr_noted_by: ppr_noted_by?.value || "",
      remarks: buildProposalRemarks(),
      quotation_type: quotationTypeInput.value,
      quotation_items: quotationItems,
      purchase_order_number: isManpower ? (manpower_purchase_order_number?.value || "") : (cctv_purchase_order_number?.value || ""),
      purchase_order_amount: contractValue,
      purchase_order_file_name: uploadedPurchaseOrder?.fileName || "",
      purchase_order_file_url: uploadedPurchaseOrder?.publicUrl || "",
      billing_down_payment_amount: 0,
      billing_down_payment_percent: downPaymentPercent,
      billing_progress_percent: 0,
      contract_file_name: uploadedFile?.fileName || "",
      contract_file_url: uploadedFile?.publicUrl || ""
    };

    const localProject = saveLocalProjectMirror(localRecord);
    didSaveLocalProject = true;
    saveLocalProposalQuotationItems(localProject?.id, quotationItems);

    const result = await insertWithOptionalColumns(
      "projects",
      localRecord,
      [
        "client_contact_name",
        "client_email",
        "tax_amount",
        "progress_percentage",
        "ppr_prepared_by",
        "ppr_noted_by",
        "quotation_type",
        "quotation_items",
        "purchase_order_number",
        "purchase_order_amount",
        "purchase_order_file_name",
        "purchase_order_file_url",
        "billing_down_payment_amount",
        "billing_down_payment_percent",
        "billing_progress_percent",
        "contract_file_name",
        "contract_file_url"
      ],
      { returnRecord: true }
    );

    if (result.error) {
      alert("Project saved locally. Supabase save failed: " + result.error.message + "\n\nThe project will still appear locally in Project Monitoring.");
      await resetProposalFormAfterSave();
      return;
    }

    const savedProject = saveLocalProjectMirror({ ...localProject, ...localRecord, ...result.data, local_only: false });
    saveLocalProposalQuotationItems(savedProject?.id || result.data?.id || localProject?.id, quotationItems);
    if (quotationTypeInput.value === "cctv") await saveProposalMaterials(generatedProjectCode);
    alert("Proposal / project contract saved successfully.");
    await resetProposalFormAfterSave();
  } catch (error) {
    console.error("Project save failed:", error);
    alert(didSaveLocalProject
      ? "Project saved locally. Supabase sync error: " + (error.message || error)
      : "Project save error: " + (error.message || error));
  }
});

function normalizeFeedbackMatchValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

function getFeedbackProject(feedback = {}) {
  const feedbackValues = [
    feedback.project_id,
    feedback.project_code,
    feedback.project_reference,
    feedback.project_service,
    feedback.project_title
  ].map(normalizeFeedbackMatchValue).filter(Boolean);

  const directProject = feedbackProjects.find(project => {
    const projectValues = [
      project.id,
      project.project_code,
      project.project_title
    ].map(normalizeFeedbackMatchValue).filter(Boolean);

    return feedbackValues.some(value => projectValues.includes(value));
  });

  if (directProject) return directProject;

  const feedbackClient = normalizeFeedbackMatchValue(feedback.client_name);
  if (!feedbackClient) return null;

  const clientMatches = feedbackProjects
    .filter(project => {
      const clientValues = [
        project.client_name,
        project.company_name,
        project.client_company
      ].map(normalizeFeedbackMatchValue).filter(Boolean);

      return clientValues.some(value => value === feedbackClient);
    })
    .sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));

  return clientMatches[0] || null;
}

function getFeedbackProjectTitle(feedback = {}) {
  const project = getFeedbackProject(feedback);
  return project?.project_title
    || feedback.project_service
    || feedback.project_title
    || feedback.project_code
    || feedback.project_reference
    || "-";
}

function getFeedbackRating(feedback = {}) {
  return number(feedback.rating || feedback.overall_satisfaction);
}

function getFeedbackDate(feedback = {}) {
  return feedback.date || feedback.feedback_date || feedback.created_at || "";
}

function getFeedbackStatus(feedback = {}) {
  return feedback.status || feedback.feedback_status || "Active";
}

function isWithinFeedbackDateFilter(feedback = {}) {
  const dateFilter = feedbackListState.date;
  if (dateFilter === "all") return true;

  const rawDate = getFeedbackDate(feedback);
  if (!rawDate) return dateFilter === "no_date";

  const feedbackDate = new Date(rawDate);
  if (Number.isNaN(feedbackDate.getTime())) return dateFilter === "no_date";

  const today = new Date();
  if (dateFilter === "today") {
    return feedbackDate.getFullYear() === today.getFullYear()
      && feedbackDate.getMonth() === today.getMonth()
      && feedbackDate.getDate() === today.getDate();
  }

  if (dateFilter === "this_month") {
    return feedbackDate.getFullYear() === today.getFullYear()
      && feedbackDate.getMonth() === today.getMonth();
  }

  if (dateFilter === "this_year") {
    return feedbackDate.getFullYear() === today.getFullYear();
  }

  return true;
}

function getFilteredFeedbackRecords() {
  const search = feedbackListState.search.trim().toLowerCase();

  return feedbackRecords
    .filter(feedback => {
      if (!search) return true;

      const project = getFeedbackProject(feedback);
      const haystack = [
        feedback.client_name,
        feedback.comments,
        feedback.recommendations,
        getFeedbackProjectTitle(feedback),
        project?.project_code,
        project?.client_name
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    })
    .filter(feedback => {
      if (feedbackListState.rating === "all") return true;
      return Math.round(getFeedbackRating(feedback)) === Number(feedbackListState.rating);
    })
    .filter(feedback => {
      if (feedbackListState.status === "all") return true;
      return getFeedbackStatus(feedback).toLowerCase() === feedbackListState.status.toLowerCase();
    })
    .filter(feedback => isWithinFeedbackDateFilter(feedback))
    .sort((a, b) => {
      const dateA = new Date(getFeedbackDate(a) || 0).getTime() || 0;
      const dateB = new Date(getFeedbackDate(b) || 0).getTime() || 0;
      const ratingA = getFeedbackRating(a);
      const ratingB = getFeedbackRating(b);
      const clientA = String(a.client_name || "").toLowerCase();
      const clientB = String(b.client_name || "").toLowerCase();

      if (feedbackListState.sort === "oldest") return dateA - dateB || clientA.localeCompare(clientB);
      if (feedbackListState.sort === "rating_desc") return ratingB - ratingA || dateB - dateA;
      if (feedbackListState.sort === "rating_asc") return ratingA - ratingB || dateB - dateA;
      if (feedbackListState.sort === "client_asc") return clientA.localeCompare(clientB) || dateB - dateA;
      return dateB - dateA || clientA.localeCompare(clientB);
    });
}

function hasActiveFeedbackFilters() {
  return Boolean(feedbackListState.search.trim())
    || feedbackListState.rating !== "all"
    || feedbackListState.status !== "all"
    || feedbackListState.date !== "all";
}

function renderFeedbackPagination(totalItems) {
  const pagination = document.getElementById("feedbackPagination");
  const summary = document.getElementById("feedbackPaginationSummary");
  const controls = document.getElementById("feedbackPaginationControls");
  if (!pagination || !summary || !controls) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / FEEDBACK_PAGE_SIZE));
  feedbackCurrentPage = Math.min(Math.max(feedbackCurrentPage, 1), totalPages);
  const startIndex = totalItems ? ((feedbackCurrentPage - 1) * FEEDBACK_PAGE_SIZE) + 1 : 0;
  const endIndex = Math.min(feedbackCurrentPage * FEEDBACK_PAGE_SIZE, totalItems);

  pagination.hidden = false;
  summary.textContent = totalItems
    ? `Showing ${startIndex}-${endIndex} of ${totalItems} feedback records`
    : "Showing 0 of 0 feedback records";

  const pageWindow = 5;
  const firstPage = Math.max(1, Math.min(feedbackCurrentPage - 2, totalPages - pageWindow + 1));
  const lastPage = Math.min(totalPages, firstPage + pageWindow - 1);
  const pageButtons = [];

  for (let page = firstPage; page <= lastPage; page += 1) {
    pageButtons.push(`
      <button type="button" class="${page === feedbackCurrentPage ? "active" : ""}" ${page === feedbackCurrentPage ? "aria-current=\"page\"" : ""} onclick="goToFeedbackPage(${page})">${page}</button>
    `);
  }

  controls.innerHTML = `
    <button type="button" onclick="goToFeedbackPage(${feedbackCurrentPage - 1})" ${feedbackCurrentPage <= 1 ? "disabled" : ""}>Previous</button>
    ${pageButtons.join("")}
    <button type="button" onclick="goToFeedbackPage(${feedbackCurrentPage + 1})" ${feedbackCurrentPage >= totalPages ? "disabled" : ""}>Next</button>
  `;
}

function renderFeedbackTable() {
  if (!feedbackTable) return;

  if (feedbackLoadError) {
    feedbackTable.innerHTML = `<tr><td colspan="5" style="text-align:center;">Unable to load client feedback records. Please try again.</td></tr>`;
    renderFeedbackPagination(0);
    return;
  }

  const feedbacks = getFilteredFeedbackRecords();
  const totalItems = feedbacks.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / FEEDBACK_PAGE_SIZE));
  feedbackCurrentPage = Math.min(Math.max(feedbackCurrentPage, 1), totalPages);
  const startIndex = (feedbackCurrentPage - 1) * FEEDBACK_PAGE_SIZE;
  const pageFeedbacks = feedbacks.slice(startIndex, startIndex + FEEDBACK_PAGE_SIZE);

  if (!pageFeedbacks.length) {
    const message = feedbackRecords.length && hasActiveFeedbackFilters()
      ? "No feedback records match the selected filters."
      : "No client feedback records found.";
    feedbackTable.innerHTML = `<tr><td colspan="5" style="text-align:center;">${message}</td></tr>`;
    renderFeedbackPagination(totalItems);
    return;
  }

  feedbackTable.innerHTML = pageFeedbacks.map(feedback => {
    const rating = getFeedbackRating(feedback);
    const date = getFeedbackDate(feedback) || "-";

    return `
      <tr>
        <td>${escapeHtml(getFeedbackProjectTitle(feedback))}</td>
        <td>${escapeHtml(feedback.client_name || "-")}</td>
        <td>${number(rating)} / 5</td>
        <td>${formatDate(date)}</td>
        <td>${escapeHtml(feedback.comments || "")}</td>
      </tr>
    `;
  }).join("");

  renderFeedbackPagination(totalItems);
}

async function loadFeedback(){

  if (feedbackTable) {
    feedbackTable.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading client feedback records...</td></tr>`;
  }

  let feedbackResult = await readTable("feedback", { orderBy: "created_at" });

  if (feedbackResult.error) {
    feedbackResult = await readTable("feedback");
  }

  if (feedbackResult.error) {
    feedbackLoadError = feedbackResult.error.message || "Unable to load client feedback records.";
    feedbackRecords = [];
    renderFeedbackTable();
    return;
  }

  feedbackLoadError = "";
  feedbackRecords = feedbackResult.data || [];
  const { data: projects = [] } = await readTable("projects");
  const localProjects = getLocalSavedProjects();
  const projectMap = new Map();
  [...(projects || []), ...localProjects].forEach(project => {
    const key = String(project.id || project.project_code || project.project_title || "").trim();
    if (!key) return;
    projectMap.set(key, { ...(projectMap.get(key) || {}), ...project });
  });
  feedbackProjects = Array.from(projectMap.values());

  // revenue
  const totalRevenueVal = feedbackProjects.reduce((s,p)=>s + number(p.contract_amount),0);
  setText("totalRevenue", peso(totalRevenueVal));

  // stats
  setText("feedbackCount", feedbackRecords.length);

  const avg = feedbackRecords.length
    ? (feedbackRecords.reduce((s,f)=>s + number(f.rating || f.overall_satisfaction),0)/feedbackRecords.length).toFixed(1)
    : 0;

  setText("avgRating", avg + "/5");

  setText("latestStatus", feedbackRecords.length ? "Active" : "No Data");
  renderFeedbackTable();
}

window.goToFeedbackPage = function(page) {
  const totalPages = Math.max(1, Math.ceil(getFilteredFeedbackRecords().length / FEEDBACK_PAGE_SIZE));
  feedbackCurrentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  renderFeedbackTable();
};

function bindFeedbackFilters() {
  const controls = [
    ["feedbackSearch", "search"],
    ["feedbackRatingFilter", "rating"],
    ["feedbackStatusFilter", "status"],
    ["feedbackDateFilter", "date"],
    ["feedbackSort", "sort"]
  ];

  controls.forEach(([id, stateKey]) => {
    const element = document.getElementById(id);
    if (!element) return;

    const eventName = element.type === "search" ? "input" : "change";
    element.addEventListener(eventName, event => {
      feedbackListState[stateKey] = event.target.value || (stateKey === "search" ? "" : "all");
      feedbackCurrentPage = 1;
      renderFeedbackTable();
    });
  });
}

await setProposalProjectCode();
resetProposalQuotationItems();
resetManpowerQuotationItems();
resetProposalMaterials();
setProposalMaterialOptions();
setCctvDefaultFields();
toggleProposalQuotationType();
applyFinanceScope();
applyContractOwnerScope();
bindFeedbackFilters();
loadFeedback();
supabase
  .channel("feedback-live")
  .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, loadFeedback)
  .subscribe();


