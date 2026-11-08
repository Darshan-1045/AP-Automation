import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Plus,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  X,
  Mail,
  Phone,
} from "lucide-react";

import vendorService from "../services/vendorService";
import LoadingSpinner from "../components/common/LoadingSpinner";

const emptyForm = {
  vendor_name: "",
  gstin: "",
  email: "",
  phone: "",
  address: "",
  is_active: true,
  onboarding_status: "PENDING",
  bank_account_name: "",
  bank_account_number: "",
  bank_ifsc: "",
};

const Vendors = () => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [vendorToDelete, setVendorToDelete] = useState(null);
  const [deletingVendorId, setDeletingVendorId] = useState(null);
  const [deactivatingVendorId, setDeactivatingVendorId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchVendors = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);

      const data = await vendorService.getVendors();
      setVendors(Array.isArray(data) ? data : data.results || []);
      setError("");
    } catch {
      setError("Unable to load vendors. Please check the backend server.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchVendors();
  }, [fetchVendors]);

  const activeVendors = vendors.filter((vendor) => vendor.is_active);
  const inactiveVendors = vendors.filter((vendor) => !vendor.is_active);

  const filteredVendors = useMemo(() => {
    const query = search.toLowerCase().trim();

    return vendors.filter(
      (vendor) =>
        !query ||
        vendor.vendor_name?.toLowerCase().includes(query) ||
        vendor.gstin?.toLowerCase().includes(query) ||
        vendor.email?.toLowerCase().includes(query)
    );
  }, [vendors, search]);

  const openAddModal = () => {
    setSelectedVendor(null);
    setForm(emptyForm);
    setError("");
    setSuccess("");
    setShowModal(true);
  };

  const openEditModal = (vendor) => {
    setSelectedVendor(vendor);
    setForm({
      vendor_name: vendor.vendor_name || "",
      gstin: vendor.gstin || "",
      email: vendor.email || "",
      phone: vendor.phone || "",
      address: vendor.address || "",
      is_active: vendor.is_active,
      onboarding_status: vendor.onboarding_status || "PENDING",
      bank_account_name: vendor.bank_account_name || "",
      bank_account_number: vendor.bank_account_number || "",
      bank_ifsc: vendor.bank_ifsc || "",
    });
    setError("");
    setSuccess("");
    setShowModal(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setShowModal(false);
    setSelectedVendor(null);
    setForm(emptyForm);
    setError("");
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.vendor_name.trim()) {
      setError("Vendor name is required.");
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        ...form,
        vendor_name: form.vendor_name.trim(),
        gstin: form.gstin.trim().toUpperCase(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        bank_account_name: form.bank_account_name.trim(),
        bank_account_number: form.bank_account_number.trim(),
        bank_ifsc: form.bank_ifsc.trim().toUpperCase(),
      };

      if (selectedVendor) {
        await vendorService.updateVendor(selectedVendor.id, payload);
        setSuccess("Vendor updated successfully.");
      } else {
        await vendorService.createVendor(payload);
        setSuccess("Vendor created successfully.");
      }

      setShowModal(false);
      setForm(emptyForm);
      setSelectedVendor(null);
      await fetchVendors(true);
    } catch (err) {
      const data = err.response?.data;

      if (data && typeof data === "object") {
        const messages = Object.entries(data)
          .map(([field, value]) => {
            const message = Array.isArray(value) ? value.join(", ") : value;
            return `${field}: ${message}`;
          })
          .join(" | ");

        setError(messages || "Unable to save vendor.");
      } else {
        setError("Unable to save vendor. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (vendor) => {
    try {
      setDeletingVendorId(vendor.id);
      setError("");
      setSuccess("");
      await vendorService.deleteVendor(vendor.id);
      setVendors((previous) =>
        previous.filter((item) => item.id !== vendor.id)
      );
      setSuccess("Vendor deleted successfully.");
      setVendorToDelete(null);
      await fetchVendors(true);
    } catch (err) {
      const data = err.response?.data;
      const message =
        typeof data === "string"
          ? data
          : data?.detail ||
            "Unable to delete vendor. Please try again.";
      setError(message);
    } finally {
      setDeletingVendorId(null);
    }
  };

  const handleDeactivate = async (vendor) => {
    try {
      setDeactivatingVendorId(vendor.id);
      setError("");
      setSuccess("");
      await vendorService.updateVendor(vendor.id, { is_active: false });
      setVendors((previous) =>
        previous.map((item) =>
          item.id === vendor.id ? { ...item, is_active: false } : item
        )
      );
      setSuccess(
        `${vendor.vendor_name} was deactivated and retained for its financial history.`
      );
    } catch (err) {
      const data = err.response?.data;
      setError(
        data?.detail ||
          "Unable to deactivate vendor. Please try again."
      );
    } finally {
      setDeactivatingVendorId(null);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Vendor Management
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage vendor information and maintain your vendor master.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => fetchVendors(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-slate-800"
          >
            <RefreshCw
              size={16}
              className={refreshing ? "animate-spin" : ""}
            />
            Refresh
          </button>

          <button
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-teal-400"
          >
            <Plus size={17} />
            Add Vendor
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && !showModal && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
          <button
            onClick={() => setError("")}
            className="ml-3 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-3 text-sm text-teal-300">
          {success}
          <button
            onClick={() => setSuccess("")}
            className="ml-3 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {vendorToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-vendor-title"
            className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
          >
            <h2
              id="delete-vendor-title"
              className="text-lg font-semibold text-slate-100"
            >
              Delete vendor?
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Permanently delete {vendorToDelete.vendor_name}? Vendors with
              invoices, payments, purchase orders, or goods receipts must
              remain inactive to preserve their financial history.
            </p>
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
              >
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={deletingVendorId !== null}
                onClick={() => setVendorToDelete(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingVendorId !== null}
                onClick={() => handleDelete(vendorToDelete)}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingVendorId === vendorToDelete.id
                  ? "Deleting..."
                  : "Delete Vendor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Vendors"
          value={vendors.length}
          icon={Building2}
          color="text-blue-400"
          bg="bg-blue-500/10"
        />

        <StatCard
          title="Active Vendors"
          value={activeVendors.length}
          icon={CheckCircle2}
          color="text-teal-400"
          bg="bg-teal-500/10"
        />

        <StatCard
          title="Inactive Vendors"
          value={inactiveVendors.length}
          icon={XCircle}
          color="text-orange-400"
          bg="bg-orange-500/10"
        />
      </div>

      {/* Search */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search vendor, GSTIN or email..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-slate-200 outline-none transition placeholder:text-slate-500 focus:border-teal-500"
          />
        </div>

        <p className="text-sm text-slate-400">
          Showing{" "}
          <span className="font-semibold text-slate-200">
            {filteredVendors.length}
          </span>{" "}
          of {vendors.length} vendors
        </p>
      </div>

      {/* Vendor Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="font-semibold text-slate-100">
            Vendor Directory
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Vendor master records and contact information
          </p>
        </div>

        {filteredVendors.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Building2 size={36} className="mb-3 text-slate-600" />
            <h3 className="font-semibold text-slate-200">
              {search ? "No vendors found" : "No vendors added yet"}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {search
                ? "Try another search term."
                : "Add your first vendor to get started."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left">
              <thead className="bg-slate-950/70 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-4">Vendor</th>
                  <th className="px-5 py-4">GSTIN</th>
                  <th className="px-5 py-4">Contact</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800">
                {filteredVendors.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className="transition hover:bg-slate-800/40"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-400">
                          <Building2 size={19} />
                        </div>
                        <div>
                          <p className="font-medium text-slate-200">
                            {vendor.vendor_name}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Vendor ID: #{vendor.id}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-4 text-sm text-slate-300">
                      {vendor.gstin || "—"}
                    </td>

                    <td className="px-5 py-4">
                      <div className="space-y-1.5 text-xs text-slate-400">
                        {vendor.email && (
                          <p className="flex items-center gap-2">
                            <Mail size={13} />
                            {vendor.email}
                          </p>
                        )}
                        {vendor.phone && (
                          <p className="flex items-center gap-2">
                            <Phone size={13} />
                            {vendor.phone}
                          </p>
                        )}
                        {!vendor.email && !vendor.phone && "—"}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                          vendor.is_active
                            ? "bg-teal-500/10 text-teal-400"
                            : "bg-slate-700 text-slate-400"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            vendor.is_active
                              ? "bg-teal-400"
                              : "bg-slate-500"
                          }`}
                        />
                        {vendor.is_active ? "Active" : "Inactive"}
                      </span>
                      <p className="mt-1 text-xs text-slate-500">
                        Onboarding: {vendor.onboarding_status?.replaceAll("_", " ") || "Unknown"}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEditModal(vendor)}
                          title="Edit vendor"
                          className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:border-teal-500/50 hover:text-teal-400"
                        >
                          <Pencil size={15} />
                        </button>
                        {vendor.is_active ? (
                          <button
                            onClick={() => handleDeactivate(vendor)}
                            disabled={
                              deactivatingVendorId !== null ||
                              deletingVendorId !== null
                            }
                            title="Deactivate vendor and retain its history"
                            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-amber-500/50 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deactivatingVendorId === vendor.id
                              ? "Deactivating..."
                              : "Deactivate"}
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setError("");
                              setSuccess("");
                              setVendorToDelete(vendor);
                            }}
                            disabled={
                              deletingVendorId !== null ||
                              deactivatingVendorId !== null
                            }
                            title="Delete inactive vendor"
                            className="rounded-lg border border-slate-700 p-2 text-slate-400 transition hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Vendor Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  {selectedVendor ? "Edit Vendor" : "Add New Vendor"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Enter vendor master information
                </p>
              </div>

              <button
                onClick={closeModal}
                disabled={submitting}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 p-6">
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Vendor Name *
                </label>
                <input
                  name="vendor_name"
                  value={form.vendor_name}
                  onChange={handleChange}
                  required
                  placeholder="Enter vendor name"
                  className="vendor-form-input w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition hover:border-slate-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  GSTIN
                </label>
                <input
                  name="gstin"
                  value={form.gstin}
                  onChange={handleChange}
                  maxLength={15}
                  placeholder="29ABCDE1234F1Z5"
                  className="vendor-form-input w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 uppercase outline-none transition hover:border-slate-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="accounts@company.com"
                    className="vendor-form-input w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition hover:border-slate-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Phone
                  </label>
                  <input
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="Contact number"
                    className="vendor-form-input w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition hover:border-slate-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Address
                </label>
                <textarea
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Enter vendor address"
                  className="vendor-form-input w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition hover:border-slate-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-300">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={form.is_active}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border border-slate-600 bg-slate-950 accent-teal-500 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                />
                Active vendor
              </label>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Onboarding status
                </label>
                <select
                  name="onboarding_status"
                  value={form.onboarding_status}
                  onChange={handleChange}
                  className="vendor-form-input w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="PENDING">Pending</option>
                  <option value="UNDER_REVIEW">Under review</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </div>

              <fieldset className="space-y-4 rounded-xl border border-slate-700 p-4">
                  <legend className="px-2 text-sm font-semibold text-slate-200">
                    Bank details
                  </legend>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">
                      Account name
                    </label>
                    <input
                      name="bank_account_name"
                      value={form.bank_account_name}
                      onChange={handleChange}
                      autoComplete="off"
                      className="vendor-form-input w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-70"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">
                      Account number
                    </label>
                    <input
                      name="bank_account_number"
                      value={form.bank_account_number}
                      onChange={handleChange}
                      autoComplete="off"
                      inputMode="numeric"
                      className="vendor-form-input w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-70"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">
                      IFSC
                    </label>
                    <input
                      name="bank_ifsc"
                      value={form.bank_ifsc}
                      onChange={handleChange}
                      autoComplete="off"
                      maxLength={11}
                      className="vendor-form-input w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-70"
                    />
                  </div>
              </fieldset>

              <div className="flex justify-end gap-3 border-t border-slate-800 pt-5">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-teal-400 disabled:opacity-50"
                >
                  {submitting ? "Saving..." : selectedVendor ? "Save Changes" : "Create Vendor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, color, bg }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-400">{title}</p>
        <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
      </div>
      <div className={`rounded-xl p-3 ${bg} ${color}`}>
        <Icon size={22} />
      </div>
    </div>
  </div>
);

export default Vendors;