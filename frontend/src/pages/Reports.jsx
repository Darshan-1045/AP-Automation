import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";

import LoadingSpinner from "../components/common/LoadingSpinner";
import StatusBadge from "../components/common/StatusBadge";
import api from "../services/api";
import vendorService from "../services/vendorService";

const reportOptions = [
  ["invoice_status", "Invoice Status"],
  ["aging", "Accounts Payable Aging"],
  ["pending_approval", "Pending Approval"],
  ["payments", "Payment Report"],
  ["vendors", "Vendor Report"],
  ["exceptions", "Exception Report"],
  ["tax", "GST / Tax Report"],
  ["po_matching", "PO Matching Report"],
  ["audit", "Audit Log Report"],
];

const reportColumns = {
  invoice_status: [
    "invoice_number", "vendor_name", "invoice_date", "due_date",
    "status", "total_amount", "currency",
  ],
  aging: [
    "invoice_number", "vendor_name", "invoice_date", "due_date",
    "status", "total_amount", "aging_bucket", "overdue_days",
  ],
  pending_approval: [
    "invoice_number", "vendor_name", "total_amount", "submitted_at",
    "status", "approval_level",
  ],
  payments: [
    "invoice_number", "vendor_name", "payment_date", "payment_reference",
    "payment_method", "payment_amount", "currency", "status",
  ],
  vendors: [
    "vendor_name", "invoice_count", "total_amount", "paid_amount",
    "outstanding_amount",
  ],
  exceptions: [
    "invoice_number", "vendor_name", "exception_reason",
    "total_amount", "currency", "status",
  ],
  tax: [
    "invoice_number", "vendor_name", "invoice_date", "status",
    "total_amount", "tax_amount", "currency",
  ],
  po_matching: [
    "invoice_number", "vendor_name", "po_number", "grn_number",
    "matching_status", "exceptions", "total_amount", "created_at",
  ],
  audit: [
    "timestamp", "actor", "action", "entity_type", "entity_id", "details",
  ],
};

const columnLabels = {
  invoice_number: "Invoice number",
  vendor_name: "Vendor",
  invoice_date: "Invoice date",
  due_date: "Due date",
  total_amount: "Invoice amount",
  payment_amount: "Payment amount",
  payment_date: "Payment date",
  payment_reference: "Payment reference",
  payment_method: "Payment method",
  aging_bucket: "Aging bucket",
  overdue_days: "Overdue days",
  submitted_at: "Submitted at",
  approval_level: "Completed approval level",
  exception_reason: "Exception reason",
  paid_amount: "Paid amount",
  outstanding_amount: "Outstanding amount",
  tax_amount: "Tax amount",
  po_number: "PO number",
  grn_number: "GRN number",
  matching_status: "Matching status",
  created_at: "Match date",
  timestamp: "Timestamp",
  actor: "Actor",
  action: "Action",
  entity_type: "Entity type",
  entity_id: "Entity ID",
  details: "Event details",
};

const amountColumns = new Set([
  "total_amount",
  "payment_amount",
  "paid_amount",
  "outstanding_amount",
  "tax_amount",
]);

const getError = (error) => {
  const data = error.response?.data;
  return data?.detail || (data ? JSON.stringify(data) : error.message);
};

