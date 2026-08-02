import { supabase, peso, escapeHtml, formatDate, insertWithOptionalColumns, number, readTable, setText, updateWithOptionalColumns } from "./supabase.js";

let projectRecords = [];
let expenseRecords = [];
let payrollRecords = [];
let editingPayrollId = null;
let editingExpenseId = null;
const EXPENSE_PROOF_BUCKETS = ["expense-proofs", "expenses", "receipts", "proofs", "progress-files", "contracts"];
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

function isOperationsScope() {
  return document.body.dataset.roleScope === "operations"
    || String(localStorage.getItem("lemyu_user_role") || "").toLowerCase() === "project manager/operations staff";
}

function applyOperationsExpenseScope() {
  if (!isOperationsScope()) return;

  const heroTitle = document.querySelector(".hero h1");
  const heroText = document.querySelector(".hero p");
  if (heroTitle) heroTitle.textContent = "Expense Upload";
  if (heroText) heroText.textContent = "Upload external project expenses only.";

  document.querySelector(".grid")?.remove();
  document.querySelector("#payrollForm")?.closest(".card")?.remove();
  document.querySelector("#payrollTable")?.closest(".card")?.remove();

  const expenseListCard = document.querySelector("#expenseTable")?.closest(".card");
  if (expenseListCard) {
    expenseListCard.querySelector("h3").innerHTML = `<span class="num">02</span> Uploaded Expenses`;
    const helperText = expenseListCard.querySelector(".muted");
    if (helperText) helperText.textContent = "Review external expenses uploaded for project operations.";
  }

  const expenseCard = document.querySelector("#expenseForm")?.closest(".card");
  if (expenseCard) {
    expenseCard.querySelector("h3").innerHTML = `<span class="num">01</span> Upload Expense`;
    const helperText = expenseCard.querySelector(".muted");
    if (helperText) helperText.textContent = "Record external costs spent for a selected project.";
  }
}

async function uploadExpenseProof(file) {
  if (!file) return null;

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filePath = `expense-proofs/${Date.now()}_${safeName}`;
  let lastError = null;

  for (const bucket of EXPENSE_PROOF_BUCKETS) {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file);

    if (!uploadError) {
      const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      return {
        fileName: file.name,
        fileUrl: data.publicUrl
      };
    }

    lastError = uploadError;

    if (!/bucket/i.test(uploadError.message || "")) {
      break;
    }
  }

  throw lastError || new Error("Unable to upload proof of expense.");
}

function getProofUrl(expense) {
  return expense.proof_url || expense.receipt_url || expense.photo_url || expense.attachment_url || expense.file_url || "";
}

function getProofName(expense) {
  return expense.proof_name || expense.receipt_name || expense.photo_name || expense.attachment_name || expense.file_name || "Open proof";
}

function renderProofLink(expense) {
  const proofUrl = getProofUrl(expense);
  if (!proofUrl) return "-";
  return `<a href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">${escapeHtml(getProofName(expense))}</a>`;
}

function parseAmountInput(input, { required = true } = {}) {
  const rawValue = String(input?.value ?? "").trim();

  if (!rawValue && !required) {
    input?.setCustomValidity("");
    return 0;
  }

  if (!rawValue || !AMOUNT_PATTERN.test(rawValue)) {
    input?.setCustomValidity("Please enter a valid amount.");
    input?.reportValidity();
    input?.focus();
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    input?.setCustomValidity("Please enter a valid amount.");
    input?.reportValidity();
    input?.focus();
    return null;
  }

  input.setCustomValidity("");
  return parsed;
}

function normalizeAmountInput(input) {
  const parsed = parseAmountInput(input, { required: input?.required });
  if (parsed === null) return;
  input.value = String(parsed);
}

function resetExpenseForm() {
  const form = document.getElementById("expenseForm");
  const submitBtn = document.getElementById("expenseSubmitBtn");
  const cancelBtn = document.getElementById("cancelExpenseEditBtn");

  editingExpenseId = null;
  form?.reset();
  if (submitBtn) submitBtn.textContent = "Save Expense";
  if (cancelBtn) cancelBtn.style.display = "none";
}

function resetPayrollForm() {
  const form = document.getElementById("payrollForm");
  const submitBtn = document.getElementById("payrollSubmitBtn");
  const cancelBtn = document.getElementById("cancelPayrollEditBtn");

  editingPayrollId = null;
  form?.reset();
  if (deduction_amount) deduction_amount.value = "0";
  if (work_days) work_days.value = "0";
  if (submitBtn) submitBtn.textContent = "Save Payroll";
  if (cancelBtn) cancelBtn.style.display = "none";
}

function getProjectName(projectId, record = {}) {
  const project = projectRecords.find(item => item.id == projectId);
  return project
    ? project.project_title
    : record.project_title || record.project_code || "No related project";
}

