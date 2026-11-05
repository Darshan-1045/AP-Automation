
import { TrendingUp } from "lucide-react";

function StatCard({ title, value, description, icon: Icon, color }) {
  const colorStyles = {
    teal: "bg-teal-50 text-teal-600",
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <h3 className="mt-3 text-2xl font-bold text-slate-900">
            {value}
          </h3>
        </div>

        <div className={`rounded-xl p-3 ${colorStyles[color] || colorStyles.blue}`}>
          {Icon && <Icon size={22} />}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <TrendingUp size={14} />
        {description}
      </div>
    </div>
  );
}

export default StatCard;
