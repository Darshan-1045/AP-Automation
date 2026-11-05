
import { LoaderCircle } from "lucide-react";

const LoadingSpinner = ({ size = 28, message }) => {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <LoaderCircle
        size={size}
        className="animate-spin text-blue-600"
      />

      {message && (
        <p className="text-sm text-slate-500">{message}</p>
      )}
    </div>
  );
};

export default LoadingSpinner;
