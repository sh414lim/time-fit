export async function loadLatestReceiptLines(documentId, rest) {
  const rows = await rest(`timefit_user_receipt_extractions?document_id=eq.${encodeURIComponent(documentId)}&select=id&order=created_at.desc,id.desc&limit=1`);
  if (!rows[0]) return [];
  return rest(`timefit_user_receipt_line_items?document_id=eq.${encodeURIComponent(documentId)}&extraction_id=eq.${encodeURIComponent(rows[0].id)}&select=*&order=line_number.asc&limit=200`);
}
// Preserve analysis history; display only rows from the newest persisted analysis.
export function latestReceiptLines(lines, extractions) {
  const latest = new Map();
  for (const e of [...extractions].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))) {
    if (!latest.has(e.document_id)) latest.set(e.document_id, e.id);
  }
  return lines.filter(line => line.extraction_id === latest.get(line.document_id));
}
