
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

const getToday = () => {
  const today = new Date();
  const offset = today.getTimezoneOffset();

  return new Date(today.getTime() - offset * 60000)
    .toISOString()
    .split("T")[0];
};

const getOutstandingAmount = (invoice, payments) => {
  const reservedAmount = payments
    .filter(
      (payment) =>
        Number(payment.invoice) === Number(invoice.id) &&
        ["PAID", "PENDING", "APPROVED", "PROCESSING"].includes(payment.status)
    )
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  return Math.max(Number(invoice.total_amount || 0) - reservedAmount, 0);
};

const Payments = () => {
  const { invoices, loading, error, refreshInvoices } = useInvoices();

  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [paymentAdvice, setPaymentAdvice] = useState(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getToday());
  const [paymentReference, setPaymentReference] = useState("");
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

  const paidInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.status === "PAID"),
    [invoices]
  );

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
  const filteredPaid = filterInvoices(paidInvoices);

  const recordedPaidAmount = payments
    .filter((payment) => payment.status === "PAID")
    .reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const legacyPaidAmount = paidInvoices
    .filter(
      (invoice) =>
        !payments.some(
          (payment) =>
            Number(payment.invoice) === Number(invoice.id) &&
            payment.status === "PAID"
        )
    )
    .reduce((total, invoice) => total + Number(invoice.total_amount || 0), 0);
  const paidAmount = recordedPaidAmount + legacyPaidAmount;

  const pendingAmount = approvedInvoices.reduce(
    (total, invoice) => total + getOutstandingAmount(invoice, payments),
    0
  );

  const openPaymentForm = (invoice) => {
    setSelectedInvoice(invoice);
    setSelectedPayment(null);
    setPaymentAmount(String(getOutstandingAmount(invoice, payments)));
    setPaymentDate(getToday());
    setPaymentReference("");
    setPaymentMethod("BANK_TRANSFER");
    setActionError("");
    setSuccessMessage("");
  };

  const closePaymentForm = () => {
    if (submitting) return;

    setSelectedInvoice(null);
    setSelectedPayment(null);
    setActionError("");
  };

  const handlePayment = async (event) => {
    event.preventDefault();

    if (selectedPayment) {
      if (!paymentDate || !paymentReference.trim()) {
        setActionError("Payment date and transaction reference are required.");
        return;
      }

      try {
        setSubmitting(true);
        setActionError("");
        await paymentService.updatePaymentStatus(selectedPayment.id, {
          status: "PAID",
          payment_date: paymentDate,
          payment_reference: paymentReference.trim(),
        });
        setSuccessMessage("Settlement recorded successfully.");
        setSelectedPayment(null);
        await Promise.all([refreshInvoices(), refreshPayments()]);
      } catch (err) {
        setActionError(
          err.response?.data?.error ||
            err.response?.data?.detail ||
            err.message ||
            "Unable to record settlement."
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

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

      setActionError(
        err.response?.data?.error ||
          err.response?.data?.detail ||
          err.message ||
          "Unable to record payment."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentTransition = async (payment, status) => {
    if (status === "PAID") {
      setSelectedPayment(payment);
      setSelectedInvoice(null);
      setPaymentDate(getToday());
      setPaymentReference("");
      setActionError("");
      setSuccessMessage("");
      return;
    }

    try {
      setActionError("");
      await paymentService.updatePaymentStatus(payment.id, { status });
      setSuccessMessage(`Payment request moved to ${status.toLowerCase()}.`);
      await refreshPayments();
    } catch (err) {
      setActionError(
        err.response?.data?.error ||
          err.response?.data?.detail ||
          err.message ||
          "Unable to update payment status."
      );
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
      !query ||
      payment.invoice_number?.toLowerCase().includes(query) ||
      payment.vendor_name?.toLowerCase().includes(query)
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
      value: paidInvoices.length,
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

      {actionError && !selectedInvoice && (
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
                          <button
                            onClick={() => openPaymentForm(invoice)}
                            className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                          >
                            Request Payment
                          </button>
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
                Requests follow approval and processing steps before settlement is recorded.
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
                      <th className="px-5 py-3">Reference</th>
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
                          {payment.payment_reference || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4">
                          {payment.status === "PENDING" && (
                            <button
                              onClick={() => handlePaymentTransition(payment, "APPROVED")}
                              className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                            >
                              Approve
                            </button>
                          )}
                          {payment.status === "APPROVED" && (
                            <button
                              onClick={() => handlePaymentTransition(payment, "PROCESSING")}
                              className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              Start processing
                            </button>
                          )}
                          {payment.status === "PROCESSING" && (
                            <button
                              onClick={() => handlePaymentTransition(payment, "PAID")}
                              className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-100"
                            >
                              Record settlement
                            </button>
                          )}
                          {payment.status === "PAID" && (
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

          {/* Payment history */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold text-slate-900">
                Payment History
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Previously paid invoices and their transaction details.
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
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {filteredPaid.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-900">
                          {invoice.invoice_number || `#${invoice.id}`}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {invoice.vendor_name || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {formatDate(invoice.payment_date)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {invoice.payment_reference || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                          {invoice.payment_method?.replaceAll("_", " ") || "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
                          {formatCurrency(invoice.total_amount, invoice.currency)}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={invoice.status} />
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
      {(selectedInvoice || selectedPayment) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {selectedPayment ? "Record Settlement" : "Request Payment"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedPayment
                    ? selectedPayment.invoice_number || `Invoice #${selectedPayment.invoice}`
                    : selectedInvoice.invoice_number || `Invoice #${selectedInvoice.id}`}
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
                    selectedPayment?.amount || selectedInvoice?.total_amount,
                    selectedInvoice?.currency
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedPayment?.vendor_name || selectedInvoice?.vendor_name}
                </p>
              </div>

              {actionError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {actionError}
                </div>
              )}

              {!selectedPayment && (
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
                      ? getOutstandingAmount(selectedInvoice, payments)
                      : undefined
                  }
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500"
                />
              </div>
              )}

              {selectedPayment && <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  max={getToday()}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500"
                />
              </div>}

              {selectedPayment && <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Transaction Reference
                </label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  placeholder="Enter UTR / transaction ID"
                  maxLength={150}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500"
                />
              </div>}

              {!selectedPayment && <div>
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
              </div>}

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
                    : selectedPayment
                      ? "Confirm Settlement"
                      : "Create Payment Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Payments;
