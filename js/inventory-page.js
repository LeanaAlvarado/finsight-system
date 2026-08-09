import { supabase, peso, escapeHtml, insertWithOptionalColumns, number, readTable, setText, updateWithOptionalColumns } from "./supabase.js?v=20260809-dr-action-only-v144";

const INVENTORY_UPLOAD_BUCKETS = ["contracts", "progress-files", "inventory", "materials"];
const LOCAL_PROJECTS_KEY = "lemyu_saved_projects";
const MATERIAL_CATALOG_KEY = "lemyu_material_catalog";

let selectedCatalogMaterial = null;
let editingCatalogMaterialId = null;
let editingInventoryItemId = null;
let currentInventoryItems = [];
let currentInventoryProjects = [];
const INVENTORY_UNIT_OPTIONS = ["PCS", "MTR", "SET", "ROLL", "BOX", "PACK", "UNIT", "LOT"];
const INVENTORY_PAGE_SIZE = 10;
const LOW_STOCK_THRESHOLD = 5;

let inventoryCurrentPage = 1;
let inventoryFilteredItems = [];

const inventoryListState = {
  search: "",
  category: "",
  stock: "",
  sort: "created_desc"
};

async function uploadInventoryPicture(file) {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filePath = `material-pictures/${Date.now()}_${safeName}`;
  let lastError = null;

  for (const bucket of INVENTORY_UPLOAD_BUCKETS) {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file);

    if (!uploadError) {
      const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      return {
        fileName: file.name,
        filePath,
        publicUrl: data.publicUrl
      };
    }

    lastError = uploadError;

    if (!/bucket/i.test(uploadError.message || "")) {
      break;
    }
  }

  throw lastError || new Error("Unable to upload picture.");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Unable to read picture."));
    reader.readAsDataURL(file);
  });
}

async function getPictureFromFile(file) {
  if (!file) return null;

  try {
    return await uploadInventoryPicture(file);
  } catch (uploadError) {
    console.warn("Picture upload failed; saving picture locally.", uploadError);
    return {
      fileName: file.name,
      filePath: "",
      publicUrl: await readFileAsDataUrl(file)
    };
  }
}

