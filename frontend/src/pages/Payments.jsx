
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  RefreshCw,
  CheckCircle2,
  Clock3,
  Search,
  X,
} from "lucide-react";

import useInvoices from "../hooks/useInvoices";
import paymentService from "../services/paymentService";
import StatusBadge from "../components/common/StatusBadge";
import LoadingSpinner from "../components/common/LoadingSpinner";

const formatCurrency = (amount, currency = "INR") => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
};

const formatDate = (value) => {
  if (!value) return "—";

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const getOutstandingAmount = (invoice, payments) => {
  const paidAmount = payments
    .filter(
      (payment) =>
        Number(payment.invoice) === Number(invoice.id) &&
        payment.status === "PAID"
    )
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  return Math.max(Number(invoice.total_amount || 0) - paidAmount, 0);
};

const getAvailablePaymentAmount = (invoice, payments) => {
  const reservedAmount = payments
    .filter(
      (payment) =>
        Number(payment.invoice) === Number(invoice.id) &&
        ["PENDING", "APPROVED", "PROCESSING"].includes(payment.status)
    )
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  return Math.max(getOutstandingAmount(invoice, payments) - reservedAmount, 0);
};

const getApiError = (err, fallback) => {
  const responseData = err.response?.data;
  const validationMessage = responseData
    ? Object.values(responseData).flat().find((value) => typeof value === "string")
    : "";
  return (
    responseData?.error ||
    responseData?.detail ||
    validationMessage ||
    err.message ||
    fallback
  );
};

const Payments = () => {
  const { invoices, loading, error, refreshInvoices } = useInvoices();

  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [paymentAction, setPaymentAction] = useState(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [transitionSubmitting, setTransitionSubmitting] = useState(false);
  const [paymentAdvice, setPaymentAdvice] = useState(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const refreshPayments = useCallback(async () => {
    try {
      setPaymentsLoading(true);
      const data = await paymentService.getPayments();
      setPayments(Array.isArray(data) ? data : data.results || []);
    } catch (err) {
      console.error("Unable to load payment requests:", err);
      setActionError(
        err.response?.data?.detail ||
          err.message ||
          "Unable to load payment requests."
      );
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPayments();
  }, [refreshPayments]);

  const approvedInvoices = useMemo(
    () => invoices.filter(
      (invoice) =>
        invoice.status === "APPROVED" &&
        getOutstandingAmount(invoice, payments) > 0
    ),
    [invoices, payments]
  );

  const paidPaymentRecords = payments.filter((payment) => payment.status === "PAID");
  const legacyPaidInvoices = invoices.filter(
    (invoice) =>
      invoice.status === "PAID" &&
      !paidPaymentRecords.some(
        (payment) => Number(payment.invoice) === Number(invoice.id)
      )
  );
  const paymentHistory = [
    ...paidPaymentRecords.map((payment) => ({
      ...payment,
      key: `payment-${payment.id}`,
    })),
    ...legacyPaidInvoices.map((invoice) => ({
      ...invoice,
      key: `invoice-${invoice.id}`,
      amount: invoice.total_amount,
      status: invoice.status,
      legacy: true,
    })),
  ];

  const filterInvoices = (items) => {
    const query = search.toLowerCase().trim();

    return items.filter(
      (invoice) =>
        !query ||
        invoice.invoice_number?.toLowerCase().includes(query) ||
        invoice.vendor_name?.toLowerCase().includes(query)
    );
  };

  const filteredApproved = filterInvoices(approvedInvoices);
  const filteredPaid = paymentHistory.filter(
    (payment) =>
      !search.trim() ||
      payment.invoice_number?.toLowerCase().includes(search.toLowerCase().trim()) ||
      payment.vendor_name?.toLowerCase().includes(search.toLowerCase().trim())
  );

  const recordedPaidAmount = paidPaymentRecords
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const legacyPaidAmount = legacyPaidInvoices
    .reduce((total, invoice) => total + Number(invoice.total_amount || 0), 0);
  const paidAmount = recordedPaidAmount + legacyPaidAmount;
  const paidInvoiceCount = new Set([
    ...paidPaymentRecords.map((payment) => Number(payment.invoice)),
    ...legacyPaidInvoices.map((invoice) => Number(invoice.id)),
  ]).size;

  const pendingAmount = approvedInvoices.reduce(
    (total, invoice) => total + getOutstandingAmount(invoice, payments),
    0
  );

  const openPaymentForm = (invoice) => {
    setSelectedInvoice(invoice);
    setPaymentAmount(String(getAvailablePaymentAmount(invoice, payments)));
    setPaymentMethod("BANK_TRANSFER");
    setActionError("");
    setSuccessMessage("");
  };

  const closePaymentForm = () => {
    if (submitting) return;

    setSelectedInvoice(null);
    setActionError("");
  };

  const handlePayment = async (event) => {
    event.preventDefault();

    if (!selectedInvoice) return;

    if (!Number(paymentAmount) || Number(paymentAmount) <= 0 || !paymentMethod) {
      setActionError("Enter a valid payment amount and method.");
      return;
    }

    try {
      setSubmitting(true);
      setActionError("");
      setSuccessMessage("");

      await paymentService.requestPayment({
        invoice: selectedInvoice.id,
        amount: paymentAmount,
        payment_method: paymentMethod,
      });

      setSuccessMessage(
        `Payment request created for invoice ${selectedInvoice.invoice_number || selectedInvoice.id}.`
      );

      setSelectedInvoice(null);
      await Promise.all([refreshInvoices(), refreshPayments()]);
    } catch (err) {
      console.error("Payment failed:", err);
      setActionError(getApiError(err, "Unable to record payment."));
    } finally {
      setSubmitting(false);
    }
  };

  const openPaymentAction = (payment, status) => {
    setPaymentAction({ payment, status });
    setTransitionReason("");
    setActionError("");
    setSuccessMessage("");
  };

  const handlePaymentTransition = async () => {
    if (!paymentAction) return;
    const { payment, status } = paymentAction;
    if (["REJECTED", "FAILED"].includes(status) && !transitionReason.trim()) {
      setActionError(
        status === "REJECTED"
          ? "A rejection reason is required."
          : "A failure reason is required."
      );
      return;
    }
    try {
      setTransitionSubmitting(true);
      setActionError("");
      const body = { status };
      if (status === "REJECTED") body.rejection_reason = transitionReason.trim();
      if (status === "FAILED") body.failure_reason = transitionReason.trim();
      const updatedPayment = await paymentService.updatePaymentStatus(
        payment.id,
        body
      );
      setPaymentAction(null);
      setSuccessMessage(
        status === "PAID"
          ? `Simulated payment completed. Reference: ${updatedPayment.payment_reference}.`
          : status === "FAILED"
            ? "Simulated payment marked as failed."
            : status === "REJECTED"
              ? "Payment request rejected."
              : status === "PROCESSING"
                ? "Simulated payment processing started."
                : "Payment request approved."
      );
      await Promise.all([refreshInvoices(), refreshPayments()]);
    } catch (err) {
      setActionError(getApiError(err, "Unable to update payment status."));
    } finally {
      setTransitionSubmitting(false);
    }
  };

  const openPaymentAdvice = async (payment) => {
    try {
      setLoadingAdvice(true);
      setActionError("");
      setPaymentAdvice(await paymentService.getPaymentAdvice(payment.id));
    } catch (err) {
      setActionError(
        err.response?.data?.detail ||
          err.message ||
          "Unable to load payment advice."
      );
    } finally {
      setLoadingAdvice(false);
    }
  };

  const filteredPayments = payments.filter((payment) => {
    const query = search.toLowerCase().trim();
    return (
      payment.status !== "PAID" &&
      (!query ||
        payment.invoice_number?.toLowerCase().includes(query) ||
        payment.vendor_name?.toLowerCase().includes(query))
    );
  });

  const statCards = [
    {
      title: "Awaiting Payment",
      value: approvedInvoices.length,
      amount: pendingAmount,
      icon: Clock3,
      color: "text-amber-600",
      background: "bg-amber-50",
    },
    {
      title: "Paid Invoices",
      value: paidInvoiceCount,
      amount: paidAmount,
      icon: CheckCircle2,
      color: "text-emerald-600",
      background: "bg-emerald-50",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <CreditCard className="text-teal-600" size={25} />
            <h1 className="text-2xl font-bold text-slate-900">
              Payment Tracking
            </h1>
          </div>

          <p className="mt-1 text-sm text-slate-500">
            Request, process, and track invoice payments through settlement.
          </p>
        </div>

        <button
          onClick={() => Promise.all([refreshInvoices(), refreshPayments()])}
          disabled={loading || paymentsLoading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw
            size={16}
            className={loading || paymentsLoading ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>

      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {successMessage}
        </div>
      )}
      {paymentAdvice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
          <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Payment Advice
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {paymentAdvice.invoice_number}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentAdvice(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                aria-label="Close payment advice"
              >
                <X size={20} />
              </button>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">Vendor</dt>
                <dd className="mt-1 font-medium text-slate-900">{paymentAdvice.vendor_name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Amount</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatCurrency(paymentAdvice.amount, paymentAdvice.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Payment date</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatDate(paymentAdvice.payment_date)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Reference</dt>
                <dd className="mt-1 break-all font-medium text-slate-900">
                  {paymentAdvice.payment_reference || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Method</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {paymentAdvice.payment_method?.replaceAll("_", " ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {paymentAdvice.payment_status}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      )}

      {actionError && !selectedInvoice && !paymentAction && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

              <p className="mt-1 text-sm text-slate-500">
                {formatCurrency(card.amount)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative w-full sm:max-w-sm">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search invoice or vendor..."
            className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
        </div>
      </div>

      {/* Loading and errors */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <LoadingSpinner />
          <p className="mt-3 text-sm text-slate-500">
            Loading payment information...
          </p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-700">
            Unable to load payments
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
          {/* Awaiting payment */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold text-slate-900">
                Awaiting Payment
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Approved invoices ready for payment.
              </p>
            </div>

            {filteredApproved.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                No approved invoices awaiting payment.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Invoice</th>
                      <th className="px-5 py-3">Vendor</th>
                      <th className="px-5 py-3">Due Date</th>
                      <th className="px-5 py-3">Amount</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Action</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {filteredApproved.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-900">
                          {invoice.invoice_number || `#${invoice.id}`}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {invoice.vendor_name || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {formatDate(invoice.due_date)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
                          {formatCurrency(invoice.total_amount, invoice.currency)}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={invoice.status} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          {getAvailablePaymentAmount(invoice, payments) > 0 ? (
                            <button
                              onClick={() => openPaymentForm(invoice)}
                              className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                            >
                              Request Payment
                            </button>
                          ) : (
                            <span className="text-xs font-medium text-slate-500">
                              Payment request active
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold text-slate-900">
                Payment Requests
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Payment request approval is separate from invoice approval. Processing is simulated; no bank transfer is initiated.
              </p>
            </div>

            {paymentsLoading ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Loading payment requests...
              </div>
            ) : filteredPayments.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No payment requests found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Invoice</th>
                      <th className="px-5 py-3">Vendor</th>
                      <th className="px-5 py-3">Amount</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Reference / Reason</th>
                      <th className="px-5 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPayments.map((payment) => (
                      <tr key={payment.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-900">
                          {payment.invoice_number || `#${payment.invoice}`}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {payment.vendor_name || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
                          {formatCurrency(payment.amount)}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={payment.status} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {payment.rejection_reason || payment.payment_reference || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          {payment.status === "PENDING" && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openPaymentAction(payment, "APPROVED")}
                                className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => openPaymentAction(payment, "REJECTED")}
                                className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                          {payment.status === "APPROVED" && (
                            <button
                              onClick={() => openPaymentAction(payment, "PROCESSING")}
                              className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              Process Payment
                            </button>
                          )}
                          {payment.status === "PROCESSING" && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openPaymentAction(payment, "PAID")}
                                className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-100"
                              >
                                Completed
                              </button>
                              <button
                                onClick={() => openPaymentAction(payment, "FAILED")}
                                className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                              >
                                Failed
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Payment history */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold text-slate-900">
                Payment History
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Completed payment records with simulated or recorded settlement details.
              </p>
            </div>

            {filteredPaid.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">
                No payment records found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Invoice</th>
                      <th className="px-5 py-3">Vendor</th>
                      <th className="px-5 py-3">Payment Date</th>
                      <th className="px-5 py-3">Reference</th>
                      <th className="px-5 py-3">Method</th>
                      <th className="px-5 py-3">Amount</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Action</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {filteredPaid.map((payment) => (
                      <tr key={payment.key} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-900">
                          {payment.invoice_number || `#${payment.invoice || payment.id}`}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {payment.vendor_name || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {formatDate(payment.payment_date)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {payment.payment_reference || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {payment.payment_method?.replaceAll("_", " ") || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
                          {formatCurrency(payment.amount, payment.currency)}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={payment.status} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          {!payment.legacy && (
                            <button
                              onClick={() => openPaymentAdvice(payment)}
                              disabled={loadingAdvice}
                              className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                            >
                              {loadingAdvice ? "Loading..." : "Payment advice"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Payment modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Request Payment
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedInvoice.invoice_number || `Invoice #${selectedInvoice.id}`}
                </p>
              </div>

              <button
                onClick={closePaymentForm}
                disabled={submitting}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handlePayment} className="space-y-4 p-5">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs text-slate-500">Payment amount</p>
                <p className="mt-1 text-xl font-bold text-slate-900">
                  {formatCurrency(
                    paymentAmount,
                    selectedInvoice.currency
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedInvoice.vendor_name}
                </p>
              </div>

              {actionError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {actionError}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Request amount
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={
                    selectedInvoice
                      ? getAvailablePaymentAmount(selectedInvoice, payments)
                      : undefined
                  }
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-500"
                >
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="CASH">Cash</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={closePaymentForm}
                  disabled={submitting}
                  className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting
                    ? "Processing..."
                    : "Create Payment Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {paymentAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">
              {paymentAction.status === "APPROVED"
                ? "Approve payment request?"
                : paymentAction.status === "REJECTED"
                  ? "Reject payment request?"
                  : paymentAction.status === "PROCESSING"
                    ? "Start simulated payment?"
                    : paymentAction.status === "PAID"
                      ? "Complete simulated payment?"
                      : "Mark simulated payment failed?"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {paymentAction.payment.invoice_number} ·{" "}
              {formatCurrency(
                paymentAction.payment.amount,
                paymentAction.payment.currency
              )}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {paymentAction.status === "PAID"
                ? "This records a test completion and generates a simulated reference. No bank transfer will occur."
                : paymentAction.status === "PROCESSING"
                  ? "This starts a simulated payment only. No bank transfer will occur."
                  : paymentAction.status === "REJECTED"
                    ? "Provide a reason; the payment request will be rejected without changing invoice approval."
                    : paymentAction.status === "FAILED"
                      ? "Provide a reason for the simulated payment failure."
                      : paymentAction.status === "APPROVED"
                        ? "This approves the payment request, not the invoice."
                        : "Confirm this payment request action."}
            </p>
            {["REJECTED", "FAILED"].includes(paymentAction.status) && (
              <label className="mt-4 block text-sm font-medium text-slate-700">
                {paymentAction.status === "REJECTED"
                  ? "Rejection reason"
                  : "Failure reason"}
                <textarea
                  value={transitionReason}
                  onChange={(event) => setTransitionReason(event.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  required
                />
              </label>
            )}
            {actionError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {actionError}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPaymentAction(null)}
                disabled={transitionSubmitting}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePaymentTransition}
                disabled={
                  transitionSubmitting ||
                  (["REJECTED", "FAILED"].includes(paymentAction.status) &&
                    !transitionReason.trim())
                }
                className="rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {transitionSubmitting ? "Saving..." : "Confirm"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default Payments;
