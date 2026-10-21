import assert from 'node:assert/strict';
import { createAuditFeed } from '../js/audit-feed.js';

const row = n => ({ id: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`,
  occurred_at: '2026-10-21T00:00:00+00:00', action: 'INSERT', table_name: 'public.inventory',
  new_data: { name: `Material ${n}`, qty: n }, metadata: { actor_email: 'admin@example.test' } });
const rows = Array.from({ length: 1523 }, (_, i) => row(1523 - i));

function mockClient(input = rows, cap = 17) {
  const mock = { rows: [...input], queries: [], removed: 0, failure: null, waiting: null };
  const channel = { on(kind, filter, callback) {
    assert.equal(kind, 'postgres_changes');
    assert.deepEqual(filter, { event: 'INSERT', schema: 'public', table: 'audit_logs' });
    mock.insert = callback; return this;
  }, subscribe(callback) { mock.status = callback; return this; } };
  mock.client = {
    channel() { return channel; }, removeChannel(value) { assert.equal(value, channel); mock.removed++; },
    from(table) {
      assert.equal(table, 'audit_logs', 'The viewer must never query business tables');
      const query = { ascending: false, cursor: null, columns: '', limit: 0, signal: null };
      const builder = {
        select(columns) { query.columns = columns; return this; },
        order(column, options) { if (column === 'occurred_at') query.ascending = options.ascending; return this; },
        limit(limit) { query.limit = limit; return this; },
        or(cursor) { query.cursor = cursor; return this; },
        abortSignal(signal) { query.signal = signal; return this; },
        then(resolve) {
          mock.queries.push(query);
          const respond = () => {
            if (mock.failure) { const error = mock.failure; mock.failure = null; resolve({ error }); return; }
            const id = query.cursor?.match(/id\.(?:lt|gt)\.([\w-]+)/)?.[1];
            const data = mock.rows.slice().sort((a, b) => query.ascending ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id))
              .filter(item => !id || (query.ascending ? item.id > id : item.id < id))
              .slice(0, Math.min(cap, query.limit));
            resolve({ data, error: null });
          };
          if (mock.waiting) mock.waiting.push(respond); else respond();
        }
      };
      return builder;
    }
  };
  return mock;
}
const storage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

const mock = mockClient();
const cached = storage();
const feed = createAuditFeed(mock.client, { scope: 'admin', storage: cached });
await feed.start();
assert.equal(mock.queries.length, 1, 'Opening must fetch exactly one bounded batch');
assert.equal(mock.queries[0].limit, 50);
assert.equal(feed.state.events.length, 17);
assert.equal(feed.state.hasMore, true, 'A lower server cap must not hide the rest of history');
const cachedValue = [...cached.values.values()][0];
assert.ok(cachedValue && !cachedValue.includes('new_data'), 'Cache presentation only, never raw snapshots');
mock.rows.unshift(row(9999)); // An append between requests must not shift old pages.
while (feed.state.hasMore) await feed.loadMore();
assert.equal(feed.state.events.length, rows.length);
assert.equal(new Set(feed.state.events.map(item => item.id)).size, rows.length);
assert.equal(cachedValue, [...cached.values.values()][0], 'Older pages must not enlarge the session cache');
assert.ok(mock.queries[1].cursor.includes('id.lt.'));
assert.equal(feed.state.events.at(-1).id, row(1).id);
console.log('PASS lazy loading: one initial batch, 1,523 tied timestamps, lower server cap, concurrent append, no skipped or duplicate history');

let renderedCache = false;
const again = mockClient();
const cachedFeed = createAuditFeed(again.client, { scope: 'admin', storage: cached,
  onChange: state => { if (state.cached && state.events.length) renderedCache = true; } });
again.failure = { message: 'offline' };
await cachedFeed.start();
assert.ok(renderedCache, 'Same-account cached events must render before revalidation completes');
assert.equal(cachedFeed.state.events.length, 17);
assert.match(cachedFeed.state.error, /offline/);
const other = createAuditFeed(mockClient([]).client, { scope: 'other-user', storage: cached });
await other.start();
assert.equal(other.state.events.length, 0);
const expired = createAuditFeed(mockClient([]).client, { scope: 'admin', storage: cached, now: () => Date.now() + 91_000 });
await expired.start();
assert.equal(expired.state.events.length, 0);
assert.equal(cached.values.size, 0);
console.log('PASS cache: immediate rendering, revalidation failure keeps records, account isolation, expiry and bounded size');

await feed.setOldestFirst(true);
assert.ok(mock.queries.at(-1).ascending);
assert.equal(feed.state.events[0].id, row(1).id);
await feed.loadMore();
assert.ok(mock.queries.at(-1).cursor.includes('id.gt.'));
assert.equal(feed.state.events.length, 34);
mock.failure = { message: 'temporary failure' };
await feed.loadMore();
assert.equal(feed.state.events.length, 34, 'A failed page must preserve already loaded history');
await feed.loadMore();
assert.equal(feed.state.events.length, 51, 'Retry resumes the same cursor');
console.log('PASS ordering and retry: oldest-first reads from the server, reverse cursor, failed page preserves history');

mock.insert({ new: row(9999) });
assert.equal(feed.state.pending, true);
assert.equal(feed.state.events.length, 51, 'Realtime inserts must not shift a page being reviewed');
await feed.refresh();
mock.status('CHANNEL_ERROR');
assert.match(feed.state.live, /periodically/);
await feed.checkLatest();
assert.equal(feed.state.pending, true, 'Head check repairs missed WebSocket events');
assert.equal(mock.queries.at(-1).columns, 'id');
feed.dispose(); feed.dispose();
assert.equal(mock.removed, 1);
const length = feed.state.events.length;
mock.insert({ new: row(10000) });
await feed.loadMore();
assert.equal(feed.state.events.length, length);
console.log('PASS realtime: audit INSERTs only, no page shifting, fallback head check and channel cleanup');

const delayed = mockClient();
const racing = createAuditFeed(delayed.client);
await racing.start();
delayed.waiting = [];
const oldRequest = racing.loadMore();
await new Promise(resolve => setImmediate(resolve));
const newRequest = racing.setOldestFirst(true);
await new Promise(resolve => setImmediate(resolve));
assert.equal(delayed.waiting.length, 2);
assert.equal(delayed.queries.at(-2).signal.aborted, true);
delayed.waiting[1](); await newRequest;
delayed.waiting[0](); await oldRequest;
assert.equal(racing.state.events.length, 17);
assert.equal(racing.state.events[0].id, row(1).id, 'Stale responses must not overwrite new sorting');
racing.dispose(); cachedFeed.dispose(); other.dispose(); expired.dispose();
console.log('PASS concurrency: superseded request aborted and stale response ignored');