const formatAmount = (value, currency = "INR") => {
  if (value === "" || value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const formatDate = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("en-IN", {
      dateStyle: "medium",
      ...(value.includes("T") ? { timeStyle: "short" } : {}),
    });
};

const formatCell = (column, value, row) => {
  if (value === null || value === undefined || value === "") return "—";
  if (amountColumns.has(column)) return formatAmount(value, row.currency || "INR");
  if (["invoice_date", "due_date", "payment_date", "submitted_at", "created_at", "timestamp"].includes(column)) {
    return formatDate(value);
  }
  if (column === "payment_method") return String(value).replaceAll("_", " ");
  if (typeof value === "object") return JSON.stringify(value);
  return value;
};

function Reports() {
  const [reportType, setReportType] = useState("invoice_status");
  const [filters, setFilters] = useState({
    from_date: "",
    to_date: "",
    vendor: "",
    status: "",
    action: "",
    entity_type: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [vendors, setVendors] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ record_count: 0, total_amount: "0" });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [generatedAt, setGeneratedAt] = useState(() => new Date());
  const reportRequestId = useRef(0);

  const params = useMemo(() => {
    const filterKeys = reportType === "audit"
      ? ["from_date", "to_date", "action", "entity_type"]
      : ["from_date", "to_date", "vendor", "status"];
    return Object.fromEntries(
      filterKeys
        .map((key) => [key, appliedFilters[key]])
        .filter(([, value]) => value),
    );
  }, [appliedFilters, reportType]);

  const loadReport = useCallback(async () => {
    const requestId = reportRequestId.current + 1;
    reportRequestId.current = requestId;
    setLoading(true);
    setError("");
    setRows([]);
    setSummary({ record_count: 0, total_amount: "0" });
    setGeneratedAt(new Date());

    try {
      const response = await api.get("/reports/", {
        params: { type: reportType, ...params },
      });
      if (requestId !== reportRequestId.current) return;
      if (response.data.report_type !== reportType) {
        throw new Error("The server returned a different report than requested.");
      }
      setRows(Array.isArray(response.data.results) ? response.data.results : []);
      setSummary(response.data.summary || { record_count: 0, total_amount: "0" });
    } catch (loadError) {
      if (requestId !== reportRequestId.current) return;
      setError(getError(loadError));
      setRows([]);
      setSummary({ record_count: 0, total_amount: "0" });
    } finally {
      if (requestId === reportRequestId.current) setLoading(false);
    }
  }, [params, reportType]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReport();
    return () => {
      reportRequestId.current += 1;
    };
  }, [loadReport]);

  useEffect(() => {
    vendorService.getVendors()
      .then((data) => setVendors(Array.isArray(data) ? data : data.results || []))
      .catch((vendorError) => setError(getError(vendorError)));
  }, []);

  const exportCsv = async () => {
    try {
      setExporting(true);
      setError("");
      const response = await api.get("/reports/", {
        params: { type: reportType, ...params, format: "csv" },
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportType}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (exportError) {
      setError(getError(exportError));
    } finally {
      setExporting(false);
    }
  };

  const columns = reportColumns[reportType] || [];
  const reportTitle = reportOptions.find(([value]) => value === reportType)?.[1];
  const appliedFilterLabels = [
    params.from_date && `From: ${params.from_date}`,
    params.to_date && `To: ${params.to_date}`,
    reportType !== "audit" && params.vendor && `Vendor: ${params.vendor}`,
    reportType !== "audit" && params.status && `Status: ${params.status.replaceAll("_", " ")}`,
    params.action && `Action: ${params.action}`,
    params.entity_type && `Entity: ${params.entity_type}`,
  ].filter(Boolean);

  return (
    <div className="reports-printable space-y-6 print:space-y-3">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Database-backed accounts payable reports and exports.</p>
        </div>
        <div className="reports-screen-only flex gap-2">
          <button onClick={loadReport} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />Refresh
          </button>
          <button onClick={exportCsv} disabled={exporting || loading || !rows.length} className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            <Download size={16} />{exporting ? "Exporting..." : "Export CSV"}
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <Printer size={16} />Print
          </button>
        </div>
      </header>

      <div className="hidden print:block">
        <h2 className="text-xl font-bold">{reportTitle}</h2>
        <p>Generated: {generatedAt.toLocaleString("en-IN")}</p>
        <p>Filters: {appliedFilterLabels.join(" | ") || "None"}</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedFilters(filters);
        }}
        className="reports-screen-only grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="text-sm text-slate-600">
          Report
          <select value={reportType} onChange={(event) => setReportType(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
            {reportOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          From date
          <input type="date" value={filters.from_date} onChange={(event) => setFilters((current) => ({ ...current, from_date: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="text-sm text-slate-600">
          To date
          <input type="date" value={filters.to_date} onChange={(event) => setFilters((current) => ({ ...current, to_date: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        {reportType === "audit" ? (
          <>
            <label className="text-sm text-slate-600">
              Action
              <input value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))} placeholder="e.g. invoice.uploaded" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm text-slate-600">
              Entity type
              <select value={filters.entity_type} onChange={(event) => setFilters((current) => ({ ...current, entity_type: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">All entities</option>
                {["invoice", "vendor", "report"].map((entityType) => (
                  <option key={entityType} value={entityType}>{entityType}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="text-sm text-slate-600">
              Vendor
              <select value={filters.vendor} onChange={(event) => setFilters((current) => ({ ...current, vendor: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">All vendors</option>
                {vendors.map((vendor) => <option key={vendor.id} value={vendor.vendor_name}>{vendor.vendor_name}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Invoice status
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">All statuses</option>
                {["UPLOADED", "PROCESSING", "VALIDATED", "REVIEW_REQUIRED", "APPROVED", "REJECTED", "PAID"].map((status) => (
                  <option key={status} value={status}>{status.replaceAll("_", " ")}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <button className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2 lg:col-span-5">Apply filters</button>
      </form>

      {error && <div role="alert" className="reports-screen-only rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <section className={`grid gap-4 ${reportType === "audit" ? "sm:grid-cols-1" : "sm:grid-cols-2"}`}>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Records</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{loading ? "—" : summary.record_count}</p>
        </div>
        {reportType !== "audit" && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">{reportType === "tax" ? "Total tax amount" : "Total invoice amount"}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {loading ? "—" : formatAmount(summary.total_amount)}
            </p>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4">
          <h2 className="font-semibold text-slate-800">{reportTitle}</h2>
        </div>
        {loading ? <LoadingSpinner /> : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {error ? "The report could not be loaded." : "No records match the selected report and filters."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>{columns.map((column) => (
                  <th key={column} className="whitespace-nowrap px-3 py-3">
                    {columnLabels[column] || column.replaceAll("_", " ")}
                  </th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, index) => (
                  <tr key={row.invoice_id || row.invoice_number || row.vendor_name || row.po_number || index}>
                    {columns.map((column) => (
                      <td key={column} className="max-w-sm px-3 py-3 text-slate-700">
                        {column === "status" || column === "matching_status"
                          ? <StatusBadge status={row[column]} />
                          : formatCell(column, row[column], row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default Reports;
