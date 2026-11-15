const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=fs.existsSync('.deploy-bi-dashboard/js/business-metrics.js') ? '.deploy-bi-dashboard' : '.';
(async()=>{
 const metrics=fs.readFileSync(root+'/js/business-metrics.js','utf8');const {buildBusinessMetrics}=await import('data:text/javascript;base64,'+Buffer.from(metrics).toString('base64'));
 let source=fs.readFileSync(root+'/js/dashboard-page.js','utf8').replace(/^import .*;\r?\n/gm,'');source=source.slice(0,source.indexOf('window.viewCostAlert'));
 const ctx={buildBusinessMetrics,number:x=>Number(x)||0,peso:String,console};vm.createContext(ctx);vm.runInContext(source,ctx);
 const projects=[{id:'a',project_code:'A',status:'Approved',project_budget:1000,initial_actual_cost:850},{id:'w',status:'Ongoing',project_budget:1000,initial_actual_cost:700},{id:'z',status:'Completed',project_budget:0,initial_actual_cost:10},{id:'p',status:'Approved',project_budget:1000},{id:'draft',status:'Draft',project_budget:1}];
 const expenses=[{id:'pending',project_id:'p',amount:9999,status:'Pending'},{id:'wrong',project_id:'unknown',project_code:'A',amount:9999},{id:'mirror',project_id:'p',category:'Payroll',amount:900}];const payroll=[{id:'pay',project_id:'p',salary_amount:900}];
 const rows=buildBusinessMetrics(projects,expenses,payroll).rows;ctx.projects=projects;ctx.expenses=expenses;ctx.payroll=payroll;const alerts=vm.runInContext('buildCostOverrunAlerts(projects, expenses, [], payroll)',ctx);
 assert.equal(rows.filter(r=>['Critical','Over Budget'].includes(r.severity)).length,3);assert.equal(alerts.filter(r=>r.severity!=='Warning').length,3);assert.equal(alerts.filter(r=>r.severity==='Warning').length,1);for(const a of alerts){const row=rows.find(r=>r.project.id===a.projectId);assert.equal(a.actualExpenses,row.spending/100);assert.equal(a.severity,row.severity);}
 assert.equal(buildBusinessMetrics([{id:'a',status:'Approved',project_budget:1000,initial_actual_cost:849.99}],[],[]).rows[0].severity,'Warning');
 console.log('PASS: critical/warning reconciliation, opening costs, zero budgets, approval filtering, ID precedence, payroll deduplication, threshold boundaries.');
 const reportSource=fs.readFileSync(root+'/js/reports-audit.js','utf8');
 const render=reportSource.slice(reportSource.indexOf('function renderReports()'),reportSource.indexOf('async function readFinancialReportTable'));
 const values={};const reportCtx={buildBusinessMetrics,reportRecords:{projects,expenses,payroll,inventory:[],feedback:[]},filterByCoverage:x=>x,isReportFinancialStatus:s=>['Approved','Ongoing','Completed'].includes(s),isOperationsScope:()=>false,getReportCctvProjectMaterials:()=>[],number:x=>Number(x)||0,peso:String,setText:(id,value)=>values[id]=value,canViewAuditLogs:()=>false,auditEvents:[],auditFeed:null,getCoverageText:()=>'',getPrintCoverageText:()=>'',renderLatestActivity(){},renderReportProjectList(){},renderAuditTable(){},recordBelongsToProject:()=>false};
 vm.createContext(reportCtx);vm.runInContext(render+';renderReports()',reportCtx);assert.equal(values.reportCritical,3);assert.ok(values.reportCriticalDetails.includes('A: Critical'));console.log('PASS: report summary and critical project details match BI and bell.');
})().catch(e=>{console.error(e);process.exitCode=1});
