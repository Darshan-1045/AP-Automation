import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  RefreshCw,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
} from "lucide-react";

import invoiceService from "../services/invoiceService";
import StatusBadge from "../components/common/StatusBadge";
import LoadingSpinner from "../components/common/LoadingSpinner";
import { formatCurrency } from "../utils/formatters";

const normalizeLineItems = (items = []) =>
  items.map((item) => ({
    ...item,
    description: item.description ?? "",
    item_code: item.item_code ?? "",
    quantity: item.quantity ?? "",
    unit_price: item.unit_price ?? "",
    amount: item.amount ?? "",
  }));

const InvoiceDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState(null);
  const [form, setForm] = useState({});
  const [lineItems, setLineItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [documentPreview, setDocumentPreview] = useState({
    url: "",
    loading: false,
    error: "",
    invoiceId: null,
  });
  const canEditInvoice = ![
    "APPROVED",
    "REJECTED",
    "PAID",
  ].includes(invoice?.status);

  const populateForm = useCallback((data) => {
    setForm({
      invoice_number: data.invoice_number || "",
      vendor_name: data.vendor_name || "",
      vendor_gstin: data.vendor_gstin || "",
      invoice_date: data.invoice_date || "",
      due_date: data.due_date || "",
      subtotal: data.subtotal ?? "",
      tax_amount: data.tax_amount ?? "",
      shipping: data.shipping ?? "",
      total_amount: data.total_amount ?? "",
      currency: data.currency || "INR",
    });

    setLineItems(normalizeLineItems(data.line_items || []));
  }, []);

  const fetchInvoice = useCallback( async () => {
    try {
      setLoading(true);
      setError("");

      const data = await invoiceService.getInvoiceById(id);

      setInvoice(data);
      populateForm(data);
    } catch (err) {
      console.error("Invoice details fetching failed:", err);

      setError(
        err.response?.data?.detail ||
          "Unable to load invoice details."
      );
    } finally {
      setLoading(false);
    }
  }, [id, populateForm]);
  
  
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchInvoice();
  }, [fetchInvoice]);

  useEffect(() => {
    let previewUrl = "";
    let cancelled = false;

    if (!invoice?.document_url) {
      return undefined;
    }

    invoiceService.getInvoiceDocument(invoice.id)
      .then((blob) => {
        if (blob.size === 0) {
          throw new Error("The document is empty.");
        }

        previewUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(previewUrl);
          previewUrl = "";
          return;
        }
        setDocumentPreview({
          url: previewUrl,
          loading: false,
          error: "",
          invoiceId: invoice.id,
        });
      })
      .catch((previewError) => {
        if (!cancelled) {
          setDocumentPreview({
            url: "",
            loading: false,
            error: previewError.message || "Unable to preview this document.",
            invoiceId: invoice.id,
          });
        }
      });

    return () => {
      cancelled = true;
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [invoice?.id, invoice?.document_url]);

  const documentPreviewIsCurrent =
    documentPreview.invoiceId === invoice?.id;

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setSuccess("");
  };

  const handleLineItemChange = (index, field, value) => {
    setLineItems((previous) =>
      previous.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );

    setSuccess("");
  };

  const addLineItem = () => {
    setLineItems((previous) => [
      ...previous,
      {
        description: "",
        item_code: "",
        quantity: "",
        unit_price: "",
        amount: "",
      },
    ]);

    setSuccess("");
  };

  const removeLineItem = (index) => {
    setLineItems((previous) =>
      previous.filter((_, i) => i !== index)
    );

    setSuccess("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canEditInvoice) return;

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const payload = {
        ...form,

        subtotal: form.subtotal === "" ? null : form.subtotal,
        tax_amount: form.tax_amount === "" ? null : form.tax_amount,
        shipping: form.shipping === "" ? null : form.shipping,
        total_amount:
          form.total_amount === "" ? null : form.total_amount,

        line_items: lineItems.map((item) => ({
          ...(item.id != null ? { id: item.id } : {}),

          description: item.description || null,
          item_code: item.item_code || null,

          quantity:
            item.quantity === "" ? null : item.quantity,

          unit_price:
            item.unit_price === "" ? null : item.unit_price,

          amount:
            item.amount === "" ? null : item.amount,
        })),
      };

      const updatedInvoice = await invoiceService.updateInvoice(
        id,
        payload
      );

      setInvoice(updatedInvoice);
      populateForm(updatedInvoice);

      setSuccess(
        "Invoice corrections saved and validation completed successfully."
      );
    } catch (err) {
      console.error("Invoice update failed:", err);

      const responseData = err.response?.data;

      const message =
        responseData && typeof responseData === "object"
          ? Object.entries(responseData)
              .map(([field, messages]) => {
                const formattedMessages = Array.isArray(messages)
                  ? messages
                      .map((message) =>
                        typeof message === "object"
                          ? JSON.stringify(message)
                          : message
                      )
                      .join(", ")
                  : typeof messages === "object"
                    ? JSON.stringify(messages)
                    : messages;

                return `${field}: ${formattedMessages}`;
              })
              .join(" | ")
          : "Unable to save invoice corrections.";

      setError(message || "Unable to save invoice corrections.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <LoadingSpinner message="Loading invoice details..." />
      </div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="font-semibold text-red-700">{error}</p>

        <button
          onClick={() => navigate("/invoices")}
          className="mt-4 text-sm font-semibold text-red-700 underline"
        >
          Back to invoices
        </button>
      </div>
    );
  }

  if (!invoice) return null;

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <button
            onClick={() => navigate("/invoices")}
            className="mb-3 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600"
          >
            <ArrowLeft size={16} />
            Back to invoices
          </button>

          <h1 className="text-2xl font-bold text-slate-900">
            Invoice Details
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Review and correct extracted invoice information.
          </p>
        </div>

        <StatusBadge status={invoice.status} />
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          <CheckCircle2 size={18} />
          {success}
        </div>
      )}

      {/* Validation Results */}
      {(invoice.validation_errors?.length > 0 ||
        invoice.validation_warnings?.length > 0 ||
        invoice.processing_error) && (
        <div className="space-y-3">
          {invoice.processing_error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 font-semibold text-red-700">
                <XCircle size={18} />
                Processing error
              </div>

              <p className="mt-2 text-sm text-red-600">
                {invoice.processing_error}
              </p>
            </div>
          )}

          {invoice.validation_errors?.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-red-700">
                <XCircle size={18} />
                Validation errors
              </h3>

              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-red-600">
                {invoice.validation_errors.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {invoice.validation_warnings?.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-amber-800">
                <AlertTriangle size={18} />
                Validation warnings
              </h3>

              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-700">
                {invoice.validation_warnings.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Document Preview */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <FileText size={19} className="text-blue-600" />

          <h2 className="font-semibold text-slate-800">
            Original Invoice Document
          </h2>
        </div>

        {!invoice.document_url ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No document is available for this invoice.
          </div>
        ) : !documentPreviewIsCurrent || documentPreview.loading ? (
          <div className="flex h-[500px] items-center justify-center">
            <LoadingSpinner message="Loading original invoice document..." />
          </div>
        ) : documentPreview.url ? (
          <iframe
            src={documentPreview.url}
            title="Invoice document preview"
            className="h-[500px] w-full bg-slate-100"
          />
        ) : (
          <div className="p-8 text-center text-sm text-slate-600">
            <p>{documentPreview.error || "Unable to preview this document."}</p>
            <a
              href={documentPreview.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block font-medium text-teal-700 underline"
            >
              Open original document
            </a>
          </div>
        )}
      </section>

      {/* Editable Invoice Information */}
      <form onSubmit={handleSave} className="space-y-6">
        <fieldset disabled={!canEditInvoice} className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Extracted Invoice Information
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Verify the OCR and AI-extracted values and correct them if necessary.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-slate-700">
                Invoice Number
              </label>

              <input
                name="invoice_number"
                value={form.invoice_number || ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Vendor Name
              </label>

              <input
                name="vendor_name"
                value={form.vendor_name || ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Vendor GSTIN
              </label>

              <input
                name="vendor_gstin"
                value={form.vendor_gstin || ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Invoice Date
              </label>

              <input
                type="date"
                name="invoice_date"
                value={form.invoice_date || ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Due Date
              </label>

              <input
                type="date"
                name="due_date"
                value={form.due_date || ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Subtotal
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                name="subtotal"
                value={form.subtotal ?? ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                GST / Tax Amount
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                name="tax_amount"
                value={form.tax_amount ?? ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Shipping
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                name="shipping"
                value={form.shipping ?? ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Total Amount
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                name="total_amount"
                value={form.total_amount ?? ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Currency
              </label>

              <input
                maxLength={3}
                name="currency"
                value={form.currency || ""}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* Editable Line Items */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-semibold text-slate-900">
                Extracted Line Items
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Edit, add or remove invoice line items before saving.
              </p>
            </div>

            {canEditInvoice && <button
              type="button"
              onClick={addLineItem}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
            >
              <Plus size={16} />
              Add Line Item
            </button>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Item Code</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Unit Price</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {lineItems.length > 0 ? (
                  lineItems.map((item, index) => (
                    <tr key={item.id ?? `new-${index}`}>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) =>
                            handleLineItemChange(
                              index,
                              "description",
                              e.target.value
                            )
                          }
                          placeholder="Item description"
                          className="w-full min-w-[180px] rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </td>

                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.item_code}
                          onChange={(e) =>
                            handleLineItemChange(
                              index,
                              "item_code",
                              e.target.value
                            )
                          }
                          placeholder="Item code"
                          className="w-full min-w-[110px] rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </td>

                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={item.quantity}
                          onChange={(e) =>
                            handleLineItemChange(
                              index,
                              "quantity",
                              e.target.value
                            )
                          }
                          placeholder="0"
                          className="w-full min-w-[90px] rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </td>

                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_price}
                          onChange={(e) =>
                            handleLineItemChange(
                              index,
                              "unit_price",
                              e.target.value
                            )
                          }
                          placeholder="0.00"
                          className="w-full min-w-[110px] rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </td>

                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.amount}
                          onChange={(e) =>
                            handleLineItemChange(
                              index,
                              "amount",
                              e.target.value
                            )
                          }
                          placeholder="0.00"
                          className="w-full min-w-[110px] rounded-md border border-slate-200 px-2 py-2 text-sm outline-none focus:border-blue-400"
                        />
                      </td>

                      <td className="px-4 py-3 text-center">
                        {canEditInvoice && <button
                          type="button"
                          onClick={() => removeLineItem(index)}
                          title="Remove line item"
                          className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 size={17} />
                        </button>}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan="6"
                      className="px-5 py-10 text-center text-sm text-slate-500"
                    >
                      No line items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end border-t border-slate-100 p-5">
            <div className="text-right">
              <p className="text-sm text-slate-500">Invoice Total</p>

              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatCurrency(invoice.total_amount, invoice.currency)}
              </p>
            </div>
          </div>
        </section>

        {/* Save Button */}
        {canEditInvoice && <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}

            {saving ? "Saving..." : "Save Corrections"}
          </button>
        </div>}
        </fieldset>
      </form>

      {/* Extracted OCR Text */}
      <details className="rounded-xl border border-slate-200 bg-white p-5">
        <summary className="cursor-pointer font-semibold text-slate-800">
          View Extracted OCR Text
        </summary>

        <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs leading-6 text-slate-600">
          {invoice.extracted_text || "No extracted text available."}
        </pre>
      </details>
    </div>
  );
};

export default InvoiceDetails;
