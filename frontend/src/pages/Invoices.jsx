
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import useInvoices from "../hooks/useInvoices";
import InvoiceTable from "../components/invoices/InvoiceTable";
import InvoiceFilters from "../components/invoices/InvoiceFilters";
import LoadingSpinner from "../components/common/LoadingSpinner";

const Invoices = () => {
  const { invoices, loading, error, refreshInvoices } = useInvoices();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const searchValue = search.toLowerCase().trim();

      const matchesSearch =
        !searchValue ||
        invoice.invoice_number?.toLowerCase().includes(searchValue) ||
        invoice.vendor_name?.toLowerCase().includes(searchValue);

      const matchesStatus =
        status === "ALL" || invoice.status === status;

      return matchesSearch && matchesStatus;
    });
  }, [invoices, search, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Invoices
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage, search and review all your invoices.
          </p>
        </div>

        <button
          onClick={refreshInvoices}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Total invoices</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {invoices.length}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Review required</p>
          <p className="mt-2 text-2xl font-bold text-amber-600">
            {invoices.filter((invoice) => invoice.status === "REVIEW_REQUIRED").length}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Validated</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">
            {invoices.filter((invoice) => invoice.status === "VALIDATED").length}
          </p>
        </div>
      </div>

      <InvoiceFilters
        search={search}
        setSearch={setSearch}
        status={status}
        setStatus={setStatus}
      />

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <LoadingSpinner />
          <p className="mt-3 text-sm text-slate-500">
            Loading invoices...
          </p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-700">
            Unable to load invoices
          </p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
          <button
            onClick={refreshInvoices}
            className="mt-3 text-sm font-semibold text-red-700 underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <InvoiceTable
            invoices={filteredInvoices}
            onView={(invoice) => navigate(`/invoices/${invoice.id}`)}
          />

          <p className="text-right text-xs text-slate-500">
            {filteredInvoices.length} of {invoices.length} invoices displayed
          </p>
        </>
      )}
    </div>
  );
};

export default Invoices;
