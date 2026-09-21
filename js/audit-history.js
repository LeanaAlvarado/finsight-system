// Read immutable history with a stable cursor. Supabase caps each response;
// stopping after one SELECT silently hides older events in a growing log.
export async function readAuditLogs(client) {
  const logs = [];
  let cursor = null;
  try {
    while (true) {
      let query = client.from("audit_logs").select("*")
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false }).limit(500);
      if (cursor) {
        query = query.or(`occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`);
      }
      const { data = [], error } = await query;
      if (error) return { data: [], error };
      if (!data?.length) return { data: logs, error: null };
      const nextCursor = data[data.length - 1];
      if (cursor && nextCursor.id === cursor.id) {
        throw new Error("Audit history pagination did not advance.");
      }
      logs.push(...data);
      cursor = nextCursor;
    }
  } catch (error) {
    return { data: [], error };
  }
}
