/** Check real Communications Center storage using metadata-only SELECTs. No migrations or messages. */
export async function probeCommunicationsStorage(db: { get(sql: string): Promise<unknown> }): Promise<{
  ok: boolean; detail: string;
}> {
  // Match the schema actually consumed by /api/hq/communications/overview,
  // announcements and messages. WHERE 1=0 validates columns without reading mail.
  const tables = [
    ["hq_messages", "id, from_email, to_email, subject, body, channel, read_at, created_at"],
    ["hq_announcements", "id, title, body, priority, status, published_at, created_at"],
  ];
  const missing: string[] = [];
  for (const [table, columns] of tables) {
    try {
      await db.get(`SELECT ${columns} FROM ${table} WHERE 1 = 0`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no such table|relation .+ does not exist/i.test(message)) missing.push(table);
      else throw error; // A failed query is not evidence that a table is absent.
    }
  }
  return missing.length
    ? { ok: false, detail: `Communications storage missing required table(s): ${missing.join(", ")}. Check HQ schema initialization; no tables were created by this assessment.` }
    : { ok: true, detail: "hq_messages and hq_announcements required columns are readable. No message contents read, rows created, or notifications sent" };
}
