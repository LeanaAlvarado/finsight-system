import { supabase, peso, escapeHtml, number, readTable, setText } from "./supabase.js?v=20260809-billing-in-details-v147";

const LOCAL_PROJECTS_KEY = "lemyu_saved_projects";
const LOCAL_DOWN_PAYMENTS_KEY = "lemyu_down_payments";
const REVENUE_PAGE_SIZE = 10;

let revenueProjects = [];
let revenueExpenses = [];
let revenuePayroll = [];
let revenueCurrentPage = 1;
let revenueLoadError = "";
let revenueLoadPromise = null;
let revenueReloadQueued = false;
let revenueRefreshTimer = null;
const revenueListState = {
  search: "",
  date: "all",
  tax: "all",
  profit: "all",
  projectStatus: "all",
  sort: "newest"
};

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
  return revenueProjects.find(project => String(project.id || "") === String(projectId || ""))
    || mergeProjects().find(project => String(project.id || "") === String(projectId || ""));
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

function getProjectDate(project = {}) {
  return project.start_date || project.created_at || project.updated_at || "";
}

function getProjectFinancials(project = {}) {
  const hasPayrollRecords = revenuePayroll.length > 0;
  const projectExpenses = revenueExpenses
    .filter(e => recordBelongsToProject(e, project) && normalizeMatchValue(e.category) !== "payroll")
    .reduce((sum, e) => sum + number(e.amount), 0);

  const projectPayroll = hasPayrollRecords
    ? revenuePayroll
      .filter(pr => recordBelongsToProject(pr, project))
      .reduce((sum, pr) => sum + number(pr.salary_amount), 0)
    : revenueExpenses
      .filter(e => recordBelongsToProject(e, project) && normalizeMatchValue(e.category) === "payroll")
      .reduce((sum, e) => sum + number(e.amount), 0);

  const contract = number(project.contract_amount);
  const budget = number(project.project_budget);
  const budgetUsed = projectExpenses + projectPayroll;
  const remainingBudget = budget - budgetUsed;
  const budgetUtilization = budget > 0 ? (budgetUsed / budget) * 100 : 0;
  const downPayment = getProjectDownPayment(project);
  const balance = Math.max(contract - downPayment, 0);
  const taxPercent = project.tax_amount === null || project.tax_amount === undefined || project.tax_amount === ""
    ? 0
    : number(project.tax_amount);
  const tax = contract * (taxPercent / 100);
  const net = contract - budget - tax;

  return {
    project,
    projectExpenses,
    projectPayroll,
    contract,
    budget,
    budgetUsed,
    remainingBudget,
    budgetUtilization,
    downPayment,
    balance,
    taxPercent,
    tax,
    net
  };
}

