
const statusStyles = {
  UPLOADED: "bg-blue-50 text-blue-700 ring-blue-200",
  PROCESSING: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  VALIDATED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  REVIEW_REQUIRED: "bg-amber-50 text-amber-700 ring-amber-200",
  INVALID: "bg-red-50 text-red-700 ring-red-200",
  APPROVED: "bg-green-50 text-green-700 ring-green-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  ISSUED: "bg-blue-50 text-blue-700 ring-blue-200",
  PARTIALLY_RECEIVED: "bg-amber-50 text-amber-700 ring-amber-200",
  RECEIVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  OPEN: "bg-amber-50 text-amber-700 ring-amber-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  MATCHED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PARTIALLY_MATCHED: "bg-amber-50 text-amber-700 ring-amber-200",
  MISMATCHED: "bg-red-50 text-red-700 ring-red-200",
  NOT_FOUND: "bg-red-50 text-red-700 ring-red-200",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-200",
};

const StatusBadge = ({ status }) => {
  const normalizedStatus = status?.toUpperCase() || "UNKNOWN";

  const styles =
    statusStyles[normalizedStatus] ||
    "bg-slate-100 text-slate-600 ring-slate-200";

  const label = normalizedStatus.replaceAll("_", " ");

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles}`}
    >
      {label}
    </span>
  );
};

export default StatusBadge;
