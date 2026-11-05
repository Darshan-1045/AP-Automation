import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";

import LoadingSpinner from "../components/common/LoadingSpinner";
import StatusBadge from "../components/common/StatusBadge";
import procurementService from "../services/procurementService";
import vendorService from "../services/vendorService";

const today = new Date().toISOString().slice(0, 10);
const emptyItem = () => ({ description: "", quantity: "1", unit_price: "0" });
const emptyForm = () => ({
  po_number: "",
  vendor: "",
  po_date: today,
  expected_delivery_date: "",
  tax_amount: "0",
  status: "DRAFT",
  items: [emptyItem()],
});

const responseError = (error) => {
  const data = error.response?.data;
  if (typeof data === "string") return data;
  if (data?.detail) return data.detail;
  return data ? JSON.stringify(data) : error.message;
};

function PurchaseOrders() {
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [poData, vendorData] = await Promise.all([
        procurementService.getPurchaseOrders(),
        vendorService.getVendors(),
      ]);
      setOrders(Array.isArray(poData) ? poData : poData.results || []);
      setVendors(Array.isArray(vendorData) ? vendorData : vendorData.results || []);
      setError("");
    } catch (loadError) {
      setError(responseError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const vendorNames = useMemo(
    () => Object.fromEntries(vendors.map((vendor) => [vendor.id, vendor.vendor_name])),
    [vendors]
  );
  const filteredOrders = orders.filter((order) =>
    `${order.po_number} ${vendorNames[order.vendor] || ""}`
      .toLowerCase()
      .includes(search.toLowerCase().trim())
  );

  const resetForm = () => {
    setForm(emptyForm());
    setEditing(null);
  };

  const editOrder = (order) => {
    if (order.status !== "DRAFT") return;
    setEditing(order);
    setForm({
      po_number: order.po_number,
      vendor: String(order.vendor),
      po_date: order.po_date,
      expected_delivery_date: order.expected_delivery_date || "",
      tax_amount: order.tax_amount,
      status: order.status,
      items: order.items.map((item) => ({
        description: item.description,
        quantity: String(item.quantity),
        unit_price: String(item.unit_price),
      })),
    });
    setError("");
    setSuccess("");
  };

  const submitForm = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!form.po_number.trim() || !form.vendor || !form.items.length ||
      form.items.some((item) => !item.description.trim() || Number(item.quantity) <= 0 || Number(item.unit_price) < 0)) {
      setError("Enter a PO number, vendor, and valid item descriptions, quantities, and prices.");
      return;
    }
    try {
      setBusy(true);
      const payload = {
        ...form,
        vendor: Number(form.vendor),
        expected_delivery_date: form.expected_delivery_date || null,
        tax_amount: form.tax_amount,
        items: form.items.map((item) => ({
          description: item.description.trim(),
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      };
      if (editing) {
        await procurementService.updatePurchaseOrder(editing.id, payload);
        setSuccess("Purchase order updated.");
      } else {
        await procurementService.createPurchaseOrder(payload);
        setSuccess("Purchase order created.");
      }
      resetForm();
      await loadData();
    } catch (submitError) {
      setError(responseError(submitError));
    } finally {
      setBusy(false);
    }
  };

  const deleteOrder = async (order) => {
    if (!window.confirm(`Delete draft purchase order ${order.po_number}?`)) return;
    try {
      await procurementService.deletePurchaseOrder(order.id);
      setSuccess("Draft purchase order deleted.");
      await loadData();
    } catch (deleteError) {
      setError(responseError(deleteError));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-teal-700">
            <ClipboardList size={23} />
            <h1 className="text-2xl font-bold text-slate-900">Purchase Orders</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">Create and track vendor purchase orders.</p>
        </div>
        <button onClick={resetForm} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700">
          <Plus size={16} /> New purchase order
        </button>
      </header>

      {(error || success) && (
        <div className={`rounded-lg border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {error || success}
        </div>
      )}

      <form onSubmit={submitForm} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">{editing ? `Edit ${editing.po_number}` : "Create purchase order"}</h2>
          {editing && <button type="button" onClick={resetForm} aria-label="Close edit form"><X size={18} /></button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-slate-600">PO number<input required value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm text-slate-600">Vendor<select required value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Select vendor</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id} disabled={!vendor.is_active}>{vendor.vendor_name}{vendor.is_active ? "" : " (Inactive)"}</option>)}</select></label>
          <label className="text-sm text-slate-600">PO date<input required type="date" value={form.po_date} onChange={(e) => setForm({ ...form, po_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm text-slate-600">Expected delivery<input type="date" value={form.expected_delivery_date} onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm text-slate-600">Tax amount<input min="0" step="0.01" type="number" value={form.tax_amount} onChange={(e) => setForm({ ...form, tax_amount: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm text-slate-600">Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="DRAFT">Draft</option><option value="ISSUED">Issued</option><option value="CANCELLED">Cancelled</option></select></label>
        </div>
        <div className="space-y-3">
          {form.items.map((item, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_130px_150px_auto]">
              <input aria-label="Item description" required placeholder="Item description" value={item.description} onChange={(e) => setForm({ ...form, items: form.items.map((row, i) => i === index ? { ...row, description: e.target.value } : row) })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input aria-label="Quantity" required min="0.001" step="0.001" type="number" placeholder="Quantity" value={item.quantity} onChange={(e) => setForm({ ...form, items: form.items.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row) })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <input aria-label="Unit price" required min="0" step="0.01" type="number" placeholder="Unit price" value={item.unit_price} onChange={(e) => setForm({ ...form, items: form.items.map((row, i) => i === index ? { ...row, unit_price: e.target.value } : row) })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })} disabled={form.items.length === 1} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label="Remove item"><Trash2 size={17} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })} className="text-sm font-medium text-teal-700">+ Add item</button>
        </div>
        <button disabled={busy} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving..." : editing ? "Save changes" : "Create PO"}</button>
      </form>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-slate-800">Purchase order register</h2>
          <div className="flex gap-2">
            <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO or vendor" className="rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></div>
            <button onClick={loadData} aria-label="Refresh purchase orders" className="rounded-lg border border-slate-300 p-2 text-slate-600"><RefreshCw size={17} /></button>
          </div>
        </div>
        {loading ? <LoadingSpinner /> : filteredOrders.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No purchase orders found.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">PO number</th><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Items</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{filteredOrders.map((order) => <tr key={order.id}><td className="px-4 py-3 font-medium text-slate-800">{order.po_number}</td><td className="px-4 py-3">{vendorNames[order.vendor] || "—"}</td><td className="px-4 py-3">{order.po_date}</td><td className="px-4 py-3">{Number(order.total_amount).toLocaleString("en-IN", { style: "currency", currency: "INR" })}</td><td className="px-4 py-3">{order.items.length}</td><td className="px-4 py-3"><StatusBadge status={order.status} /></td><td className="flex gap-3 px-4 py-3"><button onClick={() => editOrder(order)} disabled={order.status !== "DRAFT"} className="font-medium text-teal-700 disabled:text-slate-300">Edit</button>{order.status === "DRAFT" && <button onClick={() => deleteOrder(order)} className="text-red-600" aria-label={`Delete ${order.po_number}`}><Trash2 size={16} /></button>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default PurchaseOrders;