function getSelectedExpenseProject() {
  return projectRecords.find(project => String(project.id || "") === String(projectSelect.value || ""));
}

function getProjectSnapshot(projectId) {
  const project = projectRecords.find(item => String(item.id || "") === String(projectId || ""));
  return {
    project_code: project?.project_code || "",
    project_title: project?.project_title || "",
    client_name: project?.client_name || ""
  };
}

function findLinkedPayrollExpense(payroll = {}) {
  const oldDescription = `Payroll for ${payroll.employee_name || ""}`;
  return expenseRecords.find(expense => {
    return String(expense.category || "").toLowerCase() === "payroll"
      && String(expense.project_id || "") === String(payroll.project_id || "")
      && String(expense.date || expense.expense_date || "").slice(0, 10) === String(payroll.pay_date || "").slice(0, 10)
      && number(expense.amount) === number(payroll.salary_amount)
      && String(expense.description || "") === oldDescription;
  });
}

async function syncPayrollExpense(payrollRecord, previousPayroll = null) {
  const projectSnapshot = getProjectSnapshot(payrollRecord.project_id);
  const expenseRecord = {
    ...projectSnapshot,
    project_id: payrollRecord.project_id || null,
    category: "Payroll",
    amount: payrollRecord.salary_amount,
    date: payrollRecord.pay_date || null,
    expense_date: payrollRecord.pay_date || null,
    description: "Payroll for " + payrollRecord.employee_name
  };

  const optionalColumns = ["date", "expense_date", "project_code", "project_title", "client_name"];
  const linkedExpense = previousPayroll ? findLinkedPayrollExpense(previousPayroll) : null;
  return linkedExpense
    ? updateWithOptionalColumns("expenses", expenseRecord, "id", linkedExpense.id, optionalColumns)
    : insertWithOptionalColumns("expenses", expenseRecord, optionalColumns);
}

function populateProjectSelects() {
  const payrollProjectSelect = document.getElementById("project_id");
  const expenseProjectSelect = document.getElementById("projectSelect");

  if (payrollProjectSelect) {
    payrollProjectSelect.innerHTML = `<option value="">No related project</option>`;
  }

  if (expenseProjectSelect) {
    expenseProjectSelect.innerHTML = `<option value="">Select Project</option>`;
  }

  projectRecords.forEach(project => {
    const projectName = project.project_title || project.project_code || project.client_name || "Untitled Project";

    if (payrollProjectSelect) {
      payrollProjectSelect.innerHTML += `<option value="${project.id}">${escapeHtml(projectName)}</option>`;
    }

    if (expenseProjectSelect) {
      expenseProjectSelect.innerHTML += `<option value="${project.id}">${escapeHtml(projectName)}</option>`;
    }
  });
}

