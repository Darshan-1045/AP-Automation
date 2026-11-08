
import { useEffect, useState } from "react";
import {
  FileText,
  AlertCircle,
  Upload,
  IndianRupee,
  RefreshCw,
} from "lucide-react";

import useInvoices from "../hooks/useInvoices";

import StatCard from "../components/dashboard/StatCard";
import InvoiceStatusChart from "../components/dashboard/InvoiceStatusChart";
import InvoiceAgingChart from "../components/dashboard/InvoiceAgingChart";
import QuickSummary from "../components/dashboard/QuickSummary";
import RecentInvoices from "../components/dashboard/RecentInvoices";
import api from "../services/api";

function Dashboard() {
  const {
    invoices,
    loading,
    error,
    refreshInvoices,
  } = useInvoices();
  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const refreshDashboard = () => {
    refreshInvoices();
    setAnalyticsLoading(true);
    api.get("/dashboard/")
      .then(({ data }) => {
        setAnalytics(data);
        setAnalyticsError("");
      })
      .catch((requestError) => {
        setAnalyticsError(
          requestError.response?.data?.detail ||
            requestError.message ||
            "Unable to load dashboard analytics.",
        );
      })
      .finally(() => setAnalyticsLoading(false));
  };

  useEffect(() => {
    api.get("/dashboard/")
      .then(({ data }) => setAnalytics(data))
      .catch((requestError) => {
        setAnalyticsError(
          requestError.response?.data?.detail ||
            requestError.message ||
            "Unable to load dashboard analytics.",
        );
      })
      .finally(() => setAnalyticsLoading(false));
  }, []);

  const reviewCount = invoices.filter(
    (invoice) =>
      invoice.status === "REVIEW_REQUIRED" ||
      invoice.validation_status === "REVIEW_REQUIRED"
  ).length;

  const uploadedCount = invoices.filter(
    (invoice) => invoice.status === "UPLOADED"
  ).length;

  const vendorCount = new Set(
    invoices
      .map((invoice) => invoice.vendor_name)
      .filter(Boolean)
  ).size;

  const currencyTotals = invoices.reduce((acc, invoice) => {
    const currency = invoice.currency || "INR";
    const amount = Number(invoice.total_amount);

    if (Number.isFinite(amount)) {
      acc[currency] = (acc[currency] || 0) + amount;
    }

    return acc;
  }, {});

  const currencies = Object.keys(currencyTotals);

  const totalValue =
    currencies.length === 0
      ? "₹0.00"
      : currencies.length === 1
        ? new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: currencies[0],
            maximumFractionDigits: 2,
          }).format(currencyTotals[currencies[0]])
        : "Multiple currencies";

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-teal-100 border-t-teal-600" />
          <p className="mt-4 text-sm text-slate-500">
            Loading dashboard data...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center">
        <AlertCircle className="mx-auto text-rose-500" size={35} />

        <h2 className="mt-4 font-semibold text-slate-800">
          Unable to load dashboard
        </h2>

        <p className="mt-2 text-sm text-slate-500">
          {error}
        </p>

        <button
          onClick={refreshDashboard}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-700"
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    );
  }

  const stats = [
    {
      title: "Total Invoices",
      value: invoices.length,
      description: "Invoices in your database",
      icon: FileText,
      color: "blue",
    },
    {
      title: "Review Required",
      value: reviewCount,
      description: "Invoices needing attention",
      icon: AlertCircle,
      color: "amber",
    },
    {
      title: "Uploaded",
      value: uploadedCount,
      description: "Invoices awaiting processing",
      icon: Upload,
      color: "teal",
    },
    {
      title: "Total Invoice Value",
      value: totalValue,
      description: `${currencies.length} currency type(s)`,
      icon: IndianRupee,
      color: "rose",
    },
  ];

  return (
    <div className="space-y-7">

      {/* Page heading */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Dashboard
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Monitor your accounts payable operations.
          </p>
        </div>

        <button
          onClick={refreshDashboard}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw size={16} />
          Refresh Data
        </button>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.title}
            {...stat}
          />
        ))}
      </div>

      {analyticsError && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Some database analytics are unavailable: {analyticsError}
        </div>
      )}

      <section
        aria-label="OCR accuracy"
        className="rounded-xl border border-slate-200 bg-white p-5"
      >
        <p className="text-sm text-slate-500">OCR accuracy</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">
          {analyticsLoading
            ? "Loading..."
            : analyticsError
              ? "Unavailable"
              : analytics?.ocr_accuracy?.label || "Unavailable"}
        </p>
        {analyticsLoading ? (
          <p className="mt-1 text-sm text-slate-500">
            Loading verified OCR field statistics...
          </p>
        ) : analyticsError ? (
          <p role="alert" className="mt-1 text-sm text-amber-700">
            Unable to load OCR accuracy: {analyticsError}
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-slate-500">
              Verified fields: {analytics?.ocr_accuracy?.total_verified_fields ?? 0}
              {" · "}Correct: {analytics?.ocr_accuracy?.correct_fields ?? 0}
              {" · "}Incorrect: {analytics?.ocr_accuracy?.incorrect_fields ?? 0}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {analytics?.ocr_accuracy?.definition}
            </p>
            {analytics?.ocr_accuracy?.by_field_type?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {analytics.ocr_accuracy.by_field_type.map((field) => (
                  <span
                    key={field.field_name}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
                  >
                    {field.label}: {field.accuracy}% ({field.correct_fields}/
                    {field.total_verified_fields})
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <InvoiceStatusChart invoices={invoices} />
        <InvoiceAgingChart aging={analytics?.aging || []} />
      </div>

      {analytics && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Pending approvals</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {analytics.pending_approval_count}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Overdue invoices</p>
            <p className="mt-2 text-2xl font-bold text-amber-700">
              {analytics.overdue_invoice_count}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">Processing turnaround</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {analytics.processing_turnaround.average_minutes === null
                ? "Not enough data"
                : `${analytics.processing_turnaround.average_minutes} min`}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {analytics.processing_turnaround.definition}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:col-span-2 xl:col-span-4">
            <p className="text-sm font-semibold text-slate-800">
              Paid and outstanding invoice totals
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {Object.entries(analytics.currency_totals).map(([currency, totals]) => (
                <span key={currency} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                  {currency}: Paid {Number(totals.paid_value).toLocaleString("en-IN")} ·
                  Outstanding {Number(totals.outstanding_value).toLocaleString("en-IN")}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:col-span-2 xl:col-span-4">
            <p className="text-sm font-semibold text-slate-800">
              Payment status tracking
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {Object.entries(analytics.payment_status_breakdown).map(
                ([status, count]) => (
                  <span key={status} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                    {status.replaceAll("_", " ")}: {count}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:col-span-2 xl:col-span-4">
            <p className="text-sm font-semibold text-slate-800">
              Vendors by outstanding value
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {analytics.vendor_analytics.length === 0 ? (
                <p className="text-sm text-slate-500">No vendor invoice data available.</p>
              ) : analytics.vendor_analytics.map((vendor) => (
                <div key={`${vendor.vendor_name}:${vendor.currency}`} className="rounded-lg bg-slate-50 p-3">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {vendor.vendor_name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {vendor.invoice_count} invoice(s) · Outstanding{" "}
                    {Number(vendor.outstanding_amount).toLocaleString("en-IN")} {vendor.currency}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Summary */}
      <QuickSummary invoices={invoices} />

      {/* Recent invoices */}
      <RecentInvoices invoices={invoices} />

      {/* Vendor summary */}
      <div className="text-xs text-slate-400">
        Currently tracking {vendorCount} unique vendor(s).
      </div>

    </div>
  );
}

export default Dashboard;
