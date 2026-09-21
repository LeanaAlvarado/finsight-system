import assert from 'node:assert/strict';
import { buildAuditEvents, describeAuditLog, matchesAuditView } from '../js/audit-presentation.js';

const inventory = { id: 'item-1', name: 'Cable', qty: 10, unit: 'PCS', price: 50, project_code: 'PRJ-001' };
const log = (action, before, after, table = 'public.inventory', metadata = {}) => ({
  id: 'log-1', action, table_name: table, record_id: 'item-1', old_data: before,
  new_data: after, metadata, occurred_at: '2026-09-21T13:00:00Z'
});
const created = describeAuditLog(log('INSERT', null, inventory));
assert.equal(created.activity, 'Added inventory item “Cable” (Quantity: 10; Unit: PCS; Project code: PRJ-001)');
const updated = describeAuditLog(log('UPDATE', inventory, { ...inventory, qty: 8, price: 60 }));
assert.equal(updated.activity, 'Updated inventory item “Cable”: Quantity changed from 10 to 8; Unit price changed from PHP 50.00 to PHP 60.00');
assert.equal(updated.category, 'activity');
const deleted = describeAuditLog(log('DELETE', { ...inventory, qty: 8 }, null));
assert.equal(deleted.activity, 'Deleted inventory item “Cable” (Quantity: 8; Unit: PCS; Project code: PRJ-001)');
assert.equal(deleted.reference, 'Cable'); // Uses OLD, without looking up deleted records.
const zero = describeAuditLog(log('UPDATE', inventory, { ...inventory, qty: 0 }));
assert.match(zero.activity, /10 to 0/);
const many = describeAuditLog(log('UPDATE', inventory, { ...inventory, name: 'New cable', qty: 9, price: 1, unit: 'BOX', project_code: null }));
assert.equal(many.details.length, 5);
assert.match(many.activity, /\(\+2 more changes\)/);
assert.ok(many.details.includes('Project code changed from PRJ-001 to not set'));

const syncOnly = log('UPDATE', inventory, { ...inventory, updated_at: '2026-09-21T13:00:00Z' });
assert.equal(describeAuditLog(syncOnly).category, 'background');
const missingSnapshots = describeAuditLog(log('UPDATE', null, null));
assert.equal(missingSnapshots.category, 'activity');
assert.match(missingSnapshots.activity, /details unavailable/);
const mirror = {
  id: 'mirror', action: 'UPDATE', table_name: 'public.app_local_storage', record_id: 'lemyu_saved_inventory',
  old_data: { storage_key: 'lemyu_saved_inventory', storage_value: [inventory] },
  new_data: { storage_key: 'lemyu_saved_inventory', storage_value: [] }
};
assert.equal(describeAuditLog(mirror).category, 'background');
assert.equal(describeAuditLog(mirror).activity, 'Updated saved inventory records');
assert.equal(describeAuditLog(mirror).moduleName, 'Inventory');
const billing = { ...mirror, record_id: 'lemyu_down_payments',
  old_data: { storage_key: 'lemyu_down_payments', storage_value: { 'PRJ-001': 1000 } },
  new_data: { storage_key: 'lemyu_down_payments', storage_value: { 'PRJ-001': 2000 } }
};
assert.equal(describeAuditLog(billing).category, 'activity');
assert.match(describeAuditLog(billing).activity, /1000 to 2000/);

const beforeRole = { name: 'Manager', permissions: ['Inventory'] };
const afterRole = { ...beforeRole, permissions: ['Inventory', 'Project Monitoring'] };
assert.match(describeAuditLog(log('UPDATE', beforeRole, afterRole, 'public.roles')).activity,
  /Permissions changed from Inventory to Inventory, Project Monitoring/);
const project = { project_title: 'Office', status: 'Pending', quotation_items: [{ name: 'Cable', qty: 2 }] };
const projectUpdate = describeAuditLog(log('UPDATE', project,
  { ...project, status: 'Completed', quotation_items: [{ name: 'Cable', qty: 5 }] }, 'public.projects'));
assert.match(projectUpdate.activity, /Status changed from Pending to Completed/);
assert.match(projectUpdate.activity, /Quotation items \/ Item 1 \/ Quantity changed from 2 to 5/);
const credentials = describeAuditLog(log('UPDATE', { name: 'Ana', password_hash: 'secret-old' },
  { name: 'Ana', password_hash: 'secret-new' }, 'public.users'));
assert.match(credentials.activity, /Account credentials changed/);
assert.ok(!JSON.stringify(credentials).includes('secret-'));
const files = describeAuditLog(log('UPDATE', { file_name: 'proof.jpg', file_url: 'url?token=old' },
  { file_name: 'proof.jpg', file_url: 'url?token=new' }, 'public.project_files'));
assert.match(files.activity, /File changed/);
assert.ok(!JSON.stringify(files).includes('token='));

const moduleOpened = { id: 'visit', action: 'EVENT', table_name: 'page:Reports & Audit Logs',
  metadata: { event: 'Module opened', page: 'reports-audit.html' } };
assert.equal(describeAuditLog(moduleOpened).activity, 'Opened Reports & Audit Logs');
assert.equal(describeAuditLog(moduleOpened).reference, 'Reports & Audit Logs');
const click = { ...moduleOpened, id: 'click', table_name: 'page:Inventory',
  metadata: { event: 'Control activated: Delete', label: 'Delete', page: 'inventory.html' } };
assert.equal(describeAuditLog(click).activity, 'Clicked “Delete” in Inventory');
assert.equal(describeAuditLog(click).category, 'interaction');
assert.ok(!describeAuditLog(click).activity.includes('Deleted'));
const submit = { ...click, metadata: { event: 'Form submission attempted', form: 'inventoryForm' } };
assert.match(describeAuditLog(submit).activity, /Submitted inventory Form for saving \(attempt\)/);
assert.equal(describeAuditLog(submit).category, 'interaction');

const rows = [log('INSERT', null, inventory), log('DELETE', inventory, null), syncOnly, mirror, moduleOpened, click];
const original = JSON.stringify(rows);
const events = buildAuditEvents(rows);
assert.equal(events.length, rows.length); // Filtering never removes stored history.
assert.equal(events.filter(event => matchesAuditView(event)).length, 3);
assert.equal(events.filter(event => matchesAuditView(event, 'all')).length, 6);
assert.equal(events.filter(event => matchesAuditView(event, 'background')).length, 2);
assert.equal(events.filter(event => matchesAuditView(event, 'interaction')).length, 1);
assert.equal(JSON.stringify(rows), original);
console.log('PASS descriptions: inventory CRUD, exact old/new values, deleted references, zero/null, multi-field details, roles, nested quotations, credential privacy, legacy events and all-history views');
