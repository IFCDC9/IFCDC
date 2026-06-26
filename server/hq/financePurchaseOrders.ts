import { getDb } from "../db";
import { ensureFinanceTables, financeId, logFinanceAudit } from "./financeSchema";

export async function convertPurchaseOrderToInvoice(
  poId: string,
  actor?: { email?: string }
): Promise<{ invoice: Record<string, unknown>; purchaseOrder: Record<string, unknown> }> {
  await ensureFinanceTables();
  const db = await getDb();
  const po = await db.get<{
    id: string; po_number: string; title: string; vendor: string; description: string | null;
    amount_cents: number; status: string; invoice_id: string | null; vendor_id: string | null;
    department_id: string | null; grant_id: string | null;
  }>("SELECT * FROM finance_purchase_orders WHERE id = ?", poId);

  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "approved") throw new Error("Only approved purchase orders can be converted to invoices");
  if (po.invoice_id) {
    const existing = await db.get("SELECT * FROM finance_invoices WHERE id = ?", po.invoice_id);
    if (existing) return { invoice: existing as Record<string, unknown>, purchaseOrder: po as unknown as Record<string, unknown> };
  }

  let vendorId = po.vendor_id;
  if (!vendorId) {
    const match = await db.get<{ id: string }>("SELECT id FROM finance_vendors WHERE name = ? COLLATE NOCASE", po.vendor);
    if (match) {
      vendorId = match.id;
    } else {
      vendorId = financeId();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO finance_vendors (id, name, payment_terms, created_at, updated_at) VALUES (?, ?, 'Net 30', ?, ?)`,
        vendorId, po.vendor, now, now
      );
    }
  }

  const now = new Date().toISOString();
  const invoiceId = financeId();
  const count = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM finance_invoices WHERE invoice_type = 'payable'"))?.c ?? 0;
  const invoiceNumber = `AP-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  await db.run(
    `INSERT INTO finance_invoices (id, invoice_type, invoice_number, vendor_id, amount_cents, amount_paid_cents, status,
     issue_date, due_date, description, purchase_order_id, department_id, grant_id, created_at, updated_at)
     VALUES (?, 'payable', ?, ?, ?, 0, 'sent', ?, ?, ?, ?, ?, ?, ?, ?)`,
    invoiceId, invoiceNumber, vendorId, po.amount_cents, now.slice(0, 10), dueDate.toISOString().slice(0, 10),
    po.description ?? `PO ${po.po_number}: ${po.title}`, poId, po.department_id, po.grant_id, now, now
  );

  await db.run(
    `UPDATE finance_purchase_orders SET invoice_id = ?, vendor_id = ?, updated_at = ? WHERE id = ?`,
    invoiceId, vendorId, now, poId
  );

  await logFinanceAudit(
    "po_converted_to_invoice",
    "purchase_order",
    poId,
    `${po.po_number} → ${invoiceNumber}`,
    actor,
    po.amount_cents
  );

  const [invoice, purchaseOrder] = await Promise.all([
    db.get("SELECT * FROM finance_invoices WHERE id = ?", invoiceId),
    db.get("SELECT * FROM finance_purchase_orders WHERE id = ?", poId),
  ]);

  return { invoice: invoice as Record<string, unknown>, purchaseOrder: purchaseOrder as Record<string, unknown> };
}

export function parseTaxPeriod(period: string): { start: string; end: string } {
  const trimmed = period.trim();
  if (/^\d{4}-Q[1-4]$/i.test(trimmed)) {
    const year = trimmed.slice(0, 4);
    const q = Number(trimmed.slice(-1));
    const starts = [`${year}-01-01`, `${year}-04-01`, `${year}-07-01`, `${year}-10-01`];
    const ends = [`${year}-03-31`, `${year}-06-30`, `${year}-09-30`, `${year}-12-31`];
    return { start: starts[q - 1], end: ends[q - 1] };
  }
  if (/^\d{4}$/.test(trimmed)) return { start: `${trimmed}-01-01`, end: `${trimmed}-12-31` };
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split("-");
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return { start: `${trimmed}-01`, end: `${trimmed}-${String(lastDay).padStart(2, "0")}` };
  }
  return { start: `${new Date().getFullYear()}-01-01`, end: nowDate() };
}

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}