function isWithinRevenueDateFilter(project = {}) {
  const dateFilter = revenueListState.date;
  if (dateFilter === "all") return true;

  const rawDate = getProjectDate(project);
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

function getFilteredRevenueRows() {
  const search = revenueListState.search.trim().toLowerCase();
  const rows = revenueProjects
    .map(project => getProjectFinancials(project))
    .filter(row => {
      if (!search) return true;

      const haystack = [
        row.project.project_code,
        row.project.project_title,
        row.project.client_name,
        row.project.company_name,
        row.project.status
      ].join(" ").toLowerCase();

      return haystack.includes(search);
    })
    .filter(row => isWithinRevenueDateFilter(row.project))
    .filter(row => {
      if (revenueListState.tax === "with_tax") return row.project.tax_amount !== null && row.project.tax_amount !== undefined && row.project.tax_amount !== "";
      if (revenueListState.tax === "no_tax") return row.project.tax_amount === null || row.project.tax_amount === undefined || row.project.tax_amount === "";
      return true;
    })
    .filter(row => {
      if (revenueListState.profit === "profit") return row.net > 0;
      if (revenueListState.profit === "loss") return row.net < 0;
      if (revenueListState.profit === "break_even") return row.net === 0;
      return true;
    })
    .filter(row => {
      if (revenueListState.projectStatus === "all") return true;
      return String(row.project.status || "").toLowerCase() === revenueListState.projectStatus.toLowerCase();
    });

  return rows.sort((a, b) => {
    const dateA = new Date(getProjectDate(a.project) || 0).getTime() || 0;
    const dateB = new Date(getProjectDate(b.project) || 0).getTime() || 0;
    const titleA = String(a.project.project_title || "").toLowerCase();
    const titleB = String(b.project.project_title || "").toLowerCase();

    if (revenueListState.sort === "oldest") return dateA - dateB || titleA.localeCompare(titleB);
    if (revenueListState.sort === "contract_desc") return b.contract - a.contract || titleA.localeCompare(titleB);
    if (revenueListState.sort === "contract_asc") return a.contract - b.contract || titleA.localeCompare(titleB);
    if (revenueListState.sort === "net_desc") return b.net - a.net || titleA.localeCompare(titleB);
    if (revenueListState.sort === "net_asc") return a.net - b.net || titleA.localeCompare(titleB);
    if (revenueListState.sort === "title_asc") return titleA.localeCompare(titleB) || dateB - dateA;
    return dateB - dateA || titleA.localeCompare(titleB);
  });
}

function hasActiveRevenueFilters() {
  return Boolean(revenueListState.search.trim())
    || revenueListState.date !== "all"
    || revenueListState.tax !== "all"
    || revenueListState.profit !== "all"
    || revenueListState.projectStatus !== "all";
}

function renderRevenuePagination(totalItems) {
  const pagination = document.getElementById("revenuePagination");
  const summary = document.getElementById("revenuePaginationSummary");
  const controls = document.getElementById("revenuePaginationControls");
  if (!pagination || !summary || !controls) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / REVENUE_PAGE_SIZE));
  revenueCurrentPage = Math.min(Math.max(revenueCurrentPage, 1), totalPages);
  const startIndex = totalItems ? ((revenueCurrentPage - 1) * REVENUE_PAGE_SIZE) + 1 : 0;
  const endIndex = Math.min(revenueCurrentPage * REVENUE_PAGE_SIZE, totalItems);

  pagination.hidden = false;
  summary.textContent = totalItems
    ? `Showing ${startIndex}-${endIndex} of ${totalItems} projects`
    : "Showing 0 of 0 projects";

  const pageWindow = 5;
  const firstPage = Math.max(1, Math.min(revenueCurrentPage - 2, totalPages - pageWindow + 1));
  const lastPage = Math.min(totalPages, firstPage + pageWindow - 1);
  const pageButtons = [];

  for (let page = firstPage; page <= lastPage; page += 1) {
    pageButtons.push(`
      <button type="button" class="${page === revenueCurrentPage ? "active" : ""}" ${page === revenueCurrentPage ? "aria-current=\"page\"" : ""} onclick="goToRevenuePage(${page})">${page}</button>
    `);
  }

  controls.innerHTML = `
    <button type="button" onclick="goToRevenuePage(${revenueCurrentPage - 1})" ${revenueCurrentPage <= 1 ? "disabled" : ""}>Previous</button>
    ${pageButtons.join("")}
    <button type="button" onclick="goToRevenuePage(${revenueCurrentPage + 1})" ${revenueCurrentPage >= totalPages ? "disabled" : ""}>Next</button>
  `;
}

function renderRevenueTable() {
  if (!revenueTable) return;

  if (revenueLoadError) {
    revenueTable.innerHTML = `<tr><td colspan="14" style="text-align:center;">Unable to load project records. Please try again.</td></tr>`;
    renderRevenuePagination(0);
    return;
  }

  const rows = getFilteredRevenueRows();
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / REVENUE_PAGE_SIZE));
  revenueCurrentPage = Math.min(Math.max(revenueCurrentPage, 1), totalPages);
  const startIndex = (revenueCurrentPage - 1) * REVENUE_PAGE_SIZE;
  const pageRows = rows.slice(startIndex, startIndex + REVENUE_PAGE_SIZE);

  if (!pageRows.length) {
    const message = revenueProjects.length && hasActiveRevenueFilters()
      ? "No projects match the selected filters."
      : "No project records found.";
    revenueTable.innerHTML = `<tr><td colspan="14" style="text-align:center;">${message}</td></tr>`;
    renderRevenuePagination(totalItems);
    return;
  }

  revenueTable.innerHTML = pageRows.map(row => `
    <tr>
      <td>${escapeHtml(row.project.project_title || "-")}</td>
      <td>${escapeHtml(row.project.client_name || "-")}</td>
      <td>${peso(row.contract)}</td>
      <td>${peso(row.budget)}</td>
      <td>${peso(row.downPayment)}</td>
      <td>${peso(row.balance)}</td>
      <td>
        <div class="inline-edit">
          <input class="tax-input" id="tax_${row.project.id}" type="number" min="0" max="100" step="0.01" placeholder="Blank" value="${row.project.tax_amount ?? ""}">
          <span class="input-suffix">%</span>
          <button type="button" onclick="saveProjectTax('${row.project.id}')">Save</button>
        </div>
      </td>
      <td>${peso(row.tax)}</td>
      <td>${peso(row.projectExpenses)}</td>
      <td>${peso(row.projectPayroll)}</td>
      <td>${peso(row.budgetUsed)}</td>
      <td class="${row.remainingBudget >= 0 ? "good" : "bad"}">${peso(row.remainingBudget)}</td>
      <td>${row.budget > 0 ? `${row.budgetUtilization.toFixed(2)}%` : "0.00%"}</td>
      <td class="${row.net >= 0 ? "good" : "bad"}">${peso(row.net)}</td>
    </tr>
  `).join("");

  renderRevenuePagination(totalItems);
}

