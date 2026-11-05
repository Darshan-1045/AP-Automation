
import { Link } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";

function getStatusStyle(status) {
  const styles = {
    REVIEW_REQUIRED: "bg-amber-50 text-amber-700",
    UPLOADED: "bg-slate-100 text-slate-700",
    VALID: "bg-teal-50 text-teal-700",
    APPROVED: "bg-blue-50 text-blue-700",
    INVALID: "bg-rose-50 text-rose-700",
    PAID: "bg-purple-50 text-purple-700",
  };

  return styles[status] || "bg-slate-100 text-slate-600";
}

function formatAmount(amount, currency = "INR") {
  const value = Number(amount);

  if (!Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date) {
  if (!date) return "—";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function RecentInvoices({ invoices = [] }) {
  const recentInvoices = [...invoices]
    .sort(
      (a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    )
    .slice(0, 5);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 p-5">
        <div>
          <h2 className="font-semibold text-slate-800">
            Recent Invoices
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Latest invoices received in your system
          </p>
        </div>

        <Link
          to="/invoices"
          className="flex items-center gap-1 text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          View all <ArrowRight size={16} />
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left">
          <thead className="bg-slate-50">
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-4 font-semibold">Invoice</th>
              <th className="px-5 py-4 font-semibold">Vendor</th>
              <th className="px-5 py-4 font-semibold">Date</th>
              <th className="px-5 py-4 font-semibold">Amount</th>
              <th className="px-5 py-4 font-semibold">Status</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {recentInvoices.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-5 py-12 text-center">
                  <FileText className="mx-auto mb-2 text-slate-300" size={28} />
                  <p className="text-sm text-slate-500">
                    No invoices available.
                  </p>
                </td>
              </tr>
            ) : (
              recentInvoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="transition hover:bg-slate-50"
                >
                  <td className="px-5 py-4">
                    <span className="text-sm font-semibold text-slate-800">
                      {invoice.invoice_number || `Invoice #${invoice.id}`}
                    </span>
                  </td>

                  <td className="px-5 py-4 text-sm text-slate-600">
                    {invoice.vendor_name || "Unknown vendor"}
                  </td>

                  <td className="px-5 py-4 text-sm text-slate-600">
                    {formatDate(invoice.invoice_date)}
                  </td>

                  <td className="px-5 py-4 text-sm font-semibold text-slate-800">
                    {formatAmount(invoice.total_amount, invoice.currency)}
                  </td>

                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusStyle(invoice.status)}`}
                    >
                      {(invoice.status || "UNKNOWN").replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RecentInvoices;
