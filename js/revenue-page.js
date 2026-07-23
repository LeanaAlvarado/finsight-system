import { supabase, peso, escapeHtml, number, readTable, setText } from "./supabase.js";

const LOCAL_PROJECTS_KEY = "lemyu_saved_projects";
const LOCAL_DOWN_PAYMENTS_KEY = "lemyu_down_payments";

function getLocalSavedProjects() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PROJECTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalProjects(records) {
  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(records));
}

function saveLocalProjectMirror(project) {
  if (!project) return;

  const records = getLocalSavedProjects();
  const existingIndex = records.findIndex(item => {
    return String(item.id || "") === String(project.id || "")
      || String(item.project_code || "").toLowerCase() === String(project.project_code || "").toLowerCase();
  });

  const nextRecords = existingIndex >= 0
    ? records.map((item, index) => index === existingIndex ? { ...item, ...project } : item)
    : [{ ...project, created_at: project.created_at || new Date().toISOString() }, ...records];

  saveLocalProjects(nextRecords);
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
        tax_amount: merged[existingIndex].tax_amount ?? localProject.tax_amount,
        quotation_type: merged[existingIndex].quotation_type || localProject.quotation_type,
        quotation_items: merged[existingIndex].quotation_items || localProject.quotation_items
      };
    } else {
      merged.push(localProject);
    }
  });

  return merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function getRevenueProjectById(projectId) {
  return mergeProjects().find(project => String(project.id || "") === String(projectId || ""));
}

function getDownPaymentsMap() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_DOWN_PAYMENTS_KEY) || "{}");
  } catch {
    return {};
  }
}

function getProjectDownPayment(project) {
  return number(project?.down_payment ?? getDownPaymentsMap()[project?.id] ?? 0);
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

function isLocalProjectId(projectId = "") {
  return String(projectId || "").startsWith("local-");
}

async function loadRevenue() {
  const [projectResult, expenseResult, payrollResult] = await Promise.all([
    readTable("projects"),
    readTable("expenses"),
    readTable("payroll")
  ]);

  if (expenseResult.error || payrollResult.error) {
    revenueTable.innerHTML = `<tr><td colspan="11" style="text-align:center;">Unable to load revenue records.</td></tr>`;
    console.error(expenseResult.error || payrollResult.error);
    return;
  }

  if (projectResult.error) {
    console.warn("Unable to load synced projects. Showing locally saved projects only.", projectResult.error);
  }

  const projects = mergeProjects(projectResult.error ? [] : (projectResult.data || []));
  const expenses = expenseResult.data || [];
  const payroll = payrollResult.data || [];

  let totalContractVal = 0;
  let totalBudgetVal = 0;
  let totalTaxVal = 0;
  let totalExpenseVal = 0;
  let totalPayrollVal = 0;

  revenueTable.innerHTML = "";

  if (!projects.length) {
    revenueTable.innerHTML = `<tr><td colspan="11" style="text-align:center;">No project revenue records yet.</td></tr>`;
  }

  projects.forEach(p => {
    const projectExpenses = expenses
      .filter(e => recordBelongsToProject(e, p) && e.category !== "Payroll")
      .reduce((sum, e) => sum + number(e.amount), 0);

    const projectPayroll = payroll
      .filter(pr => recordBelongsToProject(pr, p))
      .reduce((sum, pr) => sum + number(pr.salary_amount), 0);

    const contract = number(p.contract_amount);
    const budget = number(p.project_budget);
    const downPayment = getProjectDownPayment(p);
    const balance = Math.max(contract - downPayment, 0);
    const taxPercent = p.tax_amount === null || p.tax_amount === undefined || p.tax_amount === ""
      ? 0
      : number(p.tax_amount);
    const tax = contract * (taxPercent / 100);
    const net = contract - budget - tax - projectExpenses - projectPayroll;

    totalContractVal += contract;
    totalBudgetVal += budget;
    totalTaxVal += tax;
    totalExpenseVal += projectExpenses;
    totalPayrollVal += projectPayroll;

    revenueTable.innerHTML += `
      <tr>
        <td>${escapeHtml(p.project_title || "-")}</td>
        <td>${escapeHtml(p.client_name || "-")}</td>
        <td>${peso(contract)}</td>
        <td>${peso(budget)}</td>
        <td>${peso(downPayment)}</td>
        <td>${peso(balance)}</td>
        <td>
          <div class="inline-edit">
            <input class="tax-input" id="tax_${p.id}" type="number" min="0" max="100" step="0.01" placeholder="Blank" value="${p.tax_amount ?? ""}">
            <span class="input-suffix">%</span>
            <button type="button" onclick="saveProjectTax('${p.id}')">Save</button>
          </div>
        </td>
        <td>${peso(tax)}</td>
        <td>${peso(projectExpenses)}</td>
        <td>${peso(projectPayroll)}</td>
        <td class="${net >= 0 ? "good" : "bad"}">${peso(net)}</td>
      </tr>
    `;
  });

  const netRevenueVal = totalContractVal - totalBudgetVal - totalTaxVal - totalExpenseVal - totalPayrollVal;

  setText("totalContract", peso(totalContractVal));
  setText("totalTaxes", peso(totalTaxVal));
  setText("totalExpenses", peso(totalExpenseVal));
  setText("totalPayroll", peso(totalPayrollVal));
  setText("netRevenue", peso(netRevenueVal));
}

window.saveProjectTax = async function(projectId) {
  const field = document.getElementById(`tax_${projectId}`);
  const taxValue = field.value === "" ? null : number(field.value);

  if (taxValue !== null && (taxValue < 0 || taxValue > 100)) {
    alert("Tax percent must be between 0 and 100.");
    return;
  }

  const project = getRevenueProjectById(projectId);
  const updatedProject = {
    ...(project || {}),
    id: projectId,
    tax_amount: taxValue,
    updated_at: new Date().toISOString()
  };

  if (isLocalProjectId(projectId)) {
    saveLocalProjectMirror(updatedProject);
    await loadRevenue();
    return;
  }

  const { error } = await supabase
    .from("projects")
    .update({ tax_amount: taxValue })
    .eq("id", projectId);

  if (error) {
    saveLocalProjectMirror(updatedProject);
    alert("Tax saved locally because Supabase could not update this project: " + error.message);
  } else {
    saveLocalProjectMirror(updatedProject);
  }

  await loadRevenue();
};

loadRevenue();

window.addEventListener("storage", event => {
  if (event.key === LOCAL_PROJECTS_KEY) {
    loadRevenue();
  }
});
