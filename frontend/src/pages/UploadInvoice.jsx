
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  FileText,
} from "lucide-react";

import InvoiceUpload from "../components/invoices/InvoiceUpload";
import StatusBadge from "../components/common/StatusBadge";
import InvoiceDeleteAction from "../components/invoices/InvoiceDeleteAction";
import Toast from "../components/common/Toast";

const UploadInvoice = () => {
  const navigate = useNavigate();
  const [uploadResults, setUploadResults] = useState([]);
  const [toast, setToast] = useState("");

  const handleUploadSuccess = (results) => {
    setUploadResults(results);
  };

  const handleDeleted = (invoice) => {
    setUploadResults((results) =>
      results.filter((result) => result.invoice?.id !== invoice.id),
    );
    setToast(
      `${invoice.invoice_number || `Invoice ${invoice.id}`} was deleted.`,
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Upload Invoice
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload PDF or image invoices individually or in a batch for automatic
          OCR and AI processing.
        </p>
      </div>

      {uploadResults.length > 0 && (
        <section className="space-y-3" aria-label="Upload results">
          <h2 className="text-lg font-semibold text-slate-900">
            Upload results
          </h2>
          {uploadResults.map((result, index) => {
            const invoice = result.invoice;
            return (
              <div
                key={`${result.filename}-${invoice?.id || index}`}
                className={`rounded-xl border p-5 ${
                  result.success
                    ? "border-green-200 bg-green-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  {result.success ? (
                    invoice?.status === "REVIEW_REQUIRED" ? (
                      <AlertTriangle
                        className="mt-0.5 text-amber-600"
                        size={23}
                      />
                    ) : (
                      <CheckCircle2
                        className="mt-0.5 text-green-600"
                        size={23}
                      />
                    )
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 text-red-600"
                      size={23}
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900">
                      {result.filename}
                    </h3>
                    {result.success ? (
                      <>
                        <p className="mt-1 text-sm text-slate-600">
                          {invoice.vendor_name || "Vendor not identified"}
                          {" · "}
                          {invoice.invoice_number ||
                            "Invoice number not identified"}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <StatusBadge status={invoice.status} />
                          <span className="text-xs text-slate-500">
                            Invoice ID: {invoice.id}
                          </span>
                        </div>
                        {invoice.processing_error && (
                          <p className="mt-3 text-sm text-amber-800">
                            {invoice.processing_error}
                          </p>
                        )}
                        {invoice.validation_errors?.length > 0 && (
                          <p className="mt-3 text-sm text-red-700">
                            {invoice.validation_errors.join(" ")}
                          </p>
                        )}
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/invoices/${invoice.id}`)}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                          >
                            Review Invoice
                            <ArrowRight size={16} />
                          </button>
                          <InvoiceDeleteAction
                            invoice={invoice}
                            onDeleted={handleDeleted}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-red-700">
                        {result.error || "This document could not be uploaded."}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <InvoiceUpload onUploadSuccess={handleUploadSuccess} />
      <Toast message={toast} onClose={() => setToast("")} />

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">
          How invoice processing works
        </h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-blue-50 p-2">
              <FileText size={19} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                1. Upload
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Select your invoice document.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-blue-50 p-2">
              <CheckCircle2 size={19} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                2. Extract and Validate
              </p>
              <p className="mt-1 text-xs text-slate-500">
                OCR and AI identify and validate invoice details.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-blue-50 p-2">
              <ArrowRight size={19} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                3. Review
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Correct extracted data and continue to approval.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadInvoice;
