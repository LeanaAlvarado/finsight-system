import { escapeHtml, formatDate, number, peso, readTable, setText } from "./supabase.js";

function getRecordDate(record) {
  return record.created_at || record.uploaded_at || record.date || record.expense_date || record.pay_date || new Date().toISOString();
}

function addAuditEvent(events, moduleName, activity, reference, dateValue) {
  events.push({
    moduleName,
    activity,
    reference,
    dateValue: dateValue || new Date().toISOString()
  });
}

function isFinanceScope() {
  return document.body.dataset.roleScope === "finance"
    || /(finance|accountant|accounting)/i.test(localStorage.getItem("lemyu_user_role") || "");
}

function isOperationsScope() {
  return document.body.dataset.roleScope === "operations"
    || /(project\s*manager|operations?\s*staff|operations?)/i.test(localStorage.getItem("lemyu_user_role") || "");
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

  document.querySelectorAll(".permission-pill").forEach(pill => {
    if (!/Projects/i.test(pill.textContent || "")) {
      pill.style.display = "none";
    }
  });

  const auditHeading = document.querySelector("#auditTable")?.closest(".card")?.querySelector("h3");
  const auditText = document.querySelector("#auditTable")?.closest(".card")?.querySelector(".muted");
  if (auditHeading) auditHeading.innerHTML = `<span class="num">03</span> Project Activity Log`;
  if (auditText) auditText.textContent = "Limited to project monitoring records only.";
}

function applyFinanceReportScope() {
  if (!isFinanceScope()) return;

  const heroTitle = document.querySelector(".hero h1");
  const heroText = document.querySelector(".hero p");
  if (heroTitle) heroTitle.textContent = "Financial Reports";
  if (heroText) heroText.textContent = "Review revenue, payroll, expenses, taxes, budget exposure, and financial activity only.";

  const feedbackCard = document.getElementById("reportFeedback")?.closest(".mini-card");
  if (feedbackCard) feedbackCard.style.display = "none";

  document.querySelectorAll(".permission-pill").forEach(pill => {
    if (!/Projects|Payroll|Expenses|Taxes|Revenue/i.test(pill.textContent || "")) {
      pill.style.display = "none";
    }
  });

  const auditHeading = document.querySelector("#auditTable")?.closest(".card")?.querySelector("h3");
  const auditText = document.querySelector("#auditTable")?.closest(".card")?.querySelector(".muted");
  if (auditHeading) auditHeading.innerHTML = `<span class="num">03</span> Financial Activity Log`;
  if (auditText) auditText.textContent = "Limited to finance-related records for payroll, expenses, revenue, and project budgets.";
}

async function loadReports() {
  const [projectResult, expenseResult, payrollResult, inventoryResult, feedbackResult] = await Promise.all([
    readTable("projects", { orderBy: "created_at" }),
    readTable("expenses", { orderBy: "created_at" }),
    readTable("payroll", { orderBy: "created_at" }),
    readTable("inventory", { orderBy: "created_at" }),
    readTable("feedback", { orderBy: "created_at" })
  ]);

  const projects = projectResult.error ? [] : projectResult.data;
  const expenses = expenseResult.error ? [] : expenseResult.data;
  const payroll = payrollResult.error ? [] : payrollResult.data;
  const inventory = inventoryResult.error ? [] : inventoryResult.data;
  const feedback = feedbackResult.error ? [] : feedbackResult.data;

  const totalRevenue = projects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + number(expense.amount), 0);
  const totalPayroll = payroll.reduce((sum, item) => sum + number(item.salary_amount), 0);
  const expenseRecords = expenses.length + payroll.length;
  const auditEvents = [];
  const financeOnly = isFinanceScope();
  const operationsOnly = isOperationsScope();

  projects.slice(0, 8).forEach(project => {
    addAuditEvent(
      auditEvents,
      "Project Monitoring",
      operationsOnly ? "Project record available for monitoring review" : "Project budget and contract amount available for financial review",
      project.project_title || project.project_code || "Project",
      getRecordDate(project)
    );
  });

  if (!operationsOnly) {
    expenses.slice(0, 8).forEach(expense => {
      addAuditEvent(
        auditEvents,
        "Payroll & Expenses",
        `${expense.category || "Expense"} transaction recorded`,
        peso(expense.amount),
        getRecordDate(expense)
      );
    });

    payroll.slice(0, 8).forEach(item => {
      addAuditEvent(
        auditEvents,
        "Payroll & Expenses",
        `Payroll record saved for ${item.employee_name || "employee"}`,
        peso(item.salary_amount),
        getRecordDate(item)
      );
    });
  }

  if (!financeOnly && !operationsOnly) {
    inventory.slice(0, 8).forEach(item => {
      addAuditEvent(
        auditEvents,
        "Inventory",
        "Inventory material recorded",
        item.name || "Material",
        getRecordDate(item)
      );
    });

    feedback.slice(0, 8).forEach(item => {
      addAuditEvent(
        auditEvents,
        "Proposal / Quotation & Feedback",
        `Client feedback submitted with rating ${item.rating || item.overall_satisfaction || 0}/5`,
        item.client_name || "Client",
        getRecordDate(item)
      );
    });
  }

  auditEvents.sort((a, b) => new Date(b.dateValue) - new Date(a.dateValue));

  setText("projectReportCount", projects.length);
  setText("financialScope", operationsOnly ? "-" : peso(totalRevenue));
  setText("expenseReportCount", operationsOnly ? "-" : expenseRecords);
  setText("auditCount", auditEvents.length);
  setText("reportRevenue", operationsOnly ? "-" : peso(totalRevenue));
  setText("reportExpenses", operationsOnly ? "-" : peso(totalExpenses + totalPayroll));
  setText("reportProfit", operationsOnly ? "-" : peso(totalRevenue - totalExpenses - totalPayroll));
  setText("reportFeedback", operationsOnly ? "-" : feedback.length);

  auditTable.innerHTML = auditEvents.length ? auditEvents.slice(0, 20).map(event => `
    <tr>
      <td>${formatDate(event.dateValue)}</td>
      <td>${escapeHtml(event.moduleName)}</td>
      <td>${escapeHtml(event.activity)}</td>
      <td>${escapeHtml(event.reference)}</td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="4" style="text-align:center;">No audit events available yet.</td>
    </tr>
  `;
}

applyFinanceReportScope();
applyOperationsReportScope();
loadReports();
