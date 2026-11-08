import { useEffect } from "react";
import { CheckCircle2, X } from "lucide-react";

const Toast = ({ message, onClose }) => {
  useEffect(() => {
    if (!message) return undefined;

    const timeout = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(timeout);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div
      role="status"
      className="fixed bottom-5 right-5 z-[60] flex max-w-sm items-center gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-emerald-800 shadow-lg"
    >
      <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
      <span>{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className="ml-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <X size={15} />
      </button>
    </div>
  );
};

export default Toast;
