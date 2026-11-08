import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import invoiceService from "../../services/invoiceService";

const getErrorMessage = (error) => {
  const data = error.response?.data;
  if (typeof data === "string") return data;
  if (data?.detail) return data.detail;
  if (data?.error) return data.error;
  return "Unable to delete this invoice. Please try again.";
};

const InvoiceDeleteAction = ({ invoice, onDeleted }) => {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const deleteInvoice = async () => {
    if (deleting) return;

    try {
      setDeleting(true);
      setError("");
      await invoiceService.deleteInvoice(invoice.id);
      onDeleted?.(invoice);
      setConfirming(false);
    } catch (deleteError) {
      console.error("Invoice deletion failed:", deleteError);
      setError(getErrorMessage(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setConfirming(true);
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
        aria-label={`Delete ${invoice.invoice_number || `invoice ${invoice.id}`}`}
      >
        <Trash2 size={15} />
        Delete
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-invoice-title-${invoice.id}`}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
          >
            <h2
              id={`delete-invoice-title-${invoice.id}`}
              className="text-lg font-semibold text-slate-900"
            >
              Delete invoice?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {invoice.invoice_number || `Invoice ${invoice.id}`}
              {" · "}
              {invoice.vendor_name || "Unknown vendor"}
            </p>
            <p className="mt-3 text-sm text-slate-600">
              Are you sure you want to delete this invoice? This action will
              remove the invoice record and its associated document. This
              cannot be undone.
            </p>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={deleteInvoice}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting && (
                  <LoaderCircle size={16} className="animate-spin" />
                )}
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default InvoiceDeleteAction;
