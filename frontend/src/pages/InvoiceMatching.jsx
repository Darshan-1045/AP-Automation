import { useCallback, useEffect, useMemo, useState } from "react";
import { GitCompareArrows, RefreshCw } from "lucide-react";

import LoadingSpinner from "../components/common/LoadingSpinner";
import StatusBadge from "../components/common/StatusBadge";
import invoiceService from "../services/invoiceService";
import procurementService from "../services/procurementService";

const readError = (error) => {
  const data = error.response?.data;
  return data?.detail || data?.error || (data ? JSON.stringify(data) : error.message);
};

function InvoiceMatching() {
  const [invoices, setInvoices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [poId, setPoId] = useState("");
  const [grnId, setGrnId] = useState("");
  const [tolerance, setTolerance] = useState("0.00");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [invoiceData, poData, grnData] = await Promise.all([
        invoiceService.getInvoices(),
        procurementService.getPurchaseOrders(),
        procurementService.getGoodsReceipts(),
      ]);
      setInvoices(Array.isArray(invoiceData) ? invoiceData : invoiceData.results || []);
      setOrders(Array.isArray(poData) ? poData : poData.results || []);
      setReceipts(Array.isArray(grnData) ? grnData : grnData.results || []);
      setError("");
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => String(invoice.id) === invoiceId),
    [invoices, invoiceId]
  );
  const selectedPO = useMemo(
    () => orders.find((order) => String(order.id) === poId),
    [orders, poId]
  );
  const availableReceipts = receipts.filter((receipt) =>
    selectedPO ? receipt.purchase_order === selectedPO.id : true
  );
  const resultPO = result
    ? orders.find((order) => order.id === result.purchase_order)
    : null;
  const resultGRN = result
    ? receipts.find((receipt) => receipt.id === result.goods_receipt)
    : null;

  const selectInvoice = async (event) => {
    const id = event.target.value;
    setInvoiceId(id);
    setResult(null);
    setError("");
    if (!id) return;
    try {
      const current = await procurementService.getMatchingResult(id);
      setResult(current);
    } catch (fetchError) {
      if (fetchError.response?.status !== 404) setError(readError(fetchError));
    }
  };

  const runMatching = async (event) => {
    event.preventDefault();
    if (!invoiceId) {
      setError("Select an invoice to match.");
      return;
    }
    try {
      setRunning(true);
      setError("");
      const payload = {
        amount_tolerance: tolerance,
        ...(poId ? { purchase_order_id: Number(poId) } : {}),
        ...(grnId ? { goods_receipt_id: Number(grnId) } : {}),
      };
      setResult(await procurementService.matchInvoice(invoiceId, payload));
    } catch (matchError) {
      setError(readError(matchError));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-teal-700"><GitCompareArrows size={23} /><h1 className="text-2xl font-bold text-slate-900">Invoice Matching</h1></div>
          <p className="mt-1 text-sm text-slate-500">Compare invoice, purchase order, and accepted receipt quantities.</p>
        </div>
        <button onClick={loadData} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"><RefreshCw size={16} className={loading ? "animate-spin" : ""} />Refresh</button>
      </header>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading ? <LoadingSpinner /> : (
        <form onSubmit={runMatching} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-slate-600">Invoice<select required value={invoiceId} onChange={selectInvoice} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select invoice</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number || `Invoice #${invoice.id}`} — {invoice.vendor_name || "Unknown vendor"}</option>)}</select></label>
            <label className="text-sm text-slate-600">Purchase order (optional if invoice has PO number)<select value={poId} onChange={(e) => { setPoId(e.target.value); setGrnId(""); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Use invoice PO number</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.po_number}</option>)}</select></label>
            <label className="text-sm text-slate-600">Goods receipt note<select value={grnId} onChange={(e) => setGrnId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Use latest GRN</option>{availableReceipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.grn_number}</option>)}</select></label>
            <label className="text-sm text-slate-600">Amount tolerance<input min="0" step="0.01" type="number" value={tolerance} onChange={(e) => setTolerance(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          </div>
          {selectedInvoice && <p className="text-xs text-slate-500">Invoice PO reference: {selectedInvoice.po_number || "Not identified"}</p>}
          <button disabled={running || !invoiceId} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{running ? "Comparing..." : "Run three-way match"}</button>
        </form>
      )}

      {result && <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-slate-800">Matching result</h2><p className="text-sm text-slate-500">Result saved {result.created_at ? new Date(result.created_at).toLocaleString() : ""}</p></div>
          <StatusBadge status={result.status} />
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">PO</span><p className="font-medium">{orders.find((order) => order.id === result.purchase_order)?.po_number || "Not found"}</p></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">GRN</span><p className="font-medium">{receipts.find((receipt) => receipt.id === result.goods_receipt)?.grn_number || "Not found"}</p></div><div className="rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Amount tolerance</span><p className="font-medium">{result.amount_tolerance}</p></div></div>
        {resultPO && <div className="overflow-x-auto">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Line-item comparison</h3>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Invoiced qty</th><th className="px-3 py-2">Ordered qty</th><th className="px-3 py-2">Accepted qty</th><th className="px-3 py-2">Invoice unit price</th><th className="px-3 py-2">PO unit price</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{resultPO.items.map((item) => {
              const invoiceItem = selectedInvoice?.line_items?.find((line) =>
                (line.description || "").trim().toLowerCase() === item.description.trim().toLowerCase()
              );
              const receiptItem = resultGRN?.items?.find((line) => line.purchase_order_item === item.id);
              const mismatch = !invoiceItem || Number(invoiceItem.quantity) !== Number(item.quantity) ||
                Number(invoiceItem.unit_price) !== Number(item.unit_price) ||
                (receiptItem && Number(invoiceItem.quantity) !== Number(receiptItem.accepted_quantity));
              return <tr key={item.id} className={mismatch ? "bg-amber-50" : ""}><td className="px-3 py-2">{item.description}</td><td className="px-3 py-2">{invoiceItem?.quantity ?? "—"}</td><td className="px-3 py-2">{item.quantity}</td><td className="px-3 py-2">{receiptItem?.accepted_quantity ?? "—"}</td><td className="px-3 py-2">{invoiceItem?.unit_price ?? "—"}</td><td className="px-3 py-2">{item.unit_price}</td></tr>;
            })}</tbody>
          </table>
        </div>}
        <div><h3 className="mb-2 text-sm font-semibold text-slate-700">Exceptions</h3>{result.exceptions?.length ? <ul className="space-y-2">{result.exceptions.map((item, index) => <li key={`${item.code}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span className="font-semibold">{item.code.replaceAll("_", " ")}:</span> {item.message}</li>)}</ul> : <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">No mismatches found. Invoice passed PO and receipt checks.</p>}</div>
      </section>}
    </div>
  );
}

export default InvoiceMatching;
