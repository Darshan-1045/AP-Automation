import { useState } from "react";
import { AlertTriangle, LoaderCircle, UserRoundPlus } from "lucide-react";

import invoiceService from "../../services/invoiceService";
import vendorService from "../../services/vendorService";

const editableVendorFields = [
  ["vendor_name", "Vendor name"],
  ["gstin", "GSTIN"],
  ["address", "Address"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["bank_account_name", "Bank account name"],
  ["bank_account_number", "Bank account number"],
  ["bank_ifsc", "Bank IFSC"],
];

const getErrorMessage = (error) => {
  const data = error.response?.data;
  if (typeof data === "string") return data;
  if (data?.detail) return data.detail;
  if (data && typeof data === "object") {
    return Object.entries(data)
      .map(([field, messages]) =>
        `${field}: ${Array.isArray(messages) ? messages.join(", ") : messages}`,
      )
      .join(" | ");
  }
  return "Unable to resolve the vendor. Please try again.";
};

const InvoiceVendorResolution = ({ invoice, onResolved }) => {
  const [vendors, setVendors] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [form, setForm] = useState(() => {
    const details = invoice?.extracted_vendor_details || {};
    return {
      vendor_name: invoice?.vendor_name || "",
      gstin: invoice?.vendor_gstin || "",
      address: details.address || "",
      email: details.email || "",
      phone: details.phone || "",
      bank_account_name: "",
      bank_account_number: "",
      bank_ifsc: "",
    };
  });
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const resolutionStatus = invoice?.vendor_resolution_status;
  const canResolve = [
    "NEW_VENDOR",
    "UNRESOLVED",
    "AMBIGUOUS",
    "INACTIVE",
    "PENDING",
  ].includes(resolutionStatus);
  const canRetry = Boolean(invoice?.processing_error);

  const loadVendors = async () => {
    try {
      setLoadingVendors(true);
      setError("");
      const data = await vendorService.getVendorOptions();
      setVendors(Array.isArray(data) ? data : data.results || []);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoadingVendors(false);
    }
  };

  const resolve = async (payload) => {
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const result = await invoiceService.resolveInvoiceVendor(invoice.id, payload);
      onResolved?.(result.invoice, result.message);
      setNotice(result.message || "Vendor associated with the invoice.");
      setRegistrationOpen(false);
      setSelectionOpen(false);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  const retryProcessing = async () => {
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const updatedInvoice = await invoiceService.retryInvoiceProcessing(invoice.id);
      onResolved?.(updatedInvoice, "Invoice processing was retried.");
      setNotice("Invoice processing was retried.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  };

  if (!canResolve && !canRetry) return null;

  const panelTitle = resolutionStatus === "INACTIVE"
    ? "Matched vendor is inactive"
    : resolutionStatus === "AMBIGUOUS"
      ? "Select the correct vendor"
      : resolutionStatus === "NEW_VENDOR"
        ? "New Vendor Detected"
        : "Vendor details need attention";

  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      {canResolve && (
        <>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={19} />
            <div>
              <h3 className="font-semibold text-amber-900">{panelTitle}</h3>
              <p className="mt-1 text-sm text-amber-800">
                {resolutionStatus === "NEW_VENDOR"
                  ? "New vendor detected. Please register or verify vendor details to continue."
                  : resolutionStatus === "INACTIVE"
                    ? "This vendor was not reactivated. Select an active vendor or review the invoice."
                    : "Select or register the correct vendor to continue invoice validation."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pl-8">
            <button
              type="button"
              onClick={() => {
                setRegistrationOpen((open) => !open);
                setSelectionOpen(false);
              }}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              <UserRoundPlus size={16} />
              Register New Vendor
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectionOpen((open) => !open);
                setRegistrationOpen(false);
                if (!vendors.length) loadVendors();
              }}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Select Existing Vendor
            </button>
          </div>
        </>
      )}

      {registrationOpen && (
        <form
          className="grid gap-3 border-t border-amber-200 pt-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            resolve({ vendor: form });
          }}
        >
          <p className="text-sm text-slate-600 sm:col-span-2">
            Review the extracted contact details. Bank information is not read from the invoice; enter it only when verified.
          </p>
          {editableVendorFields.map(([name, label]) => (
            <label key={name} className="text-sm font-medium text-slate-700">
              {label}
              {name === "address" ? (
                <textarea
                  name={name}
                  rows={2}
                  value={form[name] || ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [name]: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              ) : (
                <input
                  name={name}
                  type={name === "email" ? "email" : "text"}
                  value={form[name] || ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [name]: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              )}
            </label>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={saving || !form.vendor_name?.trim()}
              className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Registering..." : "Register and Associate"}
            </button>
            <button
              type="button"
              onClick={() => setRegistrationOpen(false)}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {selectionOpen && (
        <div className="flex flex-wrap items-end gap-2 border-t border-amber-200 pt-4">
          <label className="min-w-[220px] flex-1 text-sm font-medium text-slate-700">
            Existing vendor
            <select
              value={selectedVendorId}
              onChange={(event) => setSelectedVendorId(event.target.value)}
              disabled={loadingVendors || saving}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">
                {loadingVendors ? "Loading vendors..." : "Choose a vendor"}
              </option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.vendor_name}
                  {!vendor.is_active ? " (Inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => resolve({ vendor_id: Number(selectedVendorId) })}
            disabled={!selectedVendorId || saving || loadingVendors}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Associating..." : "Associate Vendor"}
          </button>
        </div>
      )}

      {canRetry && (
        <div className="border-t border-amber-200 pt-3">
          <button
            type="button"
            onClick={retryProcessing}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-60"
          >
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : null}
            {saving ? "Processing..." : "Retry Processing"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm font-medium text-emerald-800">{notice}</p>}
    </section>
  );
};

export default InvoiceVendorResolution;
