import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../js/expenses-page.js", import.meta.url), "utf8");
const start = source.indexOf("function getProjectSelectorRecords(");
const end = source.indexOf("function findLinkedPayrollExpense(", start);
assert.ok(start >= 0 && end > start);
const selectProjects = vm.runInNewContext(`(${source.slice(start, end).trim()})`);
const projects = [
  { id: "project-10", project_code: "PR_10" },
  { id: "project-2", project_code: "PR_2" }
];
const contracts = [
  { id: "contract-only", project_code: "PR_1" },
  { id: "contract-orphan", project_id: "deleted-project", project_code: "PR_3" },
  { id: "contract-linked", project_id: "project-2", project_code: "PR_2" }
];
const result = selectProjects(projects, contracts);
assert.deepEqual(Array.from(result, row => row.id), ["project-2", "project-10"]);
assert.equal(projects[0].id, "project-10", "Sorting must not mutate the loaded records");
assert.equal(selectProjects([], contracts).length, 0, "Contracts cannot substitute for projects");
assert.match(source, /getProjectSelectorRecords\(projectResult\.data\)/);
assert.doesNotMatch(source, /readTable\("smart_contracts"\)/);
console.log("Expense project selection regression checks passed.");
