
import { Eye, FileText } from "lucide-react";
import { formatCurrency, formatDate } from "../../utils/formatters";
import StatusBadge from "../common/StatusBadge";
import InvoiceDeleteAction from "./InvoiceDeleteAction";

const InvoiceTable = ({ invoices = [], onView, onDeleted }) => {
  if (!invoices.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
        <FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <h3 className="text-base font-semibold text-slate-700">
          No invoices found
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Try changing your search or filters.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-4 font-semibold">Invoice</th>
              <th className="px-5 py-4 font-semibold">Vendor</th>
              <th className="px-5 py-4 font-semibold">Invoice Date</th>
              <th className="px-5 py-4 font-semibold">Due Date</th>
              <th className="px-5 py-4 text-right font-semibold">Amount</th>
              <th className="px-5 py-4 font-semibold">Status</th>
              <th className="px-5 py-4 text-center font-semibold">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {invoices.map((invoice) => (
              <tr
                key={invoice.id}
                className="transition hover:bg-slate-50"
              >
                <td className="px-5 py-4">
                  <p className="font-semibold text-slate-800">
                    {invoice.invoice_number || `INV-${invoice.id}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    ID: {invoice.id}
                  </p>
                </td>

                <td className="px-5 py-4 text-sm text-slate-700">
                  {invoice.vendor_name || "Unknown vendor"}
                </td>

                <td className="px-5 py-4 text-sm text-slate-600">
                  {formatDate(invoice.invoice_date)}
                </td>

                <td className="px-5 py-4 text-sm text-slate-600">
                  {formatDate(invoice.due_date)}
                </td>

                <td className="px-5 py-4 text-right font-semibold text-slate-800">
                  {formatCurrency(invoice.total_amount, invoice.currency)}
                </td>

                <td className="px-5 py-4">
                  <StatusBadge status={invoice.status} />
                </td>

                <td className="px-5 py-4 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => onView?.(invoice)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                      <Eye size={15} />
                      View
                    </button>
                    <InvoiceDeleteAction
                      invoice={invoice}
                      onDeleted={onDeleted}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
        Showing {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
};

export default InvoiceTable;
