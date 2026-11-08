
import { AlertCircle, CheckCircle2, FileClock } from "lucide-react";

const hasValidationItems = (value) => {
  if (value == null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  return Array.isArray(value) || typeof value === "object"
    ? Object.keys(value).length > 0
    : Boolean(value);
};

function QuickSummary({
  invoices = [],
  summary,
  loading = false,
}) {
  const calculatedSummary = {
    review_required_count: invoices.filter(
      (invoice) =>
        invoice.status === "REVIEW_REQUIRED" ||
        invoice.validation_status === "REVIEW_REQUIRED"
    ).length,
    validation_issue_count: invoices.filter(
      (invoice) =>
        hasValidationItems(invoice.validation_warnings) ||
        hasValidationItems(invoice.validation_errors) ||
        invoice.validation_status === "INVALID"
    ).length,
    processing_error_count: invoices.filter(
      (invoice) => Boolean((invoice.processing_error || "").trim())
    ).length,
    uploaded_count: invoices.filter(
      (invoice) =>
        ["UPLOADED", "PROCESSING"].includes(invoice.status) &&
        !(invoice.processing_error || "").trim()
    ).length,
  };
  const counts = summary || calculatedSummary;

  const items = [
    {
      label: "Invoices requiring review",
      value: counts.review_required_count,
      icon: AlertCircle,
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "Validation warnings / failures",
      value: counts.validation_issue_count,
      icon: FileClock,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Processing errors",
      value: counts.processing_error_count,
      icon: AlertCircle,
      color: "text-rose-600 bg-rose-50",
    },
    {
      label: "Uploaded invoices",
      value: counts.uploaded_count,
      icon: CheckCircle2,
      color: "text-teal-600 bg-teal-50",
    },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-800">
        Quick Summary
      </h2>

      <p className="mt-1 text-xs text-slate-500">
        Current invoice processing overview
      </p>

      <div className="mt-5 space-y-4">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.label}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${item.color}`}>
                  <Icon size={18} />
                </div>

                <span className="text-sm text-slate-600">
                  {item.label}
                </span>
              </div>

              <span className="text-lg font-bold text-slate-800">
                {loading ? "..." : item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default QuickSummary;
