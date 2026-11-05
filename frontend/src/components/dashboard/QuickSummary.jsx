
import { AlertCircle, CheckCircle2, FileClock } from "lucide-react";

function QuickSummary({ invoices = [] }) {
  const reviewCount = invoices.filter(
    (invoice) =>
      invoice.status === "REVIEW_REQUIRED" ||
      invoice.validation_status === "REVIEW_REQUIRED"
  ).length;

  const warningCount = invoices.reduce(
    (total, invoice) =>
      total + (invoice.validation_warnings?.length || 0),
    0
  );

  const errorCount = invoices.filter(
    (invoice) => Boolean(invoice.processing_error)
  ).length;

  const uploadedCount = invoices.filter(
    (invoice) => invoice.status === "UPLOADED"
  ).length;

  const items = [
    {
      label: "Invoices requiring review",
      value: reviewCount,
      icon: AlertCircle,
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "Validation warnings",
      value: warningCount,
      icon: FileClock,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Processing errors",
      value: errorCount,
      icon: AlertCircle,
      color: "text-rose-600 bg-rose-50",
    },
    {
      label: "Uploaded invoices",
      value: uploadedCount,
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
                {item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default QuickSummary;