function getMaterialCatalog() {
  try {
    return JSON.parse(localStorage.getItem(MATERIAL_CATALOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveMaterialCatalog(records) {
  localStorage.setItem(MATERIAL_CATALOG_KEY, JSON.stringify(records));
}

function saveMaterialCatalogRecord(material) {
  const record = {
    ...material,
    id: material.id || `catalog-material-${Date.now()}`,
    created_at: material.created_at || new Date().toISOString()
  };
  const records = getMaterialCatalog();
  const existingIndex = records.findIndex(item => String(item.id || "") === String(record.id || ""));
  const nextRecords = existingIndex >= 0
    ? records.map((item, index) => index === existingIndex ? { ...item, ...record } : item)
    : [record, ...records];

  saveMaterialCatalog(nextRecords);
  return record;
}

function deleteMaterialCatalogRecord(materialId) {
  saveMaterialCatalog(getMaterialCatalog().filter(item => String(item.id || "") !== String(materialId || "")));
}

function getCatalogMaterialById(materialId) {
  return getMaterialCatalog().find(item => String(item.id || "") === String(materialId || ""));
}

function isLocalCatalogMaterialId(materialId = "") {
  return String(materialId || "").startsWith("catalog-material-");
}

function mergeMaterialCatalogRecords(supabaseMaterials = [], localMaterials = getMaterialCatalog()) {
  const merged = [...supabaseMaterials];

  localMaterials.forEach(localMaterial => {
    const existingIndex = merged.findIndex(material => {
      return String(material.id || "") === String(localMaterial.id || "")
        || String(material.name || "").toLowerCase() === String(localMaterial.name || "").toLowerCase();
    });

    if (existingIndex >= 0) {
      merged[existingIndex] = { ...localMaterial, ...merged[existingIndex] };
    } else {
      merged.push(localMaterial);
    }
  });

  return merged.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

async function loadMaterialCatalog() {
  const { data = [], error } = await readTable("material_catalog");
  const records = mergeMaterialCatalogRecords(error ? [] : data);
  saveMaterialCatalog(records);
  setCatalogSelectOptions();
  renderMaterialCatalog();
}

function setCatalogSelectOptions() {
  const catalogSelect = document.getElementById("catalog_material_select");
  if (!catalogSelect) return;

  const materials = getMaterialCatalog()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  catalogSelect.innerHTML = `<option value="">Select from material catalog</option>` + materials
    .map(material => `<option value="${escapeHtml(material.id)}">${escapeHtml(material.name || "Unnamed Material")}</option>`)
    .join("");
}

function renderMaterialCatalog() {
  const catalogList = document.getElementById("materialCatalogList");
  if (!catalogList) return;

  const materials = getMaterialCatalog();
  setCatalogSelectOptions();

  catalogList.innerHTML = materials.length
    ? materials.map(material => `
        <div class="catalog-card">
          <div class="catalog-picture">
            ${
              material.picture_url
                ? `<img src="${escapeHtml(material.picture_url)}" alt="${escapeHtml(material.name || "Material picture")}">`
                : `<span>No picture</span>`
            }
          </div>
          <div class="catalog-info">
            <strong>${escapeHtml(material.name || "Unnamed Material")}</strong>
            <small>${escapeHtml(material.unit || "No default unit")} ${material.price ? `- ${peso(material.price)}` : ""}</small>
            <p>${escapeHtml(material.description || "No description")}</p>
          </div>
          <div class="catalog-actions">
            <button type="button" class="secondary-btn" onclick="editCatalogMaterial('${escapeHtml(material.id || "")}')">Edit</button>
            <button type="button" class="danger-btn" onclick="removeCatalogMaterial('${escapeHtml(material.id || "")}')">Delete</button>
          </div>
        </div>
      `).join("")
    : `<p class="muted">No saved catalog materials yet.</p>`;
}

function fillInventoryFormFromCatalog(material) {
  if (!material) return;

  selectedCatalogMaterial = material;
  const body = document.getElementById("inventoryItemsBody");
  if (body && body.children.length === 1) {
    const currentRow = body.querySelector("tr");
    const hasValue = [
      ".inventory-item-name",
      ".inventory-item-description",
      ".inventory-item-qty",
      ".inventory-item-unit",
      ".inventory-item-price"
    ].some(selector => String(currentRow?.querySelector(selector)?.value || "").trim());

    if (!hasValue || currentRow?.querySelector(".inventory-item-name")?.value === "") {
      body.innerHTML = "";
    }
  }

  addInventoryItemRow(material);
  const catalogSelect = document.getElementById("catalog_material_select");
  if (catalogSelect) catalogSelect.value = "";
}

function createInventoryItemRow(item = {}) {
  const tr = document.createElement("tr");
  tr.dataset.pictureName = item.picture_name || "";
  tr.dataset.pictureUrl = item.picture_url || "";
  const selectedUnit = String(item.unit || "").trim().toUpperCase();
  const unitOptions = [
    ...INVENTORY_UNIT_OPTIONS,
    selectedUnit && !INVENTORY_UNIT_OPTIONS.includes(selectedUnit) ? selectedUnit : ""
  ].filter(Boolean);

  tr.innerHTML = `
    <td><input class="inventory-item-name" required value="${escapeHtml(item.name || "")}" placeholder="Material name"></td>
    <td><input class="inventory-item-description" value="${escapeHtml(item.description || "")}" placeholder="Description"></td>
    <td><input class="inventory-item-qty" type="number" min="0" step="1" inputmode="numeric" required value="${toInventoryQuantity(item.qty ?? 1)}"></td>
    <td>
      <select class="inventory-item-unit">
        <option value="">Select Unit</option>
        ${unitOptions.map(unit => `<option value="${escapeHtml(unit)}" ${unit === selectedUnit ? "selected" : ""}>${escapeHtml(unit)}</option>`).join("")}
      </select>
    </td>
    <td><input class="inventory-item-price" type="number" min="0" step="0.01" required value="${item.price ?? 0}"></td>
    <td class="quotation-action-cell">
      <button type="button" onclick="addInventoryItemRow()">Add</button>
      <button type="button" class="danger-btn" onclick="removeInventoryItemRow(this)">Delete</button>
    </td>
  `;
  return tr;
}

function toInventoryQuantity(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function validateInventoryQuantityInput(input) {
  const rawValue = String(input?.value ?? "").trim();
  const parsed = Number(rawValue);

  if (!rawValue || !Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    input?.setCustomValidity("Quantity must be a whole number.");
    return false;
  }

  input.setCustomValidity("");
  input.value = String(parsed);
  return true;
}

function validateInventoryQuantityFields() {
  const quantityInputs = [...document.querySelectorAll(".inventory-item-qty")];
  const invalidInput = quantityInputs.find(input => !validateInventoryQuantityInput(input));

  if (invalidInput) {
    invalidInput.reportValidity();
    invalidInput.focus();
    return false;
  }

  return true;
}

function getInventoryItemsFromForm() {
  const projectCode = document.getElementById("inventory_project_code")?.value || "";

  return [...document.querySelectorAll("#inventoryItemsBody tr")]
    .map(row => ({
      project_code: projectCode,
      name: row.querySelector(".inventory-item-name")?.value.trim() || "",
      description: row.querySelector(".inventory-item-description")?.value.trim() || "",
      qty: toInventoryQuantity(row.querySelector(".inventory-item-qty")?.value),
      unit: row.querySelector(".inventory-item-unit")?.value.trim() || "",
      price: number(row.querySelector(".inventory-item-price")?.value),
      picture_name: row.dataset.pictureName || "",
      picture_url: row.dataset.pictureUrl || ""
    }))
    .filter(item => item.name || item.description || item.qty || item.unit || item.price);
}

function getInventoryDraftItems() {
  const projectCode = document.getElementById("inventory_project_code")?.value || "";

  return [...document.querySelectorAll("#inventoryItemsBody tr")]
    .map(row => ({
      id: `draft-${Math.random().toString(36).slice(2)}`,
      project_code: projectCode,
      name: row.querySelector(".inventory-item-name")?.value.trim() || "",
      description: row.querySelector(".inventory-item-description")?.value.trim() || "",
      qty: toInventoryQuantity(row.querySelector(".inventory-item-qty")?.value),
      unit: row.querySelector(".inventory-item-unit")?.value.trim() || "",
      price: number(row.querySelector(".inventory-item-price")?.value),
      is_draft: true
    }))
    .filter(item => item.name || item.description || item.price);
}

window.addInventoryItemRow = function(item = {}) {
  document.getElementById("inventoryItemsBody")?.appendChild(createInventoryItemRow(item));
  renderInventoryProjectSummary(currentInventoryItems, currentInventoryProjects);
};

window.removeInventoryItemRow = function(button) {
  const row = button.closest("tr");
  const body = row?.closest("tbody");

  if (!row || !body) return;

  row.remove();

  if (!body.children.length) {
    addInventoryItemRow();
  }

  renderInventoryProjectSummary(currentInventoryItems, currentInventoryProjects);
}

function setInventoryEditMode(item = null) {
  editingInventoryItemId = item?.id || null;

  const submitBtn = document.getElementById("inventorySubmitBtn");
  const cancelBtn = document.getElementById("inventoryCancelEditBtn");

  if (submitBtn) submitBtn.textContent = editingInventoryItemId ? "Update Material" : "Save Materials";
  if (cancelBtn) cancelBtn.style.display = editingInventoryItemId ? "" : "none";
}

function resetInventoryEntryForm() {
  if (!document.getElementById("inventoryItemsBody")) return;
  inventoryForm.reset();
  const pictureInput = document.getElementById("inventory_picture");
  if (pictureInput) pictureInput.value = "";
  const projectSelect = document.getElementById("inventory_project_code");
  if (projectSelect) projectSelect.value = "";
  inventoryItemsBody.innerHTML = "";
  addInventoryItemRow();
  selectedCatalogMaterial = null;
  setInventoryEditMode();
}

window.editInventoryMaterial = function(itemId) {
  const item = getInventoryItemById(itemId);
  if (!item) return;

  if (!document.getElementById("inventoryItemsBody")) return;

  const pictureInput = document.getElementById("inventory_picture");
  if (pictureInput) pictureInput.value = "";
  const projectSelect = document.getElementById("inventory_project_code");
  if (projectSelect) projectSelect.value = getItemProjectCode(item);
  inventoryItemsBody.innerHTML = "";
  addInventoryItemRow({
    name: item.name || "",
    description: item.description || "",
    qty: item.qty ?? 1,
    unit: getItemUnit(item),
    price: item.price ?? 0,
    picture_name: item.picture_name || "",
    picture_url: getItemPicture(item)
  });
  setInventoryEditMode(item);
  inventoryForm.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.deleteInventoryMaterial = async function(itemId) {
  if (!confirm("Delete this inventory material?")) return;

  const catalogMaterial = getCatalogMaterialById(itemId);
  if (catalogMaterial && !getLocalInventoryRecords().some(item => String(item.id || "") === String(itemId || ""))) {
    deleteMaterialCatalogRecord(itemId);
    await loadInventory();
    return;
  }

  if (!isLocalInventoryId(itemId)) {
    const { error } = await supabase
      .from("inventory")
      .delete()
      .eq("id", itemId);

    if (error) {
      alert("Delete error: " + error.message);
      return;
    }
  }

  saveLocalInventoryRecords(getLocalInventoryRecords().filter(item => String(item.id || "") !== String(itemId || "")));

  const projectCodeMap = getInventoryProjectCodes();
  const unitMap = getInventoryUnits();
  const pictureMap = getInventoryPictures();
  delete projectCodeMap[itemId];
  delete unitMap[itemId];
  delete pictureMap[itemId];
  saveInventoryProjectCodes(projectCodeMap);
  saveInventoryUnits(unitMap);
  saveInventoryPictures(pictureMap);

  if (editingInventoryItemId === itemId) {
    resetInventoryEntryForm();
  }

  await loadInventory();
};

function setCatalogEditMode(material = null) {
  editingCatalogMaterialId = material?.id || null;

  const submitBtn = document.getElementById("catalogSubmitBtn");
  const cancelBtn = document.getElementById("catalogCancelEditBtn");

  if (submitBtn) submitBtn.textContent = editingCatalogMaterialId ? "Update Catalog" : "Save to Catalog";
  if (cancelBtn) cancelBtn.style.display = editingCatalogMaterialId ? "" : "none";
}

function fillCatalogForm(material) {
  if (!material) return;

  catalog_name.value = material.name || "";
  catalog_description.value = material.description || "";
  catalog_unit.value = material.unit || "";
  catalog_price.value = material.price ?? "";
  catalog_picture.value = "";
  setCatalogEditMode(material);
  document.getElementById("materialCatalogForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getInventoryProjectCodes() {
  return JSON.parse(localStorage.getItem("lemyu_inventory_project_codes") || "{}");
}

function saveInventoryProjectCodes(records) {
  localStorage.setItem("lemyu_inventory_project_codes", JSON.stringify(records));
}

function getInventoryUnits() {
  return JSON.parse(localStorage.getItem("lemyu_inventory_units") || "{}");
}

function saveInventoryUnits(records) {
  localStorage.setItem("lemyu_inventory_units", JSON.stringify(records));
}

function getInventoryPictures() {
  return JSON.parse(localStorage.getItem("lemyu_inventory_pictures") || "{}");
}

function saveInventoryPictures(records) {
  localStorage.setItem("lemyu_inventory_pictures", JSON.stringify(records));
}

function getLocalInventoryRecords() {
  try {
    return JSON.parse(localStorage.getItem("lemyu_saved_inventory") || "[]");
  } catch {
    return [];
  }
}

function createLocalInventoryId() {
  return `local-inventory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeInventoryRecord(item = {}) {
  const rawName = String(item.name || "").trim();
  const name = rawName && !/^unnamed material$/i.test(rawName)
    ? rawName
    : item.material_name || item.material || item.description || "";

  return {
    ...item,
    name,
    material_name: name,
    project_code: item.project_code || "",
    description: item.description || "",
    qty: toInventoryQuantity(item.qty),
    unit: item.unit || "",
    price: number(item.price)
  };
}

function getInventoryExactKey(item = {}) {
  const normalized = normalizeInventoryRecord(item);

  return [
    String(normalized.project_code || "").trim().toLowerCase(),
    String(normalized.name || "").trim().toLowerCase(),
    String(normalized.description || "").trim().toLowerCase(),
    String(normalized.qty),
    String(normalized.unit || "").trim().toLowerCase(),
    String(normalized.price),
    String(normalized.picture_url || "")
  ].join("|");
}

function dedupeInventoryRecords(records = []) {
  const seenExactRows = new Set();
  const byId = new Map();
  const nextRecords = [];

  records.forEach(item => {
    const normalized = normalizeInventoryRecord(item);
    const id = String(normalized.id || "");

    if (id) {
      byId.set(id, { ...(byId.get(id) || {}), ...normalized });
      return;
    }
  });

  [...byId.values(), ...records.filter(item => !item?.id).map(item => normalizeInventoryRecord(item))].forEach(normalized => {
    const exactKey = getInventoryExactKey(normalized);
    if (seenExactRows.has(exactKey)) return;

    seenExactRows.add(exactKey);
    nextRecords.push(normalized);
  });

  return nextRecords;
}

function saveLocalInventoryRecords(records) {
  localStorage.setItem("lemyu_saved_inventory", JSON.stringify(dedupeInventoryRecords(records)));
}

function saveLocalInventoryRecord(item) {
  const record = normalizeInventoryRecord({
    ...item,
    id: item.id || createLocalInventoryId(),
    created_at: item.created_at || new Date().toISOString()
  });
  const records = getLocalInventoryRecords();
  const existingIndex = records.findIndex(existing => {
    return String(existing.id || "") === String(record.id || "");
  });
  const nextRecords = existingIndex >= 0
    ? records.map((existing, index) => index === existingIndex ? { ...existing, ...record } : existing)
    : [record, ...records];

  saveLocalInventoryRecords(nextRecords);
  return record;
}

function getInventoryDbRecord(record = {}) {
  return {
    catalog_id: record.catalog_id || "",
    project_code: record.project_code || "",
    material_name: record.material_name || record.name || "",
    name: record.name || record.material_name || "",
    description: record.description || "",
    qty: toInventoryQuantity(record.qty),
    stock_qty: toInventoryQuantity(record.stock_qty ?? record.qty),
    unit: record.unit || "",
    price: number(record.price),
    picture_name: record.picture_name || "",
    picture_url: record.picture_url || ""
  };
}

async function readInventoryRecordById(itemId) {
  if (!itemId) return null;

  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();

  if (error) {
    console.warn("Inventory cloud verification failed:", error.message || error);
    return null;
  }

  return data || null;
}

function replaceLocalInventoryRecordId(oldId, newRecord) {
  if (!oldId || !newRecord?.id || String(oldId) === String(newRecord.id)) return;

  const records = getLocalInventoryRecords().filter(item => String(item.id || "") !== String(oldId));
  saveLocalInventoryRecords([newRecord, ...records]);

  const projectCodeMap = getInventoryProjectCodes();
  const unitMap = getInventoryUnits();
  const pictureMap = getInventoryPictures();

  if (projectCodeMap[oldId] !== undefined) {
    projectCodeMap[newRecord.id] = projectCodeMap[oldId];
    delete projectCodeMap[oldId];
  }

  if (unitMap[oldId] !== undefined) {
    unitMap[newRecord.id] = unitMap[oldId];
    delete unitMap[oldId];
  }

  if (pictureMap[oldId] !== undefined) {
    pictureMap[newRecord.id] = pictureMap[oldId];
    delete pictureMap[oldId];
  }

  saveInventoryProjectCodes(projectCodeMap);
  saveInventoryUnits(unitMap);
  saveInventoryPictures(pictureMap);
}

function getInventoryItemById(itemId) {
  return currentInventoryItems.find(item => String(item.id || "") === String(itemId || ""))
    || getMaterialCatalog().find(item => String(item.id || "") === String(itemId || ""))
    || getLocalInventoryRecords().find(item => String(item.id || "") === String(itemId || ""));
}

function isLocalInventoryId(itemId = "") {
  return String(itemId || "").startsWith("local-inventory-")
    || String(itemId || "").startsWith("catalog-material-")
    || String(itemId || "").startsWith("project-material-")
    || !isUuid(itemId);
}

function getItemProjectCode(item) {
  return item.project_code || getInventoryProjectCodes()[item.id] || "";
}

function getLocalSavedProjects() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PROJECTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function mergeProjects(supabaseProjects = [], localProjects = getLocalSavedProjects()) {
  const merged = [...supabaseProjects];

  localProjects.forEach(localProject => {
    const exists = merged.some(project => {
      return String(project.id || "") === String(localProject.id || "")
        || String(project.project_code || "").toLowerCase() === String(localProject.project_code || "").toLowerCase();
    });

    if (!exists) merged.push(localProject);
  });

  return merged
    .filter(project => project.project_code)
    .sort((a, b) => String(a.project_code || "").localeCompare(String(b.project_code || "")));
}

function getItemUnit(item) {
  const catalogMaterial = getCatalogMaterialForItem(item);
  return item.unit || getInventoryUnits()[item.id] || catalogMaterial?.unit || "";
}

function getItemPicture(item) {
  const catalogMaterial = getCatalogMaterialForItem(item);
  return item.picture_url
    || item.image_url
    || item.photo_url
    || getInventoryPictures()[item.id]
    || catalogMaterial?.picture_url
    || catalogMaterial?.image_url
    || catalogMaterial?.photo_url
    || "";
}

function getCatalogMaterialForItem(item = {}) {
  return getMaterialCatalog().find(material => {
    return String(material.id || "") === String(item.catalog_id || "")
      || String(material.id || "") === String(item.id || "")
      || (
        String(material.name || "").trim().toLowerCase()
        && String(material.name || "").trim().toLowerCase() === String(item.name || "").trim().toLowerCase()
      );
  });
}

function getItemDescription(item = {}) {
  const catalogMaterial = getCatalogMaterialForItem(item);
  return item.description || catalogMaterial?.description || "";
}

function getProjectNameByCode(projects = [], projectCode = "") {
  const project = projects.find(item => {
    return String(item.project_code || "").toLowerCase() === String(projectCode || "").toLowerCase();
  });

  return project?.project_title || "";
}

function getProjectLabelByCode(projects = [], projectCode = "") {
  if (!projectCode) return "Unassigned / General Materials";

  const project = projects.find(item => {
    return String(item.project_code || "").toLowerCase() === String(projectCode || "").toLowerCase();
  });

  return project
    ? `${project.project_code || ""} - ${project.project_title || project.client_name || "Untitled Project"}`
    : projectCode;
}

function getLocalQuotationItems(projectId = "") {
  try {
    const records = JSON.parse(localStorage.getItem("lemyu_quotation_items") || "{}");
    return records[projectId] || [];
  } catch {
    return [];
  }
}

function getProjectMaterialItems(projects = []) {
  const materials = [];

  projects.forEach(project => {
    const quotationItems = Array.isArray(project.quotation_items)
      ? project.quotation_items
      : getLocalQuotationItems(project.id);

    quotationItems.forEach(item => {
      const qty = number(item.qty || 1);
      const totalAmount = number(item.total_amount);
      const price = totalAmount && qty
        ? totalAmount / qty
        : number(item.price ?? item.unitPrice ?? item.amount);
      const name = item.name || item.material_name || item.description || "";

      if (!name && !price) return;

      materials.push({
        id: `project-material-${project.id || project.project_code}-${materials.length}`,
        project_code: project.project_code || "",
        name: name || "Project Material",
        description: item.details || item.description || "",
        qty,
        unit: item.unit || "",
        price,
        is_project_material: true
      });
    });
  });

  return materials;
}

function mergeProjectMaterialSources(items = [], projects = []) {
  const merged = [...items];
  const existingKeys = new Set(merged.map(item => [
    String(getItemProjectCode(item) || "").toLowerCase(),
    String(item.name || "").trim().toLowerCase(),
    String(item.description || "").trim().toLowerCase(),
    String(number(item.qty)),
    String(item.unit || "").trim().toLowerCase(),
    String(number(item.price))
  ].join("|")));

  getProjectMaterialItems(projects).forEach(item => {
    const key = [
      String(item.project_code || "").toLowerCase(),
      String(item.name || "").trim().toLowerCase(),
      String(item.description || "").trim().toLowerCase(),
      String(number(item.qty)),
      String(item.unit || "").trim().toLowerCase(),
      String(number(item.price))
    ].join("|");

    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      merged.push(item);
    }
  });

  return merged;
}

function setInventoryProjectOptions(projects = []) {
  const projectSelect = document.getElementById("inventory_project_code");
  if (!projectSelect) return;

  const currentValue = projectSelect.value;
  projectSelect.innerHTML = `<option value="">Unassigned / General Material</option>` + projects
    .map(project => `
      <option value="${escapeHtml(project.project_code || "")}">
        ${escapeHtml(project.project_code || "")} - ${escapeHtml(project.project_title || project.client_name || "Untitled Project")}
      </option>
    `).join("");
  projectSelect.value = [...projectSelect.options].some(option => option.value === currentValue) ? currentValue : "";
}

function mergeInventoryItems(supabaseItems = [], localItems = getLocalInventoryRecords()) {
  const merged = dedupeInventoryRecords((supabaseItems || []).map(item => normalizeInventoryRecord(item)));
  const seenExactRows = new Set(merged.map(item => getInventoryExactKey(item)));

  localItems.forEach(localItem => {
    const normalizedLocal = normalizeInventoryRecord(localItem);
    const localId = String(normalizedLocal.id || "");
    const exactKey = getInventoryExactKey(normalizedLocal);
    const sameIdIndex = merged.findIndex(item => localId && String(item.id || "") === localId);

    if (sameIdIndex >= 0) {
      merged[sameIdIndex] = normalizeInventoryRecord({ ...normalizedLocal, ...merged[sameIdIndex] });
      return;
    }

    if (seenExactRows.has(exactKey)) return;

    seenExactRows.add(exactKey);
    merged.push(normalizedLocal);
  });

  return merged;
}

function mergeInventoryWithExistingMaterials(items = [], catalogMaterials = getMaterialCatalog()) {
  const merged = [...items];

  catalogMaterials.forEach(material => {
    const exists = merged.some(item => {
      return String(item.catalog_id || "") === String(material.id || "")
        || String(item.id || "") === String(material.id || "")
        || (
          String(item.name || "").trim().toLowerCase()
          && String(item.name || "").trim().toLowerCase() === String(material.name || "").trim().toLowerCase()
        );
    });

    if (!exists) {
      merged.push({
        ...material,
        id: material.id || `catalog-material-${Date.now()}`,
        project_code: "",
        qty: material.qty ?? 0,
        price: material.price ?? 0,
        is_catalog_only: true
      });
    }
  });

  return merged;
}

function summarizeInventoryByMaterial(items = []) {
  const records = new Map();

  items.forEach(item => {
    const key = String(item.name || "Unnamed Material").trim().toLowerCase();
    const qty = number(item.qty);
    const price = number(item.price);
    const existing = records.get(key);

    if (existing) {
      existing.qty += qty;
      existing.total += qty * price;
      if (!existing.picture && getItemPicture(item)) existing.picture = getItemPicture(item);
      if (!existing.name && item.name) existing.name = item.name;
      return;
    }

    records.set(key, {
      name: item.name || "Unnamed Material",
      picture: getItemPicture(item),
      qty,
      price,
      total: qty * price
    });
  });

  return [...records.values()].map(item => ({
    ...item,
    price: item.qty > 0 ? item.total / item.qty : item.price
  }));
}

function renderInventoryProjectSummary(items = [], projects = []) {
  const summary = document.getElementById("inventoryProjectSummary");
  if (!summary) return;

  const selectedProjectCode = document.getElementById("inventory_project_code")?.value || "";

  if (!selectedProjectCode) {
    summary.innerHTML = `
      <div class="inventory-project-placeholder">
        <strong>Select a project assignment</strong>
        <span>Choose a project above to display its linked materials, quantities, and total material cost.</span>
      </div>
    `;
    return;
  }

  const sourceItems = [
    ...mergeProjectMaterialSources(items, projects),
    ...getInventoryDraftItems()
  ];
  const projectGroups = new Map();

  sourceItems.forEach(item => {
    const projectCode = getItemProjectCode(item);
    if (selectedProjectCode && String(projectCode || "").toLowerCase() !== String(selectedProjectCode).toLowerCase()) {
      return;
    }

    const key = projectCode || "__unassigned__";
    const qty = number(item.qty);
    const value = qty * number(item.price);
    const current = projectGroups.get(key) || {
      projectCode,
      label: getProjectLabelByCode(projects, projectCode),
      itemCount: 0,
      qty: 0,
      value: 0,
      materials: []
    };

    current.itemCount += 1;
    current.qty += qty;
    current.value += value;
    current.materials.push({
      name: item.name || "Unnamed Material",
      qty,
      unit: getItemUnit(item) || item.unit || "-",
      price: number(item.price),
      total: value,
      isDraft: item.is_draft,
      isProjectMaterial: item.is_project_material
    });
    projectGroups.set(key, current);
  });

  const groups = [...projectGroups.values()]
    .sort((a, b) => b.value - a.value);

  if (!groups.length && selectedProjectCode) {
    const selectedLabel = getProjectLabelByCode(projects, selectedProjectCode);
    summary.innerHTML = `
      <div class="inventory-project-card">
        <div>
          <small>${escapeHtml(selectedProjectCode)}</small>
          <strong>${escapeHtml(selectedLabel)}</strong>
        </div>
        <p class="muted">No materials recorded for this project yet.</p>
      </div>
    `;
    return;
  }

  summary.innerHTML = groups.length ? groups.map(group => `
    <div class="inventory-project-card">
      <div>
        <small>${escapeHtml(group.projectCode || "GENERAL")}</small>
        <strong>${escapeHtml(group.label)}</strong>
      </div>
      <div class="inventory-project-materials">
        ${group.materials.map(material => `
          <div class="inventory-project-material-row">
            <span>${escapeHtml(material.name)}${material.isDraft ? ` <em>Draft</em>` : ""}${material.isProjectMaterial ? ` <em>Project</em>` : ""}</span>
            <small>${material.qty} ${escapeHtml(material.unit)} x ${peso(material.price)}</small>
            <strong>${peso(material.total)}</strong>
          </div>
        `).join("")}
      </div>
      <div class="inventory-project-metrics">
        <span><b>${group.itemCount}</b> material${group.itemCount === 1 ? "" : "s"}</span>
        <span><b>${group.qty}</b> total qty</span>
        <span><b>${peso(group.value)}</b> material value</span>
      </div>
    </div>
  `).join("") : `<p class="muted">No inventory materials grouped by project yet.</p>`;
}

function getInventoryFilteredItems(items = currentInventoryItems) {
  const search = inventoryListState.search.trim().toLowerCase();
  const category = inventoryListState.category;
  const stock = inventoryListState.stock;

  return items
    .filter(item => !item.is_catalog_only)
    .filter(item => {
      if (!search) return true;

      const haystack = [
        item.name,
        item.material_name,
        getItemDescription(item),
        getItemProjectCode(item),
        getItemUnit(item),
        getProjectNameByCode(currentInventoryProjects, getItemProjectCode(item))
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    })
    .filter(item => {
      const projectCode = getItemProjectCode(item);
      if (category === "project") return Boolean(projectCode);
      if (category === "general") return !projectCode;
      return true;
    })
    .filter(item => {
      const qtyValue = toInventoryQuantity(item.qty);
      if (stock === "available") return qtyValue > 0;
      if (stock === "low") return qtyValue > 0 && qtyValue < LOW_STOCK_THRESHOLD;
      if (stock === "zero") return qtyValue === 0;
      return true;
    })
    .sort((a, b) => {
      const sort = inventoryListState.sort;
      const nameA = String(a.name || a.material_name || "").toLowerCase();
      const nameB = String(b.name || b.material_name || "").toLowerCase();
      const qtyA = toInventoryQuantity(a.qty);
      const qtyB = toInventoryQuantity(b.qty);
      const priceA = number(a.price);
      const priceB = number(b.price);
      const dateA = new Date(a.created_at || 0).getTime() || 0;
      const dateB = new Date(b.created_at || 0).getTime() || 0;

      if (sort === "name_asc") return nameA.localeCompare(nameB);
      if (sort === "name_desc") return nameB.localeCompare(nameA);
      if (sort === "qty_asc") return qtyA - qtyB || nameA.localeCompare(nameB);
      if (sort === "qty_desc") return qtyB - qtyA || nameA.localeCompare(nameB);
      if (sort === "price_asc") return priceA - priceB || nameA.localeCompare(nameB);
      if (sort === "price_desc") return priceB - priceA || nameA.localeCompare(nameB);
      return dateB - dateA || nameA.localeCompare(nameB);
    });
}

function renderInventoryPagination(totalItems) {
  const pagination = document.getElementById("inventoryPagination");
  const summary = document.getElementById("inventoryPaginationSummary");
  const controls = document.getElementById("inventoryPaginationControls");
  if (!pagination || !summary || !controls) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / INVENTORY_PAGE_SIZE));
  inventoryCurrentPage = Math.min(Math.max(inventoryCurrentPage, 1), totalPages);
  const startIndex = totalItems ? ((inventoryCurrentPage - 1) * INVENTORY_PAGE_SIZE) + 1 : 0;
  const endIndex = Math.min(inventoryCurrentPage * INVENTORY_PAGE_SIZE, totalItems);

  pagination.hidden = false;
  summary.textContent = totalItems
    ? `Showing ${startIndex}-${endIndex} of ${totalItems} materials`
    : "Showing 0 of 0 materials";

  const pageWindow = 5;
  const firstPage = Math.max(1, Math.min(inventoryCurrentPage - 2, totalPages - pageWindow + 1));
  const lastPage = Math.min(totalPages, firstPage + pageWindow - 1);
  const pageButtons = [];

  for (let page = firstPage; page <= lastPage; page += 1) {
    pageButtons.push(`
      <button type="button" class="${page === inventoryCurrentPage ? "active" : ""}" ${page === inventoryCurrentPage ? "aria-current=\"page\"" : ""} onclick="goToInventoryPage(${page})">${page}</button>
    `);
  }

  controls.innerHTML = `
    <button type="button" onclick="goToInventoryPage(${inventoryCurrentPage - 1})" ${inventoryCurrentPage <= 1 ? "disabled" : ""}>Previous</button>
    ${pageButtons.join("")}
    <button type="button" onclick="goToInventoryPage(${inventoryCurrentPage + 1})" ${inventoryCurrentPage >= totalPages ? "disabled" : ""}>Next</button>
  `;
}

function renderInventoryMaterialsTable(items = currentInventoryItems, projects = currentInventoryProjects) {
  const table = document.getElementById("inventoryTable");
  if (!table) return;

  inventoryFilteredItems = getInventoryFilteredItems(items);
  const totalItems = inventoryFilteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / INVENTORY_PAGE_SIZE));
  inventoryCurrentPage = Math.min(Math.max(inventoryCurrentPage, 1), totalPages);
  const startIndex = (inventoryCurrentPage - 1) * INVENTORY_PAGE_SIZE;
  const pageItems = inventoryFilteredItems.slice(startIndex, startIndex + INVENTORY_PAGE_SIZE);

  if (!pageItems.length) {
    table.innerHTML = `<tr><td colspan="9" style="text-align:center;">No inventory materials found.</td></tr>`;
    renderInventoryPagination(totalItems);
    return;
  }

  table.innerHTML = pageItems.map(i => {
    const qtyValue = toInventoryQuantity(i.qty);
    const priceValue = number(i.price);
    const itemPicture = getItemPicture(i);
    const itemDescription = getItemDescription(i);
    const projectCode = getItemProjectCode(i);
    const projectTitle = getProjectNameByCode(projects, projectCode);
    const total = qtyValue * priceValue;

    return `
      <tr>
        <td>
          ${
            itemPicture
              ? `<img class="material-thumb" src="${escapeHtml(itemPicture)}" alt="${escapeHtml(i.name || "Material picture")}">`
              : `<span class="muted">No<br>picture</span>`
          }
        </td>
        <td>
          <strong>${escapeHtml(projectCode || "General")}</strong>
          ${projectTitle ? `<br><span class="muted">${escapeHtml(projectTitle)}</span>` : ""}
        </td>
        <td>${escapeHtml(i.name || "-")}</td>
        <td>${escapeHtml(itemDescription || "-")}</td>
        <td>${qtyValue}</td>
        <td>${escapeHtml(getItemUnit(i) || "-")}</td>
        <td>${peso(priceValue)}</td>
        <td>${peso(total)}</td>
        <td class="action-links">
          <button type="button" onclick="editInventoryMaterial('${escapeHtml(i.id || "")}')">Edit</button>
          <button type="button" class="danger-btn" onclick="deleteInventoryMaterial('${escapeHtml(i.id || "")}')">Delete</button>
        </td>
      </tr>
    `;
  }).join("");

  renderInventoryPagination(totalItems);
}

window.goToInventoryPage = function(page) {
  const totalPages = Math.max(1, Math.ceil(inventoryFilteredItems.length / INVENTORY_PAGE_SIZE));
  inventoryCurrentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  renderInventoryMaterialsTable();
};

async function loadInventory(){
  saveLocalInventoryRecords(getLocalInventoryRecords());

  const [itemResult, projectResult, catalogResult] = await Promise.all([
    readTable("inventory"),
    readTable("projects"),
    readTable("material_catalog")
  ]);

  if (itemResult.error) {
    console.error(itemResult.error);
  }

  if (!catalogResult.error) {
    saveMaterialCatalog(mergeMaterialCatalogRecords(catalogResult.data || []));
    setCatalogSelectOptions();
  }

  const projects = mergeProjects(projectResult.error ? [] : (projectResult.data || []));
  const items = mergeInventoryItems(itemResult.error ? [] : (itemResult.data || []))
    .filter(item => !item.is_catalog_only);
  currentInventoryItems = items;
  currentInventoryProjects = projects;
  setInventoryProjectOptions(projects);
  renderInventoryProjectSummary(items, projects);
  const totalVal = items.reduce((sum, item) => sum + (toInventoryQuantity(item.qty) * number(item.price)), 0);
  const low = items.filter(item => {
    const qtyValue = toInventoryQuantity(item.qty);
    return qtyValue > 0 && qtyValue < LOW_STOCK_THRESHOLD;
  }).length;

  setText("totalItems", items.length);
  setText("totalValue", peso(totalVal));
  setText("lowStock", low);

  const revenue = projects.reduce((s,p)=>s + number(p.contract_amount),0);
  setText("totalRevenue", peso(revenue));
  renderInventoryMaterialsTable(items, projects);
}

// SAVE
if (document.getElementById("inventoryForm")) {
inventoryForm.addEventListener("submit", async(e)=>{
  e.preventDefault();

  const submitBtn = document.getElementById("inventorySubmitBtn");
  if (submitBtn?.disabled) return;
  if (!validateInventoryQuantityFields()) return;
  if (submitBtn) submitBtn.disabled = true;

  try {
  const records = getInventoryItemsFromForm().map(item => normalizeInventoryRecord(item));
  const selectedPicture = document.getElementById("inventory_picture")?.files?.[0] || null;
  let uploadedPicture = null;

  if (selectedPicture) {
    try {
      uploadedPicture = await getPictureFromFile(selectedPicture);
    } catch (uploadError) {
      alert("Inventory picture error: " + uploadError.message);
      return;
    }
  }

  if (uploadedPicture) {
    records.forEach(record => {
      record.picture_name = uploadedPicture.fileName;
      record.picture_url = uploadedPicture.publicUrl;
    });
  }

  if (!records.length) {
    alert("Please add at least one material.");
    return;
  }

  if (editingInventoryItemId) {
    const currentItem = getInventoryItemById(editingInventoryItemId) || {};
    const record = {
      ...currentItem,
      ...records[0],
      id: currentItem.is_catalog_only ? undefined : editingInventoryItemId,
      catalog_id: currentItem.catalog_id || currentItem.id || "",
      updated_at: new Date().toISOString()
    };
    record.material_name = record.name;
    record.stock_qty = toInventoryQuantity(record.qty);

    let error = null;
    let savedData = null;

    if (!currentItem.is_catalog_only && !isLocalInventoryId(editingInventoryItemId)) {
      const dbRecord = getInventoryDbRecord(record);
      const result = await updateWithOptionalColumns(
        "inventory",
        dbRecord,
        "id",
        editingInventoryItemId,
        ["catalog_id", "project_code", "material_name", "name", "unit", "picture_name", "picture_url"],
        { returnRecord: true }
      );
      error = result.error;
      savedData = result.data;

      if (error) {
        const replacement = await insertWithOptionalColumns("inventory", dbRecord, [
          "catalog_id",
          "project_code",
          "material_name",
          "name",
          "unit",
          "picture_name",
          "picture_url"
        ], { returnRecord: true });

        if (!replacement.error) {
          const deleted = await supabase.from("inventory").delete().eq("id", editingInventoryItemId);
          if (deleted.error) {
            console.warn("Old inventory row could not be removed after replacement:", deleted.error.message || deleted.error);
          }
          error = null;
          savedData = replacement.data;
        }
      }
    } else {
      const dbRecord = getInventoryDbRecord(record);
      const result = await insertWithOptionalColumns("inventory", dbRecord, [
        "catalog_id",
        "project_code",
        "material_name",
        "name",
        "unit",
        "picture_name",
        "picture_url"
      ], { returnRecord: true });
      error = result.error;
      savedData = result.data;
    }

    if (error) {
      console.warn("Inventory material update failed in Supabase:", error.message || error);
      alert("Inventory update was not saved to the cloud: " + (error.message || error));
      return;
    }

    const cloudConfirmedItem = await readInventoryRecordById(savedData?.id || editingInventoryItemId);
    const savedItem = saveLocalInventoryRecord(cloudConfirmedItem ? { ...record, ...cloudConfirmedItem } : (savedData ? { ...record, ...savedData } : record));
    if (savedData?.id && String(savedData.id) !== String(editingInventoryItemId)) {
      replaceLocalInventoryRecordId(editingInventoryItemId, savedItem);
    }
    const projectCodeMap = getInventoryProjectCodes();
    const unitMap = getInventoryUnits();
    const pictureMap = getInventoryPictures();
    projectCodeMap[savedItem.id] = record.project_code;
    unitMap[savedItem.id] = record.unit;
    if (record.picture_url) pictureMap[savedItem.id] = record.picture_url;
    saveInventoryProjectCodes(projectCodeMap);
    saveInventoryUnits(unitMap);
    saveInventoryPictures(pictureMap);

    resetInventoryEntryForm();
    alert("Inventory material updated.");
    await loadInventory();
    return;
  }

  let localOnlyCount = 0;
  let skippedDuplicateCount = 0;

  for (const record of records) {
    record.material_name = record.name;
    record.stock_qty = toInventoryQuantity(record.qty);
    const existingExact = currentInventoryItems.find(item => {
      return !item.is_catalog_only
        && !item.is_project_material
        && getInventoryExactKey(item) === getInventoryExactKey(record);
    });

    if (existingExact) {
      saveLocalInventoryRecord({ ...existingExact, ...record, id: existingExact.id });
      skippedDuplicateCount++;
      continue;
    }

    const localSavedItem = saveLocalInventoryRecord(record);
    if (localSavedItem?.id) {
      const projectCodeMap = getInventoryProjectCodes();
      const unitMap = getInventoryUnits();
      const pictureMap = getInventoryPictures();
      projectCodeMap[localSavedItem.id] = record.project_code;
      unitMap[localSavedItem.id] = record.unit;
      if (record.picture_url) {
        pictureMap[localSavedItem.id] = record.picture_url;
      }
      saveInventoryProjectCodes(projectCodeMap);
      saveInventoryUnits(unitMap);
      saveInventoryPictures(pictureMap);
    }

    const result = await insertWithOptionalColumns("inventory", getInventoryDbRecord(record), [
      "catalog_id",
      "project_code",
      "material_name",
      "name",
      "unit",
      "picture_name",
      "picture_url"
    ], { returnRecord: true });

    if (result.error) {
      console.log(result.error);
      localOnlyCount++;
      continue;
    }

    const savedItem = saveLocalInventoryRecord({ ...result.data, ...record });
    replaceLocalInventoryRecordId(localSavedItem?.id, savedItem);

    if (savedItem?.id) {
      const projectCodeMap = getInventoryProjectCodes();
      const unitMap = getInventoryUnits();
      const pictureMap = getInventoryPictures();
      projectCodeMap[savedItem.id] = record.project_code;
      unitMap[savedItem.id] = record.unit;
      if (record.picture_url) {
        pictureMap[savedItem.id] = record.picture_url;
      }
      saveInventoryProjectCodes(projectCodeMap);
      saveInventoryUnits(unitMap);
      saveInventoryPictures(pictureMap);
    }
  }

  selectedCatalogMaterial = null;
  resetInventoryEntryForm();
  const savedCount = records.length - skippedDuplicateCount;
  alert(localOnlyCount
    ? `${savedCount} material(s) saved. ${localOnlyCount} saved locally because Supabase could not sync them. ${skippedDuplicateCount ? `${skippedDuplicateCount} duplicate material(s) skipped.` : ""}`
    : `${savedCount} material(s) saved${skippedDuplicateCount ? `, ${skippedDuplicateCount} duplicate material(s) skipped` : ""}!`);
  await loadInventory();
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
}

const catalogSelect = document.getElementById("catalog_material_select");
if (catalogSelect) {
  catalogSelect.addEventListener("change", event => {
    const material = getCatalogMaterialById(event.target.value);
    fillInventoryFormFromCatalog(material);
  });
}

document.getElementById("inventory_project_code")?.addEventListener("change", () => {
  renderInventoryProjectSummary(currentInventoryItems, currentInventoryProjects);
});

document.getElementById("inventoryItemsBody")?.addEventListener("input", () => {
  renderInventoryProjectSummary(currentInventoryItems, currentInventoryProjects);
});

document.getElementById("inventoryItemsBody")?.addEventListener("change", () => {
  document.querySelectorAll(".inventory-item-qty").forEach(input => {
    if (validateInventoryQuantityInput(input)) {
      input.value = String(toInventoryQuantity(input.value));
    }
  });
  renderInventoryProjectSummary(currentInventoryItems, currentInventoryProjects);
});

document.getElementById("inventoryItemsBody")?.addEventListener("keydown", event => {
  if (event.target?.classList?.contains("inventory-item-qty") && [".", ",", "e", "E", "-", "+"].includes(event.key)) {
    event.preventDefault();
  }
});

function resetInventoryListPage() {
  inventoryCurrentPage = 1;
  renderInventoryMaterialsTable();
}

document.getElementById("inventorySearch")?.addEventListener("input", event => {
  inventoryListState.search = event.target.value || "";
  resetInventoryListPage();
});

document.getElementById("inventoryCategoryFilter")?.addEventListener("change", event => {
  inventoryListState.category = event.target.value || "";
  resetInventoryListPage();
});

document.getElementById("inventoryStockFilter")?.addEventListener("change", event => {
  inventoryListState.stock = event.target.value || "";
  resetInventoryListPage();
});

document.getElementById("inventorySort")?.addEventListener("change", event => {
  inventoryListState.sort = event.target.value || "created_desc";
  resetInventoryListPage();
});

const materialCatalogForm = document.getElementById("materialCatalogForm");
if (materialCatalogForm) {
  materialCatalogForm.addEventListener("submit", async event => {
    event.preventDefault();

    const selectedPicture = document.getElementById("catalog_picture")?.files?.[0] || null;
    let uploadedPicture = null;

    if (selectedPicture) {
      try {
        uploadedPicture = await getPictureFromFile(selectedPicture);
      } catch (uploadError) {
        alert("Catalog picture error: " + uploadError.message);
        return;
      }
    }

    const existingMaterial = editingCatalogMaterialId
      ? getCatalogMaterialById(editingCatalogMaterialId)
      : null;

    const wasEditingCatalog = Boolean(editingCatalogMaterialId);

    const catalogRecord = {
      ...(existingMaterial || {}),
      id: editingCatalogMaterialId || undefined,
      name: catalog_name.value,
      description: catalog_description.value,
      unit: catalog_unit.value,
      price: number(catalog_price.value),
      picture_name: uploadedPicture?.fileName || existingMaterial?.picture_name || "",
      picture_url: uploadedPicture?.publicUrl || existingMaterial?.picture_url || ""
    };

    let saveResult = { error: null, data: null };

    if (editingCatalogMaterialId && !isLocalCatalogMaterialId(editingCatalogMaterialId)) {
      const dbRecord = { ...catalogRecord };
      delete dbRecord.id;
      delete dbRecord.created_at;
      saveResult = await supabase
        .from("material_catalog")
        .update(dbRecord)
        .eq("id", editingCatalogMaterialId)
        .select("*")
        .single();
    } else {
      const dbRecord = { ...catalogRecord };
      if (isLocalCatalogMaterialId(dbRecord.id)) {
        delete dbRecord.id;
      }

      saveResult = await insertWithOptionalColumns("material_catalog", dbRecord, [
        "description",
        "unit",
        "price",
        "picture_name",
        "picture_url"
      ], { returnRecord: true });
    }

    if (!saveResult.error && editingCatalogMaterialId && isLocalCatalogMaterialId(editingCatalogMaterialId)) {
      deleteMaterialCatalogRecord(editingCatalogMaterialId);
    }

    saveMaterialCatalogRecord(saveResult.error
      ? catalogRecord
      : { ...catalogRecord, ...saveResult.data });

    materialCatalogForm.reset();
    setCatalogEditMode();
    renderMaterialCatalog();
    alert(saveResult.error
      ? `${wasEditingCatalog ? "Material catalog updated" : "Material saved"} locally because Supabase could not sync it: ${saveResult.error.message}`
      : wasEditingCatalog ? "Material catalog updated." : "Material saved to catalog.");
  });
}

window.useCatalogMaterial = function(materialId) {
  const material = getCatalogMaterialById(materialId);
  fillInventoryFormFromCatalog(material);
  if (catalogSelect) catalogSelect.value = materialId;
  document.querySelector(".inventory-item-name")?.focus();
};

window.removeCatalogMaterial = async function(materialId) {
  if (!confirm("Delete this material from the catalog?")) return;

  if (!isLocalCatalogMaterialId(materialId)) {
    const { error } = await supabase
      .from("material_catalog")
      .delete()
      .eq("id", materialId);

    if (error) {
      alert("Delete error: " + error.message);
      return;
    }
  }

  deleteMaterialCatalogRecord(materialId);
  if (editingCatalogMaterialId === materialId) {
    materialCatalogForm?.reset();
    setCatalogEditMode();
  }
  if (catalogSelect?.value === materialId) {
    catalogSelect.value = "";
    selectedCatalogMaterial = null;
  }
  renderMaterialCatalog();
};

window.editCatalogMaterial = function(materialId) {
  const material = getCatalogMaterialById(materialId);
  if (!material) {
    alert("Material record was not found. Please refresh Inventory and try again.");
    return;
  }

  fillCatalogForm(material);
};

document.getElementById("catalogCancelEditBtn")?.addEventListener("click", () => {
  materialCatalogForm?.reset();
  setCatalogEditMode();
});

document.getElementById("inventoryCancelEditBtn")?.addEventListener("click", () => {
  resetInventoryEntryForm();
});

if (document.getElementById("inventoryForm")) resetInventoryEntryForm();
loadMaterialCatalog();
loadInventory();

window.addEventListener("storage", event => {
  if (event.key === LOCAL_PROJECTS_KEY) {
    loadInventory();
  }

  if (event.key === MATERIAL_CATALOG_KEY) {
    renderMaterialCatalog();
  }
});

