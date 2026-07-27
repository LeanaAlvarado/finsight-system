import { supabase, escapeHtml, peso, number, readTable, setText } from "./supabase.js";

let dashboardChart = null;
let expenseCategoryChart = null;
let dashboardLoadPromise = null;
let dashboardReloadQueued = false;
let dashboardRefreshTimer = null;

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

function toTitleCase(value = "") {
  return String(value || "User")
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function addCategoryTotal(categoryTotals, category, amount) {
  const label = String(category || "Other Expenses").trim() || "Other Expenses";
  categoryTotals.set(label, (categoryTotals.get(label) || 0) + number(amount));
}

function getProjectLabel(project) {
  return project.project_title || project.project_code || project.client_name || "Untitled Project";
}

function getTaxAmount(project) {
  const contract = number(project.contract_amount);
  const taxPercent = project.tax_amount === null || project.tax_amount === undefined || project.tax_amount === ""
    ? 0
    : number(project.tax_amount);

  return contract * (taxPercent / 100);
}

function getRecordDate(record = {}) {
  return record.expense_date
    || record.date
    || record.start_date
    || record.created_at
    || new Date().toISOString();
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(date) {
  return date.toLocaleDateString("en-PH", {
    month: "short"
  });
}

function getTrendMonths(projects, expenses) {
  const allDates = [...projects, ...expenses]
    .map(record => new Date(getRecordDate(record)))
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

function getMonthlyTrend(projects, expenses) {
  const months = getTrendMonths(projects, expenses);
  const revenueByMonth = new Map(months.map(month => [month.key, 0]));
  const expensesByMonth = new Map(months.map(month => [month.key, 0]));

  projects.forEach(project => {
    const date = new Date(getRecordDate(project));
    const key = getMonthKey(date);
    if (revenueByMonth.has(key)) {
      revenueByMonth.set(key, revenueByMonth.get(key) + number(project.contract_amount));
    }
  });

  expenses.forEach(expense => {
    const date = new Date(getRecordDate(expense));
    const key = getMonthKey(date);
    if (expensesByMonth.has(key)) {
      expensesByMonth.set(key, expensesByMonth.get(key) + number(expense.amount));
    }
  });

  return {
    labels: months.map(month => month.label),
    revenue: months.map(month => revenueByMonth.get(month.key) / 1000),
    expenses: months.map(month => expensesByMonth.get(month.key) / 1000)
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

function getProjectAnalytics(projects, expenses, payroll, inventory) {
  return projects.map(project => {
    const revenue = number(project.contract_amount);
    const budget = number(project.project_budget);
    const tax = getTaxAmount(project);
    const expenseTotal = expenses
      .filter(expense => recordBelongsToProject(expense, project) && expense.category !== "Payroll")
      .reduce((sum, expense) => sum + number(expense.amount), 0);
    const payrollTotal = payroll
      .filter(item => recordBelongsToProject(item, project))
      .reduce((sum, item) => sum + number(item.salary_amount), 0);
    const materialTotal = inventory
      .filter(item => recordBelongsToProject(item, project))
      .reduce((sum, item) => sum + (number(item.qty) * number(item.price)), 0);
    const totalCost = budget + tax + expenseTotal + payrollTotal + materialTotal;
    const profit = revenue - totalCost;
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
      totalCost,
      profit,
      margin,
      costRatio
    };
  });
}

function getProjectStatus(analysis) {
  if (analysis.profit < 0 || analysis.costRatio >= 90) return "Critical";
  if (analysis.costRatio >= 70 || analysis.margin < 15) return "Watch";
  return "Healthy";
}

function renderProfitabilityTable(projectAnalytics) {
  const table = document.getElementById("profitabilityTable");
  if (!table) return;

  const rankedProjects = [...projectAnalytics]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 6);

  if (!rankedProjects.length) {
    table.innerHTML = `<tr><td colspan="7" style="text-align:center;">No project records available for BI ranking.</td></tr>`;
    return;
  }

  table.innerHTML = rankedProjects.map((item, index) => {
    const status = getProjectStatus(item);
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.label)}</td>
        <td>${peso(item.revenue)}</td>
        <td>${peso(item.totalCost)}</td>
        <td class="${item.profit >= 0 ? "good" : "bad"}">${peso(item.profit)}</td>
        <td>${item.margin.toFixed(2)}%</td>
        <td><span class="bi-status ${status.toLowerCase()}">${status}</span></td>
      </tr>
    `;
  }).join("");
}

function renderTopProfitabilityList(projectAnalytics) {
  const list = document.getElementById("topProfitabilityList");
  if (!list) return;

  const rankedProjects = [...projectAnalytics]
    .filter(item => item.revenue > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);
  const maxProfit = Math.max(...rankedProjects.map(item => Math.max(item.profit, 0)), 1);

  if (!rankedProjects.length) {
    list.innerHTML = `<div class="category-breakdown-empty">No profitability records available.</div>`;
    return;
  }

  list.innerHTML = rankedProjects.map(item => {
    const width = Math.max((Math.max(item.profit, 0) / maxProfit) * 100, 4);
    return `
      <div class="compact-profit-row">
        <div class="compact-profit-name">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${peso(item.profit)}</span>
        </div>
        <div class="compact-profit-bar">
          <span style="width:${width.toFixed(2)}%"></span>
        </div>
        <div class="compact-profit-margin">${item.margin.toFixed(1)}%</div>
      </div>
    `;
  }).join("");
}

function getInventoryProjectLabel(projects, projectCode = "") {
  const normalizedCode = normalizeMatchValue(projectCode);
  const project = projects.find(item => normalizeMatchValue(item.project_code) === normalizedCode);
  return project ? getProjectLabel(project) : (projectCode || "Unassigned Materials");
}

function renderInventoryProjectList(projects, inventory) {
  const list = document.getElementById("inventoryProjectList");
  if (!list) return;

  const totals = new Map();

  inventory.forEach(item => {
    const projectCode = String(item.project_code || "").trim();
    const key = projectCode || "Unassigned Materials";
    totals.set(key, (totals.get(key) || 0) + (number(item.qty) * number(item.price)));
  });

  const rankedProjects = [...totals.entries()]
    .map(([projectCode, total]) => ({
      label: getInventoryProjectLabel(projects, projectCode),
      total
    }))
    .filter(item => item.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  if (!rankedProjects.length) {
    list.innerHTML = `<span class="inventory-project-empty">No project-linked materials.</span>`;
    return;
  }

  list.innerHTML = rankedProjects.map(item => `
    <div class="inventory-project-row">
      <span>${escapeHtml(item.label)}</span>
      <strong>${peso(item.total)}</strong>
    </div>
  `).join("");
}

function renderCostAlerts(projectAnalytics) {
  const list = document.getElementById("costAlertList");
  if (!list) return;

  const alerts = projectAnalytics
    .filter(item => item.revenue > 0 && (item.profit < 0 || item.costRatio >= 70 || item.margin < 15))
    .sort((a, b) => b.costRatio - a.costRatio)
    .slice(0, 5);

  if (!alerts.length) {
    list.innerHTML = `
      <div class="alert-item good-alert">
        <strong>No cost overrun detected</strong>
        <span>Current projects are within the monitored profitability range.</span>
      </div>
    `;
    return;
  }

  list.innerHTML = alerts.map(item => {
    const status = getProjectStatus(item);
    return `
      <div class="alert-item ${status === "Critical" ? "danger-alert" : "warning-alert"}">
        <strong>${escapeHtml(item.label)}</strong>
        <span>${item.costRatio.toFixed(2)}% of revenue is already covered by budget, taxes, expenses, and payroll.</span>
      </div>
    `;
  }).join("");
}

function renderBusinessInsights(projectAnalytics, categoryTotals, totals) {
  const list = document.getElementById("businessInsightList");
  if (!list) return;

  const sortedProjects = [...projectAnalytics].sort((a, b) => b.profit - a.profit);
  const bestProject = sortedProjects[0];
  const lowestProject = [...projectAnalytics].sort((a, b) => a.margin - b.margin)[0];
  const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const riskCount = projectAnalytics.filter(item => getProjectStatus(item) !== "Healthy").length;
  const insights = [];

  if (bestProject) {
    insights.push({
      title: "Highest project contribution",
      text: `${bestProject.label} currently leads with ${peso(bestProject.profit)} net profit.`
    });
  }

  if (topCategory) {
    insights.push({
      title: "Largest cost driver",
      text: `${topCategory[0]} accounts for ${peso(topCategory[1])} of recorded costs.`
    });
  }

  if (lowestProject && lowestProject.revenue > 0) {
    insights.push({
      title: "Lowest margin project",
      text: `${lowestProject.label} has a ${lowestProject.margin.toFixed(2)}% margin and should be reviewed.`
    });
  }

  insights.push({
    title: "Portfolio risk",
    text: riskCount
      ? `${riskCount} project${riskCount === 1 ? "" : "s"} need cost or margin review.`
      : "No project is currently marked as cost-risk by the BI rules."
  });

  if (totals.revenue > 0) {
    insights.push({
      title: "Overall profitability",
      text: `The overall profit margin is ${((totals.profit / totals.revenue) * 100).toFixed(2)}%.`
    });
  }

  list.innerHTML = insights.map(item => `
    <div class="insight-item">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.text)}</span>
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

function renderBusinessIntelligence(projects, expenses, payroll, inventory, revenue) {
  const payrollTotal = payroll.reduce((sum, item) => sum + number(item.salary_amount), 0);
  const projectMaterialCost = inventory.reduce((sum, item) => sum + (number(item.qty) * number(item.price)), 0);
  const projectAnalytics = getProjectAnalytics(projects, expenses, payroll, inventory);
  const categoryTotals = new Map();

  expenses.forEach(expense => addCategoryTotal(categoryTotals, expense.category, expense.amount));
  if (payrollTotal > 0) addCategoryTotal(categoryTotals, "Payroll", payrollTotal);
  if (projectMaterialCost > 0) addCategoryTotal(categoryTotals, "Project Materials", projectMaterialCost);

  const totalProjectCost = projectAnalytics.reduce((sum, item) => sum + item.totalCost, 0);
  const profit = revenue - totalProjectCost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const sortedProjects = [...projectAnalytics].sort((a, b) => b.profit - a.profit);
  const bestProject = sortedProjects[0];
  const riskCount = projectAnalytics.filter(item => getProjectStatus(item) !== "Healthy").length;
  const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];

  setText("profitMargin", `${margin.toFixed(2)}%`);
  setText("riskProjectCount", riskCount);
  setText("bestProjectProfit", bestProject ? peso(bestProject.profit) : peso(0));
  setText("bestProjectName", bestProject ? bestProject.label : "No project record yet.");
  setText("topCostDriver", topCategory ? topCategory[0] : "-");
  setText("topCostDriverAmount", topCategory ? peso(topCategory[1]) : peso(0));

  renderExpenseCategoryChart(categoryTotals);
  renderCategoryBreakdownList(categoryTotals);
  renderProfitabilityTable(projectAnalytics);
  renderTopProfitabilityList(projectAnalytics);
  renderInventoryProjectList(projects, inventory);
  renderCostAlerts(projectAnalytics);
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

  const revenue = projects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + number(expense.amount), 0);
  const projectMaterialCost = inventory.reduce((sum, item) => sum + (number(item.qty) * number(item.price)), 0);
  const payrollTotal = payroll.reduce((sum, item) => sum + number(item.salary_amount), 0);
  const projectBudgetTotal = projects.reduce((sum, project) => sum + number(project.project_budget), 0);
  const taxTotal = projects.reduce((sum, project) => sum + getTaxAmount(project), 0);
  const totalCost = expenseTotal + payrollTotal + projectMaterialCost + projectBudgetTotal + taxTotal;
  const profit = revenue - totalCost;

  setText("totalRevenue", peso(revenue));
  setText("totalExpenses", peso(expenseTotal));
  setText("netProfit", peso(profit));
  setText("projectCount", projects.length);
  setText("inventoryValue", inventory.length);
  setText("inventoryCount", inventory.length);
  setText("inventoryPanelValue", peso(0));
  setText("inventoryPanelCount", inventory.length);
  setText("projectMini", projects.length);
  setText("revenueSmall", peso(revenue));
  setText("expenseSmall", peso(expenseTotal));
  setText("profitSmall", peso(profit));

  if (dashboardChart) {
    dashboardChart.destroy();
  }

  const trend = getMonthlyTrend(projects, expenses);

  dashboardChart = new Chart(document.getElementById("salesChart"), {
    type: "line",
    data: {
      labels: trend.labels,
      datasets: [
        {
          label: "Revenue",
          data: trend.revenue,
          borderColor: "#1f4e79",
          backgroundColor: "rgba(31,78,121,.08)",
          fill: true,
          tension: .38,
          pointRadius: 3,
          pointHoverRadius: 4,
          borderWidth: 2
        },
        {
          label: "Expenses",
          data: trend.expenses,
          borderColor: "#9f3a35",
          backgroundColor: "rgba(159,58,53,.06)",
          fill: true,
          tension: .38,
          pointRadius: 3,
          pointHoverRadius: 4,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: {
            usePointStyle: true
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(101,115,134,.16)"
          },
          ticks: {
            color: "#657386"
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: "#657386"
          }
        }
      }
    }
  });

  renderBusinessIntelligence(projects, expenses, payroll, inventory, revenue);
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

showDashboardUser();
refreshDashboardNow();
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
["projects", "expenses", "payroll", "inventory"].forEach(table => {
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
