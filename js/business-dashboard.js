
import { buildBusinessMetrics } from './business-metrics.js?v=20261109-bi';
const charts = new Map();
const money = cents => 'PHP ' + (cents / 100).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
const colors = ['#244e78','#14a89a','#e5a541','#a36bca','#d76662','#8093a8'];
export function renderGraphDashboard(projects, expenses, payroll) {
 const m = buildBusinessMetrics(projects, expenses, payroll);
 const text = (id,value) => { const e=document.getElementById(id); if(e) e.textContent=value; };
 text('totalRevenue',money(m.totals.contract)); text('totalExpenses',money(m.totals.spending));
 text('netProfit',money(m.totals.expected)); text('profitMarginKpi',m.totals.margin === null ? 'N/A' : m.totals.margin.toFixed(2)+'%');
 text('projectCount',m.rows.length); text('criticalProjectCount',m.rows.filter(r => r.utilization >= 85 || (r.budget <= 0 && r.spending > 0)).length);
 text('biScope',m.rows.length + ' approved, ongoing and completed projects • All recorded dates • Amounts in PHP');
 text('biQuality',m.rows.length ? (m.excluded + ' unlinked, out-of-scope or unapproved cost records excluded. ' + money(m.undated) + ' of spending has no transaction date and is excluded from the monthly chart.') : 'No eligible projects. Add or approve a project to begin.');
 const chart = (id,type,labels,datasets,opts={}) => {
   const canvas=document.getElementById(id); if(!canvas) return;
   charts.get(id)?.destroy();
   const empty=!labels.length || !datasets.some(d => d.data.some(v => Number(v)!==0));
   const note=canvas.parentElement.querySelector('.bi-empty'); if(note) note.hidden=!empty;
   canvas.hidden=empty;
   if(empty) return;
   if(typeof Chart === 'undefined') { canvas.hidden=true; if(note) {note.hidden=false; note.textContent='Chart unavailable. See the accessible data table below.';} return; }
   const doughnut=type==='doughnut';
   charts.set(id,new Chart(canvas,{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,
    indexAxis:opts.horizontal?'y':'x',interaction:{mode:'index',intersect:false},
    plugins:{legend:{position:'bottom'},tooltip:{callbacks:{label:c=>c.dataset.label+': '+(opts.count ? c.raw+' projects' : money(c.raw))}}},
    ...(doughnut?{cutout:'65%'}:{scales:{[opts.horizontal?'x':'y']:{beginAtZero:true,ticks:{callback:v=>opts.count?v:'₱'+(v/100).toLocaleString('en-PH',{notation:'compact'})}},[opts.horizontal?'y':'x']:{grid:{display:false}}}})
   }}));
 };
 const dataset=(label,data,color)=>({label,data,backgroundColor:color,borderColor:color,borderRadius:4,maxBarThickness:28});
 const ranked=[...m.rows].sort((a,b)=>b.contract-a.contract).slice(0,8);
 chart('salesChart','bar',ranked.map(r=>r.label),[dataset('Contract value',ranked.map(r=>r.contract),colors[0]),dataset('Planned budget',ranked.map(r=>r.budget),colors[2])],{horizontal:true});
 chart('expenseCategoryChart','doughnut',m.categories.map(c=>c[0]),[{label:'Recorded cost',data:m.categories.map(c=>c[1]),backgroundColor:colors}]);
 const budget=[...m.rows].sort((a,b)=> (b.utilization ?? (b.spending>0?Infinity:-Infinity))-(a.utilization ?? (a.spending>0?Infinity:-Infinity))).slice(0,8);
 chart('biBudgetChart','bar',budget.map(r=>r.label),[dataset('Planned budget',budget.map(r=>r.budget),colors[0]),dataset('Recorded spending',budget.map(r=>r.spending),budget.map(r=>r.spending>r.budget?colors[4]:colors[1]))],{horizontal:true});
 chart('biTrendChart','bar',m.monthly.map(c=>c[0]),[dataset('Recorded spending',m.monthly.map(c=>c[1]),colors[1])]);
 const contribution=[...m.rows].sort((a,b)=>b.expected-a.expected).slice(0,8);
 chart('biContributionChart','bar',contribution.map(r=>r.label),[dataset('Expected contribution',contribution.map(r=>r.expected),contribution.map(r=>r.expected<0?colors[4]:colors[1]))],{horizontal:true});
 const states=new Map(); for(const r of m.rows){const s=String(r.project.status).trim();states.set(s,(states.get(s)||0)+1);}
 chart('biStatusChart','doughnut',[...states.keys()],[{label:'Project status',data:[...states.values()],backgroundColor:colors}],{count:true});
 text('biBudgetSummary',money(m.totals.spending)+' recorded / '+money(m.totals.budget)+' planned');
 text('biContributionSummary','Expected margin: '+(m.totals.margin===null?'N/A':m.totals.margin.toFixed(2)+'%'));
 const body=document.getElementById('biDataRows'); body.replaceChildren();
 for(const r of m.rows){const tr=document.createElement('tr');for(const value of [r.label,money(r.contract),money(r.budget),money(r.tax),money(r.spending),money(r.remaining),r.utilization===null?'No budget':r.utilization.toFixed(2)+'%',money(r.expected)]) {const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}
 const totals=document.getElementById('biTotals'); totals.replaceChildren();
 for(const value of ['Portfolio total',money(m.totals.contract),money(m.totals.budget),money(m.totals.tax),money(m.totals.spending),money(m.totals.budget-m.totals.spending),'—',money(m.totals.expected)]) {const td=document.createElement('td');td.textContent=value;totals.append(td);}
}
