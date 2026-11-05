
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  RefreshCw,
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Clock3,
  Search,
} from "lucide-react";

import useInvoices from "../hooks/useInvoices";
import approvalService from "../services/approvalService";

import ApprovalTable from "../components/approvals/ApprovalTable";
import ApprovalActions from "../components/approvals/ApprovalActions";
import LoadingSpinner from "../components/common/LoadingSpinner";

const Approvals = () => {
  const {
    invoices,
    loading,
    error,
    refreshInvoices,
  } = useInvoices();

  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedAction, setSelectedAction] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const pendingInvoices = useMemo(() => {
    return invoices.filter(
      (invoice) =>
        (
          invoice.status === "VALIDATED" &&
          invoice.validation_status === "VALID"
        ) ||
        invoice.status === "PENDING_APPROVAL" ||
        invoice.status === "ESCALATED"
    );
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const query = search.toLowerCase().trim();

    return pendingInvoices.filter((invoice) => {
      return (
        !query ||
        invoice.invoice_number?.toLowerCase().includes(query) ||
        invoice.vendor_name?.toLowerCase().includes(query)
      );
    });
  }, [pendingInvoices, search]);

  const approvedCount = invoices.filter(
    (invoice) => invoice.status === "APPROVED"
  ).length;

  const rejectedCount = invoices.filter(
    (invoice) => invoice.status === "REJECTED"
  ).length;

  const handleAction = (invoice, action) => {
    setSelectedInvoice(invoice);
    setSelectedAction(action);
    setActionError("");
    setSuccessMessage("");
  };

  const closeModal = () => {
    if (submitting) return;

    setSelectedInvoice(null);
    setSelectedAction(null);
  };

  const handleSubmitAction = async (remarks) => {
    if (!selectedInvoice || !selectedAction) return;

    try {
      setSubmitting(true);
      setActionError("");
      setSuccessMessage("");

      if (selectedAction === "APPROVED") {
        await approvalService.approveInvoice(
          selectedInvoice.id,
          remarks
        );
      } else {
        await approvalService.rejectInvoice(
          selectedInvoice.id,
          remarks
        );
      }

      const message =
        selectedAction === "APPROVED"
          ? "Invoice approved successfully."
          : "Invoice rejected successfully.";

      setSelectedInvoice(null);
      setSelectedAction(null);
      setSuccessMessage(message);

      await refreshInvoices();
    } catch (err) {
      console.error("Approval action failed:", err);

      const responseData = err.response?.data;

      setActionError(
        responseData?.error ||
        responseData?.detail ||
        err.message ||
        "Unable to process the invoice."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const statCards = [
    {
      title: "Pending Approvals",
      value: pendingInvoices.length,
      icon: Clock3,
      color: "text-amber-600",
      background: "bg-amber-50",
    },
    {
      title: "Approved",
      value: approvedCount,
      icon: CheckCircle2,
      color: "text-emerald-600",
      background: "bg-emerald-50",
    },
    {
      title: "Rejected",
      value: rejectedCount,
      icon: XCircle,
      color: "text-red-600",
      background: "bg-red-50",
    },
  ];

  return (
    <div className="space-y-6">

      {/* Page heading */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="text-teal-600" size={25} />

            <h1 className="text-2xl font-bold text-slate-900">
              Invoice Approvals
            </h1>
          </div>

          <p className="mt-1 text-sm text-slate-500">
            Review validated invoices and manage approval decisions.
          </p>
        </div>

        <button
          onClick={refreshInvoices}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw
            size={16}
            className={loading ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>

      {/* Success message */}
      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {successMessage}
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {statCards.map((card) => {
          const Icon = card.icon;

          return (
            <div
              key={card.title}
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">
                  {card.title}
                </p>

                <div className={`rounded-lg p-2 ${card.background}`}>
                  <Icon size={20} className={card.color} />
                </div>
              </div>

              <p className={`mt-3 text-3xl font-bold ${card.color}`}>
                {card.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-slate-900">
            Pending Review
          </h2>

          <p className="mt-1 text-xs text-slate-500">
            Validated invoices awaiting their next approval level are displayed.
          </p>
        </div>

        <div className="relative w-full sm:max-w-sm">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice or vendor..."
            className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
        </div>
      </div>

      {/* Invoice table */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <LoadingSpinner />

          <p className="mt-3 text-sm text-slate-500">
            Loading pending approvals...
          </p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-700">
            Unable to load approvals
          </p>

          <p className="mt-1 text-sm text-red-600">
            {error}
          </p>

          <button
            onClick={refreshInvoices}
            className="mt-3 text-sm font-semibold text-red-700 underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <ApprovalTable
            invoices={filteredInvoices}
            onAction={handleAction}
            onView={(id) => navigate(`/invoices/${id}`)}
          />

          <p className="text-right text-xs text-slate-500">
            Showing {filteredInvoices.length} of{" "}
            {pendingInvoices.length} pending invoices
          </p>
        </>
      )}

      {/* Approval / rejection modal */}
      <ApprovalActions
        invoice={selectedInvoice}
        action={selectedAction}
        onClose={closeModal}
        onSubmit={handleSubmitAction}
        submitting={submitting}
      />
    </div>
  );
};

export default Approvals;