async function loadRevenue({ silent = false } = {}) {
  if (!silent && revenueTable && !revenueProjects.length) {
    revenueTable.innerHTML = `<tr><td colspan="14" style="text-align:center;">Loading project records...</td></tr>`;
  }

  const [projectResult, expenseResult, payrollResult] = await Promise.all([
    readTable("projects", { orderBy: "created_at", ascending: false }),
    readTable("expenses"),
    readTable("payroll")
  ]);

  if (expenseResult.error || payrollResult.error) {
    revenueLoadError = (expenseResult.error || payrollResult.error)?.message || "Unable to load project records.";
    renderRevenueTable();
    console.error(expenseResult.error || payrollResult.error);
    return;
  }

  if (projectResult.error) {
    console.warn("Unable to load synced projects. Showing locally saved projects only.", projectResult.error);
  }

  revenueLoadError = "";
  revenueProjects = mergeProjects(projectResult.error ? [] : (projectResult.data || []));
  revenueExpenses = expenseResult.data || [];
  revenuePayroll = payrollResult.data || [];

  let totalContractVal = 0;
  let totalBudgetVal = 0;
  let totalTaxVal = 0;
  let totalExpenseVal = 0;
  let totalPayrollVal = 0;

  revenueProjects.forEach(project => {
    const row = getProjectFinancials(project);
    totalContractVal += row.contract;
    totalBudgetVal += row.budget;
    totalTaxVal += row.tax;
    totalExpenseVal += row.projectExpenses;
    totalPayrollVal += row.projectPayroll;
  });

  const netRevenueVal = totalContractVal - totalBudgetVal - totalTaxVal;

  setText("totalContract", peso(totalContractVal));
  setText("totalTaxes", peso(totalTaxVal));
  setText("totalExpenses", peso(totalExpenseVal));
  setText("totalPayroll", peso(totalPayrollVal));
  setText("netRevenue", peso(netRevenueVal));
  renderRevenueTable();
}

async function refreshRevenueNow(options = {}) {
  if (revenueLoadPromise) {
    revenueReloadQueued = true;
    return revenueLoadPromise;
  }

  revenueLoadPromise = loadRevenue(options).finally(() => {
    revenueLoadPromise = null;
    if (revenueReloadQueued) {
      revenueReloadQueued = false;
      scheduleRevenueRefresh(150, { silent: true });
    }
  });

  return revenueLoadPromise;
}

function scheduleRevenueRefresh(delay = 250, options = { silent: true }) {
  window.clearTimeout(revenueRefreshTimer);
  revenueRefreshTimer = window.setTimeout(() => {
    refreshRevenueNow(options);
  }, delay);
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
    await refreshRevenueNow({ silent: true });
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

  await refreshRevenueNow({ silent: true });
};

window.goToRevenuePage = function(page) {
  const totalPages = Math.max(1, Math.ceil(getFilteredRevenueRows().length / REVENUE_PAGE_SIZE));
  revenueCurrentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  renderRevenueTable();
};

function bindRevenueFilters() {
  const controls = [
    ["revenueSearch", "search"],
    ["revenueDateFilter", "date"],
    ["revenueTaxFilter", "tax"],
    ["revenueProfitFilter", "profit"],
    ["revenueProjectStatusFilter", "projectStatus"],
    ["revenueSort", "sort"]
  ];

  controls.forEach(([id, stateKey]) => {
    const element = document.getElementById(id);
    if (!element) return;

    element.addEventListener(element.type === "search" ? "input" : "change", event => {
      revenueListState[stateKey] = event.target.value || (stateKey === "search" ? "" : "all");
      revenueCurrentPage = 1;
      renderRevenueTable();
    });
  });
}

bindRevenueFilters();
refreshRevenueNow({ silent: false });

window.addEventListener("storage", event => {
  if (event.key === LOCAL_PROJECTS_KEY) {
    scheduleRevenueRefresh(250, { silent: true });
  }
});

window.addEventListener("lemyu:data-sync-complete", () => scheduleRevenueRefresh(250, { silent: true }));
window.addEventListener("lemyu:local-data-changed", () => scheduleRevenueRefresh(250, { silent: true }));

const revenueChannel = supabase.channel("revenue-budget-live");
["projects", "expenses", "payroll"].forEach(table => {
  revenueChannel.on(
    "postgres_changes",
    { event: "*", schema: "public", table },
    () => scheduleRevenueRefresh(300, { silent: true })
  );
});
revenueChannel.subscribe();
