import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";

const ApprovalActions = ({
  invoice,
  action,
  onClose,
  onSubmit,
  submitting,
}) => {
  const [remarks, setRemarks] = useState("");

  const isApprove = action === "APPROVED";

  useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setRemarks("");
  }, [invoice?.id, action]);

  if (!invoice || !action) return null;

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!isApprove && !remarks.trim()) {
      return;
    }

    onSubmit(remarks.trim());
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`rounded-xl p-3 ${
                isApprove
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {isApprove ? (
                <CheckCircle2 size={24} />
              ) : (
                <XCircle size={24} />
              )}
            </div>

            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {isApprove ? "Approve Invoice" : "Reject Invoice"}
              </h2>

              <p className="text-sm text-slate-500">
                {invoice.invoice_number}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">
            {invoice.vendor_name || "Unknown Vendor"}
          </p>

          <p className="mt-1 text-lg font-bold text-slate-900">
            {new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: invoice.currency || "INR",
            }).format(Number(invoice.total_amount || 0))}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="approval-remarks"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Remarks {!isApprove && <span className="text-red-500">*</span>}
            </label>

            <textarea
              id="approval-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={
                isApprove
                  ? "Add approval remarks (optional)..."
                  : "Explain why this invoice is being rejected..."
              }
              rows={4}
              required={!isApprove}
              disabled={submitting}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting || (!isApprove && !remarks.trim())}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                isApprove
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {submitting
                ? "Processing..."
                : isApprove
                  ? "Confirm Approval"
                  : "Confirm Rejection"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApprovalActions;