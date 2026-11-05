import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, RefreshCw } from "lucide-react";

import LoadingSpinner from "../components/common/LoadingSpinner";
import StatusBadge from "../components/common/StatusBadge";
import procurementService from "../services/procurementService";

const today = new Date().toISOString().slice(0, 10);
const readError = (error) => {
  const data = error.response?.data;
  return data?.detail || (data ? JSON.stringify(data) : error.message);
};

function GoodsReceipts() {
  const [orders, setOrders] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [purchaseOrder, setPurchaseOrder] = useState("");
  const [grnNumber, setGrnNumber] = useState("");
  const [receivedDate, setReceivedDate] = useState(today);
  const [quantities, setQuantities] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [poData, grnData] = await Promise.all([
        procurementService.getPurchaseOrders(),
        procurementService.getGoodsReceipts(),
      ]);
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

  const selectedOrder = useMemo(
    () => orders.find((order) => String(order.id) === purchaseOrder),
    [orders, purchaseOrder]
  );

  const selectOrder = (event) => {
    setPurchaseOrder(event.target.value);
    setQuantities({});
    setSuccess("");
  };

  const setItemQuantity = (itemId, key, value) => {
    setQuantities((current) => {
      const previous = { received: "0", accepted: "0", rejected: "0", ...current[itemId] };
      const next = { ...previous, [key]: value };
      if (key === "received" && Number(previous.accepted) + Number(previous.rejected) === 0) {
        next.accepted = value;
      }
      return { ...current, [itemId]: next };
    });
  };

  const submitReceipt = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const items = (selectedOrder?.items || [])
      .filter((item) => Number(quantities[item.id]?.received || 0) > 0)
      .map((item) => ({
        purchase_order_item: item.id,
        received_quantity: quantities[item.id].received,
        accepted_quantity: quantities[item.id].accepted,
        rejected_quantity: quantities[item.id].rejected,
      }));
    if (!selectedOrder || !grnNumber.trim() || items.length === 0) {
      setError("Select a purchase order, enter a GRN number, and record at least one item.");
      return;
    }
    try {
      setSubmitting(true);
      await procurementService.createGoodsReceipt({
        grn_number: grnNumber.trim(),
        purchase_order: selectedOrder.id,
        received_date: receivedDate,
        status: "OPEN",
        items,
      });
      setSuccess(`Goods receipt ${grnNumber.trim()} created.`);
      setGrnNumber("");
      setQuantities({});
      await loadData();
    } catch (submitError) {
      setError(readError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const orderNames = Object.fromEntries(orders.map((order) => [order.id, order.po_number]));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-teal-700"><PackageCheck size={23} /><h1 className="text-2xl font-bold text-slate-900">Goods Receipts</h1></div>
          <p className="mt-1 text-sm text-slate-500">Record received, accepted, and rejected PO quantities.</p>
        </div>
        <button onClick={loadData} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"><RefreshCw size={16} className={loading ? "animate-spin" : ""} />Refresh</button>
      </header>

      {(error || success) && <div className={`rounded-lg border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || success}</div>}

      <form onSubmit={submitReceipt} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">Create goods receipt note</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-slate-600">GRN number<input required value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm text-slate-600">Purchase order<select required value={purchaseOrder} onChange={selectOrder} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select PO</option>{orders.filter((order) => !["CANCELLED", "DRAFT"].includes(order.status)).map((order) => <option key={order.id} value={order.id}>{order.po_number}</option>)}</select></label>
          <label className="text-sm text-slate-600">Received date<input required type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        </div>
        {selectedOrder && <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">PO item</th><th className="px-3 py-2">Ordered</th><th className="px-3 py-2">Received</th><th className="px-3 py-2">Accepted</th><th className="px-3 py-2">Rejected</th></tr></thead><tbody className="divide-y divide-slate-100">{selectedOrder.items.map((item) => <tr key={item.id}><td className="px-3 py-2">{item.description}</td><td className="px-3 py-2">{item.quantity}</td>{["received", "accepted", "rejected"].map((key) => <td key={key} className="px-3 py-2"><input aria-label={`${key} quantity for ${item.description}`} type="number" min={key === "received" ? "0.001" : "0"} step="0.001" value={quantities[item.id]?.[key] ?? "0"} onChange={(e) => setItemQuantity(item.id, key, e.target.value)} className="w-24 rounded border border-slate-300 px-2 py-1" /></td>)}</tr>)}</tbody></table><p className="p-3 text-xs text-slate-500">For each recorded item, received quantity must equal accepted plus rejected quantities.</p></div>}
        <button disabled={submitting || loading} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "Saving..." : "Create GRN"}</button>
      </form>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 p-4 font-semibold text-slate-800">Receipt register</h2>
        {loading ? <LoadingSpinner /> : receipts.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No goods receipts recorded.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">GRN</th><th className="px-4 py-3">Purchase order</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Items</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{receipts.map((receipt) => <tr key={receipt.id}><td className="px-4 py-3 font-medium text-slate-800">{receipt.grn_number}</td><td className="px-4 py-3">{orderNames[receipt.purchase_order] || "—"}</td><td className="px-4 py-3">{receipt.received_date}</td><td className="px-4 py-3">{receipt.items.map((item) => item.received_quantity).join(", ")}</td><td className="px-4 py-3"><StatusBadge status={receipt.status} /></td></tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}

export default GoodsReceipts;
