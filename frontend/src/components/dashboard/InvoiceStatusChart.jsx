
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

const STATUS_COLORS = {
  UPLOADED: "#64748b",
  REVIEW_REQUIRED: "#f59e0b",
  VALID: "#14b8a6",
  APPROVED: "#3b82f6",
  INVALID: "#f43f5e",
  PAID: "#8b5cf6",
};

function InvoiceStatusChart({ invoices = [] }) {
  const statusCounts = invoices.reduce((acc, invoice) => {
    const status = invoice.status || "UNKNOWN";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const data = Object.entries(statusCounts).map(([status, count]) => ({
    name: status.replaceAll("_", " "),
    value: count,
    color: STATUS_COLORS[status] || "#94a3b8",
  }));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="font-semibold text-slate-800">
          Invoice Status
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Distribution of invoices by processing status
        </p>
      </div>

      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-slate-400">
          No invoice data available
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="45%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={4}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>

              <Tooltip />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                wrapperStyle={{ fontSize: "11px" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default InvoiceStatusChart;
