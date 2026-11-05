
import { Search, SlidersHorizontal } from "lucide-react";

const InvoiceFilters = ({
  search,
  setSearch,
  status,
  setStatus,
}) => {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice number or vendor..."
          className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div className="flex items-center gap-2 sm:w-56">
        <SlidersHorizontal size={17} className="text-slate-500" />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400"
        >
          <option value="ALL">All statuses</option>
          <option value="UPLOADED">Uploaded</option>
          <option value="PROCESSING">Processing</option>
          <option value="VALIDATED">Validated</option>
          <option value="REVIEW_REQUIRED">Review required</option>
          <option value="INVALID">Invalid</option>
        </select>
      </div>
    </div>
  );
};

export default InvoiceFilters;
