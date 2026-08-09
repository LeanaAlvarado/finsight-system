import { supabase, peso, number, readTable, setText } from "./supabase.js?v=20260809-editable-serials-v149";

async function loadOwnerDashboard() {
  const [projectResult, payrollResult, expenseResult, feedbackResult] = await Promise.all([
    readTable("projects"),
    readTable("payroll"),
    readTable("expenses"),
    readTable("feedback")
  ]);

  if (projectResult.error || payrollResult.error || expenseResult.error || feedbackResult.error) {
    setText("netProfit", "Connection error");
    console.error(projectResult.error || payrollResult.error || expenseResult.error || feedbackResult.error);
    return;
  }

  const projects = projectResult.data;
  const payroll = payrollResult.data;
  const expenses = expenseResult.data;
  const feedback = feedbackResult.data;

  const totalContract = projects.reduce((sum, p) => sum + number(p.contract_amount), 0);
  const totalTax = projects.reduce((sum, p) => sum + number(p.tax_amount), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + number(e.amount), 0);
  const totalPayroll = payroll.reduce((sum, p) => sum + number(p.salary_amount), 0);

  const completed = projects.filter(p => p.status === "Completed").length;
  const ongoing = projects.filter(p => p.status === "Ongoing").length;

  setText("portfolioValue", peso(totalContract));
  setText("payrollCount", payroll.length);
  setText("expenseCount", expenses.length);
  setText("projectCount", projects.length);
  setText("feedbackCount", feedback.length);

  setText("totalContract", peso(totalContract));
  setText("totalTax", peso(totalTax));
  setText("totalExpenses", peso(totalExpenses));
  setText("netProfit", peso(totalContract - totalExpenses - totalTax));

  setText("completedProjects", completed);
  setText("ongoingProjects", ongoing);
  setText("completedBadge", "Completed Projects: " + completed);
  setText("ongoingBadge", "Ongoing Projects: " + ongoing);

  setText("payrollTrend", peso(totalPayroll * 1.05));
}

loadOwnerDashboard();

supabase
  .channel("owner-dashboard-live")
  .on("postgres_changes", { event: "*", schema: "public" }, loadOwnerDashboard)
  .subscribe();
