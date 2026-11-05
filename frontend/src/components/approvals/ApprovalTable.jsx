import {
  CheckCircle2,
  XCircle,
  Eye,
  ClipboardList,
} from "lucide-react";

import StatusBadge from "../common/StatusBadge";
import { formatCurrency, formatDate } from "../../utils/formatters";

const ApprovalTable = ({ invoices, onAction, onView }) => {
  if (!invoices.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
        <ClipboardList
          size={42}
          className="mx-auto text-slate-300"
        />

        <h3 className="mt-4 font-semibold text-slate-800">
          No pending approvals
        </h3>

        <p className="mt-1 text-sm text-slate-500">
          Validated invoices awaiting approval will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left">
          <thead className="bg-slate-50">
            <tr className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-5 py-4">Invoice</th>
              <th className="px-5 py-4">Vendor</th>
              <th className="px-5 py-4">Invoice Date</th>
              <th className="px-5 py-4">Amount</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {invoices.map((invoice) => (
              <tr
                key={invoice.id}
                className="transition hover:bg-slate-50/70"
              >
                <td className="px-5 py-4">
                  <p className="font-semibold text-slate-800">
                    {invoice.invoice_number || `Invoice #${invoice.id}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    ID: {invoice.id}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Next approval level {Number(invoice.approval_level || 0) + 1}
                  </p>
                </td>

                <td className="px-5 py-4">
                  <span className="text-sm font-medium text-slate-700">
                    {invoice.vendor_name || "Unknown Vendor"}
                  </span>
                </td>

                <td className="px-5 py-4 text-sm text-slate-600">
                  {formatDate(invoice.invoice_date)}
                </td>

                <td className="px-5 py-4 text-sm font-bold text-slate-800">
                  {formatCurrency(
                    invoice.total_amount,
                    invoice.currency
                  )}
                </td>

                <td className="px-5 py-4">
                  <StatusBadge status={invoice.status} />
                </td>

                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => onView(invoice.id)}
                      title="View invoice"
                      className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100"
                    >
                      <Eye size={17} />
                    </button>

                    <button
                      onClick={() => onAction(invoice, "APPROVED")}
                      title="Approve invoice"
                      className="rounded-lg bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100"
                    >
                      <CheckCircle2 size={18} />
                    </button>

                    <button
                      onClick={() => onAction(invoice, "REJECTED")}
                      title="Reject invoice"
                      className="rounded-lg bg-red-50 p-2 text-red-700 hover:bg-red-100"
                    >
                      <XCircle size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ApprovalTable;