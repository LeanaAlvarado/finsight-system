import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';

// Run with node --experimental-vm-modules tests/audit-frontend.test.mjs.
const folder = new URL('../js/', import.meta.url);
let parsed = 0;
for (const name of await readdir(folder)) {
  if (!name.endsWith('.js')) continue;
  new vm.SourceTextModule(await readFile(new URL(name, folder), 'utf8'), { identifier: name });
  parsed++;
}
console.log(`PASS syntax: ${parsed} JavaScript modules`);

const events = [];
const documentHandlers = {};
const windowHandlers = {};
const context = vm.createContext({
  document: { addEventListener(name, handler) { documentHandlers[name] = handler; } },
  window: { addEventListener(name, handler) { windowHandlers[name] = handler; } }
});
const helper = new vm.SyntheticModule(['recordAuditEvent'], function() {
  this.setExport('recordAuditEvent', async (...args) => { events.push(args); });
}, { context });
const activity = new vm.SourceTextModule(await readFile(new URL('activity-audit.js', folder), 'utf8'), { context });
await activity.link(() => helper);
await activity.evaluate();
activity.namespace.installActivityAudit('inventory.html', 'Inventory');
const control = {
  id: 'deleteItem', tagName: 'BUTTON', textContent: 'Delete material',
  getAttribute() { return null; }, hasAttribute() { return false; }
};
documentHandlers.click({ target: { closest() { return control; } } });
documentHandlers.submit({ target: { id: 'inventoryForm', password: 'never-log-me' } });
documentHandlers.change({ target: { matches() { return true; }, id: 'qty', value: 'private-input', type: 'number' } });
documentHandlers.change({ target: { matches() { return true; }, id: 'password', value: 'never-log-me', type: 'password' } });
windowHandlers.beforeprint();
assert.equal(events.length, 5);
assert.equal(events[1][0], 'Control activated: Delete material');
assert.equal(events[1][1], 'page:Inventory');
assert.equal(events[2][0], 'Form submission attempted');
assert.ok(!JSON.stringify(events).includes('never-log-me'));
assert.ok(!JSON.stringify(events).includes('private-input'));
assert.ok(!JSON.stringify(events).includes('deleted'));
control.disabled = true;
documentHandlers.click({ target: { closest() { return control; } } });
assert.equal(events.length, 5);
console.log('PASS activity: visits, clicks, submission attempts, changes, printing, no input values or false success');

const warnings = [];
let clientOptions;
let auditError = { message: 'offline' };
const helperContext = vm.createContext({
  console: { warn() {} }, fetch() {},
  document: {
    getElementById() { return warnings[0] || null; },
    createElement() { return { style: {}, setAttribute() {} }; },
    body: { prepend(element) { warnings.push(element); } }
  }
});
const sdk = new vm.SyntheticModule(['createClient'], function() {
  this.setExport('createClient', (url, key, options) => {
    clientOptions = options;
    return { rpc: async () => ({ error: auditError }) };
  });
}, { context: helperContext });
const supabase = new vm.SourceTextModule(await readFile(new URL('supabase.js', folder), 'utf8'), { context: helperContext });
await supabase.link(() => sdk);
await supabase.evaluate();
assert.equal((await supabase.namespace.recordAuditEvent('Opened')).error.message, 'offline');
assert.equal(warnings.length, 1);
assert.match(warnings[0].textContent, /could not be saved/);
auditError = null;
assert.equal((await supabase.namespace.recordAuditEvent('Opened')).error, null);
let capturedOptions;
helperContext.fetch = (url, options) => { capturedOptions = options; };
clientOptions.global.fetch('https://example.test/rest/v1/rpc/record_audit_event', {method: 'POST'});
assert.equal(capturedOptions.keepalive, true);
clientOptions.global.fetch('https://example.test/rest/v1/inventory', {method: 'GET'});
assert.equal(capturedOptions.keepalive, undefined);
console.log('PASS event helper: visible save failure and navigation keepalive limited to audit RPC');
