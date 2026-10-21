import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual page module while all five business queries are stalled.
const businessCalls = [];
const businessResolvers = [];
const elements = new Map();
const documentHandlers = {};
const windowHandlers = {};
const intervals = [];
const timeouts = new Map();
let timerId = 0;
let authChanged;
let removeCount = 0;
let queryCount = 0;
const data = Array.from({ length: 50 }, (_, n) => ({
  id: `${String(100 - n).padStart(8, '0')}-0000-4000-8000-000000000000`,
  occurred_at: '2026-10-21T00:00:00Z', action: 'INSERT', table_name: 'public.inventory',
  new_data: { name: `Cable ${100 - n}`, qty: n }, metadata: { actor_email: 'staff@example.test' }
}));
function element(id) {
  if (!elements.has(id)) elements.set(id, { id, innerHTML: '', textContent: '', hidden: false, disabled: false,
    style: {}, type: id === 'auditSearch' ? 'search' : 'select-one', listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    closest() { return null; } });
  return elements.get(id);
}
const channel = { on() { return this; }, subscribe() { return this; } };
const client = {
  auth: {
    async getSession() { return { data: { session: { user: { id: 'admin-1' } } } }; },
    onAuthStateChange(callback) { authChanged = callback; return { data: { subscription: { unsubscribe() {} } } }; }
  },
  channel() { return channel; }, removeChannel() { removeCount++; },
  from(table) {
    assert.equal(table, 'audit_logs');
    let cursor;
    return { select() { return this; }, order() { return this; }, limit() { return this; },
      or(value) { cursor = value; return this; }, abortSignal() { return this; },
      then(resolve) { queryCount++; resolve({ data: cursor ? [] : data, error: null }); } };
  }
};
const context = vm.createContext({
  console, AbortController,
  setTimeout(callback, ms) { const id = ++timerId; timeouts.set(id, { callback, ms }); return id; },
  clearTimeout(id) { timeouts.delete(id); },
  setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {},
  localStorage: { getItem: key => key === 'lemyu_user_role' ? 'system administrator' : null },
  document: { body: { dataset: {} }, visibilityState: 'visible', getElementById: element,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(name, callback) { documentHandlers[name] = callback; } },
  window: { addEventListener(name, callback) { windowHandlers[name] = callback; } }
});
const names = ['escapeHtml', 'formatDate', 'netPayrollAmount', 'number', 'peso', 'readTable', 'recordAuditEvent', 'setText', 'supabase'];
const helpers = new vm.SyntheticModule(names, function() {
  const functions = { escapeHtml: value => String(value).replaceAll('<', '&lt;'), formatDate: String,
    netPayrollAmount: () => 0, number: value => Number(value) || 0, peso: String,
    readTable(table) { businessCalls.push(table); return new Promise(resolve => businessResolvers.push(resolve)); },
    recordAuditEvent: async () => {}, setText(id, value) { element(id).textContent = String(value); }, supabase: client };
  for (const name of names) this.setExport(name, functions[name]);
}, { context });
const modules = new Map();
async function module(name) {
  if (modules.has(name)) return modules.get(name);
  const source = await readFile(new URL(`../js/${name}`, import.meta.url), 'utf8');
  const item = new vm.SourceTextModule(source, { context, identifier: name });
  modules.set(name, item);
  await item.link(specifier => specifier.startsWith('./supabase.js') ? helpers : module(specifier.slice(2).split('?')[0]));
  return item;
}
await (await module('reports-audit.js')).evaluate();
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(businessCalls, ['projects', 'expenses', 'payroll', 'inventory', 'feedback']);
assert.match(element('auditTable').innerHTML, /Cable 100/);
assert.equal(queryCount, 1, 'Show audit history without waiting for business reports');
assert.match(element('auditPaginationSummary').textContent, /50 matching loaded/);
await context.window.goToAuditPage(2);
assert.match(element('auditTable').innerHTML, /Cable 90/);
assert.equal(queryCount, 1, 'Already loaded pages must not refetch');
await context.window.goToAuditPage(6);
assert.equal(queryCount, 2, 'The next unloaded page must fetch on demand');
assert.equal(businessCalls.length, 5, 'Paging must not reload business reports');
// Completing report requests later must not erase independently loaded logs.
businessResolvers.forEach(resolve => resolve({ data: [], error: null }));
await new Promise(resolve => setImmediate(resolve));
assert.match(element('auditTable').innerHTML, /Cable/);
assert.match(element('latestActivityList').innerHTML, /Cable 100/);
authChanged('SIGNED_OUT', null);
assert.equal(element('auditTable').innerHTML, '');
assert.equal(element('auditLogSection').style.display, 'none');
assert.equal(removeCount, 1);
windowHandlers.pagehide();
assert.equal(removeCount, 1);
console.log('PASS page integration: audit renders before stalled reports; cached pages avoid requests; lazy paging leaves business queries alone; reports preserve logs; sign-out clears the viewer and removes its channel');