async function loadPayrollAndExpenses() {
  const [projectResult, payrollResult, expenseResult] = await Promise.all([
    readTable("projects"),
    readTable("payroll", { orderBy: "created_at" }),
    readTable("expenses", { orderBy: "created_at" })
  ]);

  if (projectResult.error || payrollResult.error || expenseResult.error) {
    alert("Error loading payroll and expenses: " + (projectResult.error || payrollResult.error || expenseResult.error).message);
    return;
  }

  const projects = projectResult.data;
  const payroll = payrollResult.data;
  const expenses = expenseResult.data;
  projectRecords = projects;
  payrollRecords = payroll;
  expenseRecords = expenses;
  populateProjectSelects();

  const revenueTotal = projects.reduce((sum, project) => sum + number(project.contract_amount), 0);
  const payrollTotal = payroll.reduce((sum, item) => sum + number(item.salary_amount), 0);
  const deductionTotal = payroll.reduce((sum, item) => sum + number(item.deduction_amount), 0);
  const expenseTotal = expenses.reduce((sum, item) => sum + number(item.amount), 0);

  setText("totalPayroll", peso(payrollTotal));
  setText("totalExpenses", peso(expenseTotal));
  setText("netPayroll", peso(payrollTotal - deductionTotal));
  setText("operatingBalance", peso(revenueTotal - expenseTotal));

  const payrollTableBody = document.getElementById("payrollTable");
  if (payrollTableBody) {
    payrollTableBody.innerHTML = payroll.length ? payroll.map(item => {
      const salary = number(item.salary_amount);
      const deduction = number(item.deduction_amount);
      const netPay = salary - deduction;

      return `
        <tr>
          <td>${escapeHtml(item.employee_name || "-")}</td>
          <td>${peso(salary)}</td>
          <td>${escapeHtml(item.deduction_type || "No Deduction")}</td>
          <td>${peso(deduction)}</td>
          <td class="${netPay >= 0 ? "good" : "bad"}">${peso(netPay)}</td>
          <td>${number(item.work_days)}</td>
          <td>${escapeHtml(getProjectName(item.project_id, item))}</td>
          <td><span class="badge ${escapeHtml(item.payment_status || "Paid")}">${escapeHtml(item.payment_status || "Paid")}</span></td>
          <td>${formatDate(item.pay_date)}</td>
          <td>${escapeHtml(item.description || "")}</td>
          <td>
            <button type="button" onclick="editPayroll('${item.id}')">Edit</button>
            <button type="button" class="danger-btn" onclick="deletePayroll('${item.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("") : `
      <tr>
        <td colspan="11" style="text-align:center;">No payroll records yet.</td>
      </tr>
    `;
  }

  const expenseTableBody = document.getElementById("expenseTable");
  if (expenseTableBody) {
    expenseTableBody.innerHTML = expenses.length ? expenses.map(item => `
      <tr>
        <td>${escapeHtml(getProjectName(item.project_id, item))}</td>
        <td>${escapeHtml(item.category || "-")}</td>
        <td>${peso(item.amount)}</td>
        <td>${formatDate(item.date || item.expense_date)}</td>
        <td>${escapeHtml(item.description || "")}</td>
        <td>${renderProofLink(item)}</td>
        <td>
          <button type="button" onclick="editExpense('${item.id}')">Edit</button>
          <button type="button" class="danger-btn" onclick="deleteExpense('${item.id}')">Delete</button>
        </td>
      </tr>
    `).join("") : `
      <tr>
        <td colspan="7" style="text-align:center;">No expense records yet.</td>
      </tr>
    `;
  }
}

window.editPayroll = function(id) {
  const payroll = payrollRecords.find(item => String(item.id || "") === String(id || ""));

  if (!payroll) {
    alert("Payroll record was not found. Please refresh the page and try again.");
    return;
  }

  editingPayrollId = id;
  employee_name.value = payroll.employee_name || "";
  project_id.value = payroll.project_id || "";
  pay_date.value = (payroll.pay_date || "").slice(0, 10);
  salary_amount.value = number(payroll.salary_amount);
  deduction_type.value = payroll.deduction_type === "No Deduction" ? "" : (payroll.deduction_type || "");
  deduction_amount.value = number(payroll.deduction_amount);
  work_days.value = number(payroll.work_days);
  payment_status.value = payroll.payment_status || "Paid";
  payroll_description.value = payroll.description || "";

  const submitBtn = document.getElementById("payrollSubmitBtn");
  const cancelBtn = document.getElementById("cancelPayrollEditBtn");
  if (submitBtn) submitBtn.textContent = "Update Payroll";
  if (cancelBtn) cancelBtn.style.display = "inline-block";

  document.getElementById("payrollForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.deletePayroll = async function(id) {
  if (!confirm("Delete this payroll record?")) return;

  const payroll = payrollRecords.find(item => String(item.id || "") === String(id || ""));
  const linkedExpense = payroll ? findLinkedPayrollExpense(payroll) : null;

  const { error } = await supabase
    .from("payroll")
    .delete()
    .eq("id", id);

  if (error) {
    alert("Error deleting payroll: " + error.message);
    return;
  }

  if (linkedExpense?.id) {
    const { error: expenseError } = await supabase
      .from("expenses")
      .delete()
      .eq("id", linkedExpense.id);

    if (expenseError) {
      alert("Payroll deleted, but linked payroll expense was not deleted: " + expenseError.message);
      await loadPayrollAndExpenses();
      return;
    }
  }

  alert("Payroll deleted successfully.");
  resetPayrollForm();
  await loadPayrollAndExpenses();
};

window.editExpense = function(id) {
  const expense = expenseRecords.find(item => String(item.id || "") === String(id || ""));

  if (!expense) {
    alert("Expense record was not found. Please refresh the page and try again.");
    return;
  }

  editingExpenseId = id;
  projectSelect.value = expense.project_id || "";
  category.value = expense.category || "";
  amount.value = number(expense.amount);
  date.value = (expense.date || expense.expense_date || "").slice(0, 10);
  expense_description.value = expense.description || "";

  const proofInput = document.getElementById("expenseProof");
  if (proofInput) proofInput.value = "";

  const submitBtn = document.getElementById("expenseSubmitBtn");
  const cancelBtn = document.getElementById("cancelExpenseEditBtn");
  if (submitBtn) submitBtn.textContent = "Update Expense";
  if (cancelBtn) cancelBtn.style.display = "inline-block";

  document.getElementById("expenseForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.deleteExpense = async function(id) {
  if (!confirm("Delete this expense record?")) return;

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id);

  if (error) {
    alert("Error deleting expense: " + error.message);
    return;
  }

  alert("Expense deleted successfully.");
  resetExpenseForm();
  await loadPayrollAndExpenses();
};

document.getElementById("payrollForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const salary = parseAmountInput(salary_amount);
  if (salary === null) return;

  const deduction = parseAmountInput(deduction_amount, { required: false });
  if (deduction === null) return;
  const projectSnapshot = getProjectSnapshot(project_id.value);
  const payrollProjectSnapshot = {
    project_code: projectSnapshot.project_code,
    project_title: projectSnapshot.project_title
  };

  const payrollRecord = {
    ...payrollProjectSnapshot,
    employee_name: employee_name.value,
    project_id: project_id.value || null,
    pay_date: pay_date.value || null,
    salary_amount: salary,
    deduction_type: deduction_type.value || "No Deduction",
    deduction_amount: deduction,
    work_days: number(work_days.value),
    payment_status: payment_status.value,
    description: payroll_description.value
  };

  const optionalPayrollColumns = [
    "project_code",
    "project_title",
    "deduction_type",
    "deduction_amount",
    "work_days",
    "payment_status"
  ];

  const previousPayroll = editingPayrollId
    ? payrollRecords.find(item => String(item.id || "") === String(editingPayrollId || ""))
    : null;

  const payrollResult = editingPayrollId
    ? await updateWithOptionalColumns("payroll", payrollRecord, "id", editingPayrollId, optionalPayrollColumns)
    : await insertWithOptionalColumns("payroll", payrollRecord, optionalPayrollColumns);

  if (payrollResult.error) {
    alert("Error saving payroll: " + payrollResult.error.message);
    return;
  }

  const payrollExpenseResult = await syncPayrollExpense(payrollRecord, previousPayroll);

  if (payrollExpenseResult.error) {
    alert("Payroll was saved, but the linked expense failed: " + payrollExpenseResult.error.message);
    return;
  }

  alert(editingPayrollId ? "Payroll updated successfully." : "Payroll saved successfully.");
  resetPayrollForm();
  await loadPayrollAndExpenses();
});

document.getElementById("expenseForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const proofFile = document.getElementById("expenseProof")?.files?.[0] || null;
  const expenseAmount = parseAmountInput(amount);
  if (expenseAmount === null) return;

  let uploadedProof = null;

  if (proofFile) {
    try {
      uploadedProof = await uploadExpenseProof(proofFile);
    } catch (error) {
      alert("Proof upload error: " + error.message);
      return;
    }
  }

  const expenseRecord = {
    project_code: getSelectedExpenseProject()?.project_code || "",
    project_title: getSelectedExpenseProject()?.project_title || "",
    client_name: getSelectedExpenseProject()?.client_name || "",
    project_id: projectSelect.value || null,
    category: category.value,
    amount: expenseAmount,
    date: date.value,
    expense_date: date.value,
    description: expense_description.value,
    proof_url: uploadedProof?.fileUrl || "",
    proof_name: uploadedProof?.fileName || "",
    receipt_url: uploadedProof?.fileUrl || "",
    receipt_name: uploadedProof?.fileName || ""
  };

  if (editingExpenseId && !uploadedProof) {
    const currentExpense = expenseRecords.find(item => String(item.id || "") === String(editingExpenseId || "")) || {};
    expenseRecord.proof_url = currentExpense.proof_url || "";
    expenseRecord.proof_name = currentExpense.proof_name || "";
    expenseRecord.receipt_url = currentExpense.receipt_url || "";
    expenseRecord.receipt_name = currentExpense.receipt_name || "";
  }

  const optionalExpenseColumns = [
    "date",
    "expense_date",
    "project_code",
    "project_title",
    "client_name",
    "proof_url",
    "proof_name",
    "receipt_url",
    "receipt_name"
  ];

  const expenseResult = editingExpenseId
    ? await updateWithOptionalColumns("expenses", expenseRecord, "id", editingExpenseId, optionalExpenseColumns)
    : await insertWithOptionalColumns("expenses", expenseRecord, optionalExpenseColumns);

  if (expenseResult.error) {
    alert("Error saving expense: " + expenseResult.error.message);
    return;
  }

  alert(editingExpenseId ? "Expense updated successfully." : "Expense saved successfully.");
  resetExpenseForm();
  await loadPayrollAndExpenses();
});

document.getElementById("cancelExpenseEditBtn")?.addEventListener("click", resetExpenseForm);
document.getElementById("cancelPayrollEditBtn")?.addEventListener("click", resetPayrollForm);

document.querySelectorAll(".amount-input").forEach(input => {
  input.addEventListener("keydown", event => {
    if (["e", "E", "+", "-"].includes(event.key)) {
      event.preventDefault();
    }
  });

  input.addEventListener("input", () => {
    input.setCustomValidity("");
  });

  input.addEventListener("blur", () => {
    if (String(input.value || "").trim()) {
      normalizeAmountInput(input);
    }
  });
});

applyOperationsExpenseScope();
loadPayrollAndExpenses();

