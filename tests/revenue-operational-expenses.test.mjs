import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../js/revenue-page.js", import.meta.url), "utf8");
function section(start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0);
  const limit = source.indexOf(end, offset + start.length);
  assert.ok(limit > offset);
  return source.slice(offset, limit);
}
const data = {
  projects: [
    { id: "approved", status: "Approved", contract_amount: 1000000, project_budget: 600000, tax_amount: 10 },
    { id: "draft", status: "Draft", contract_amount: 200000, project_budget: 100000 }
  ],
  expenses: [
    { id: "project-expense", project_id: "approved", category: "Materials", amount: 53200 },
    { id: "draft-expense", project_id: "draft", category: "Transport", amount: "9000" },
    { id: "unassigned", project_id: null, category: "Utilities", amount: 10000 },
    { id: "payroll-mirror", project_id: "approved", category: " Payroll ", amount: 150000 }
  ],
  payroll: [{ project_id: "approved", salary_amount: 155000 }]
};
const originalData = structuredClone(data);
const cards = {};
let rows;
const context = vm.createContext({
  console,
  number: value => Number(value) || 0,
  peso: value => value,
  readTable: async table => ({ data: data[table], error: null }),
  mergeProjects: projects => projects,
  getProjectDownPayments: () => ({ first: 0, second: 0, total: 0 }),
  setText: (key, value) => { cards[key] = value; },
  renderRevenueTable: () => {
    rows = vm.runInContext("revenueProjects.filter(isFinancialProject).map(getProjectFinancials)", context);
  }
});
vm.runInContext(`
  let revenueTable = null, revenueProjects = [], revenueExpenses = [], revenuePayroll = [], revenueLoadError = '';
  const FINANCIAL_PROJECT_STATUSES = new Set(['approved','ongoing','completed','complete']);
  ${section("function normalizeMatchValue(", "function isLocalProjectId(")}
  ${section("function getProjectFinancials(", "function getBudgetUsageTone(")}
  ${section("async function loadRevenue(", "async function refreshRevenueNow(")}
`, context);
await vm.runInContext("loadRevenue()", context);
assert.equal(cards.totalExpenses, 72200, "Summary includes draft and unassigned expenses, excluding payroll");
assert.equal(rows.length, 1, "Project table still excludes Draft projects");
assert.equal(rows[0].projectExpenses, 53200, "Per-project expenses retain their original scope");
assert.equal(rows[0].budgetUsed, 208200);
assert.equal(cards.totalPayroll, 155000);
assert.equal(cards.totalContract, 1000000);
assert.equal(cards.totalTaxes, 100000);
assert.equal(cards.netRevenue, 300000, "Existing budget-based Net Revenue calculation is unchanged");
assert.deepEqual(data, originalData, "Loading summary must not mutate source records");
data.expenses = [];
await vm.runInContext("loadRevenue()", context);
assert.equal(cards.totalExpenses, 0, "Empty expense records produce zero");
console.log("Revenue summary regression checks passed: all non-payroll expenses counted; project calculations and source records preserved.");
