import { buildAuditEvents } from './audit-presentation.js?v=20260921-audit-descriptions-v259';

const BATCH_SIZE = 50;
const CACHE_TTL = 90_000;
const CACHE_PREFIX = 'finsight:audit-feed:v1:'; // Never mirrored to app_local_storage.
const COLUMNS = 'id,occurred_at,actor_id,action,table_name,record_id,old_data,new_data,metadata';

// The full-history exporter remains separate. The viewer reads one stable
// (timestamp, UUID) cursor at a time, including when timestamps are identical.
export function createAuditFeed(client, { scope, storage, onChange = () => {}, now = Date.now } = {}) {
  const state = { events: [], recentEvents: [], hasMore: true, loading: false, error: '', cached: false,
    oldestFirst: false, pending: false, live: 'Connecting to live updates...' };
  let cursor = null;
  let generation = 0;
  let request = null;
  let channel = null;
  let disposed = false;
  let latestId = null;
  const cacheKey = scope ? CACHE_PREFIX + scope : null;
  const notify = () => { if (!disposed) onChange(state); };
  const removeCache = () => { try { if (cacheKey) storage?.removeItem(cacheKey); } catch { /* Storage can be disabled. */ } };

  function restoreCache() {
    if (!cacheKey) return;
    try {
      const value = JSON.parse(storage?.getItem(cacheKey) || 'null');
      if (!value || !Number.isFinite(value.savedAt) || now() - value.savedAt > CACHE_TTL || value.savedAt > now()
        || !Array.isArray(value.events) || value.events.length > BATCH_SIZE
        || typeof value.hasMore !== 'boolean'
        || !value.events.every(event => typeof event.id === 'string' && typeof event.activity === 'string'
          && typeof event.moduleName === 'string' && Array.isArray(event.details))
        || !value.cursor?.id || !value.cursor?.occurred_at) { removeCache(); return; }
      state.events = value.events;
      state.recentEvents = value.events;
      state.hasMore = value.hasMore;
      state.cached = true;
      cursor = value.cursor;
      latestId = value.events[0]?.id;
      notify();
    } catch { removeCache(); }
  }

  async function fetchBatch(reset = false) {
    if (disposed || (!reset && (state.loading || !state.hasMore))) return;
    const version = reset ? ++generation : generation;
    if (reset) { request?.abort(); state.pending = false; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    request = controller;
    const previousCursor = reset ? null : cursor;
    state.loading = true;
    state.error = '';
    notify();
    try {
      let query = client.from('audit_logs').select(COLUMNS)
        .order('occurred_at', { ascending: state.oldestFirst })
        .order('id', { ascending: state.oldestFirst }).limit(BATCH_SIZE);
      if (previousCursor) {
        const op = state.oldestFirst ? 'gt' : 'lt';
        query = query.or(`occurred_at.${op}.${previousCursor.occurred_at},and(occurred_at.eq.${previousCursor.occurred_at},id.${op}.${previousCursor.id})`);
      }
      const { data = [], error } = await query.abortSignal(controller.signal);
      if (disposed || generation !== version) return;
      if (error) throw error;
      const tail = data?.at(-1);
      if (tail && previousCursor?.id === tail.id) throw new Error('Audit history pagination did not advance.');
      const incoming = buildAuditEvents(data || []);
      const events = reset ? [] : state.events;
      const ids = new Set(events.map(event => event.id));
      state.events = [...events, ...incoming.filter(event => !ids.has(event.id))];
      if (!state.oldestFirst) state.recentEvents = state.events;
      cursor = tail ? { id: tail.id, occurred_at: tail.occurred_at } : previousCursor;
      // Do not assume the configured PostgREST cap equals our requested limit.
      state.hasMore = Boolean(data?.length);
      state.cached = false;
      if (reset) {
        if (!state.oldestFirst) {
          latestId = data?.[0]?.id || null;
          state.recentEvents = incoming;
        }
        if (!state.oldestFirst && cacheKey && tail) {
          const serialized = JSON.stringify({ savedAt: now(), events: incoming, cursor, hasMore: state.hasMore });
          try { if (serialized.length <= 200_000) storage?.setItem(cacheKey, serialized); else removeCache(); } catch { /* Quota is optional. */ }
        } else if (!data?.length && !state.oldestFirst) removeCache();
      }
    } catch (error) {
      if (!disposed && generation === version) {
        state.error = controller.signal.aborted ? 'The request timed out. Try again.' : error.message || 'Unable to load audit history.';
      }
    } finally {
      clearTimeout(timeout);
      if (!disposed && generation === version) { state.loading = false; notify(); }
    }
  }

  function markPending() { if (!disposed) { state.pending = true; notify(); } }

  function connect() {
    if (disposed || channel) return;
    channel = client.channel('finsight-audit-viewer')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, markPending)
      .subscribe(status => {
        if (disposed) return;
        state.live = status === 'SUBSCRIBED' ? 'Live updates connected.' : 'Live connection unavailable; checking periodically.';
        // A reconnect may have missed inserts. The next head check repairs it.
        if (status === 'SUBSCRIBED') void checkLatest();
        notify();
      });
  }

  async function checkLatest() {
    if (disposed || state.loading || state.pending) return;
    const version = generation;
    try {
      const { data, error } = await client.from('audit_logs').select('id')
        .order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(1);
      if (!error && !disposed && generation === version && data?.[0]?.id && data[0].id !== latestId) {
        latestId = data[0].id;
        markPending();
      }
    } catch { /* Keep the loaded records on a transient network failure. */ }
  }

  return {
    state,
    async start() { restoreCache(); connect(); await fetchBatch(true); },
    loadMore: () => fetchBatch(),
    refresh: () => fetchBatch(true),
    async setOldestFirst(value) {
      if (Boolean(value) === state.oldestFirst) return;
      state.oldestFirst = Boolean(value);
      state.events = []; cursor = null; state.hasMore = true;
      await fetchBatch(true);
    },
    checkLatest,
    clearCache: removeCache,
    dispose() {
      disposed = true; generation++; request?.abort();
      if (channel) { void client.removeChannel(channel); channel = null; }
    }
  };
}
