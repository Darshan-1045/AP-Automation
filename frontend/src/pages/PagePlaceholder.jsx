
function PagePlaceholder({ title, description }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold text-slate-900">
        {title}
      </h1>

      <p className="text-sm text-slate-500">
        {description}
      </p>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="font-medium text-slate-700">
          {title} module
        </p>

        <p className="mt-2 text-sm text-slate-500">
          This module will be implemented in the upcoming development phase.
        </p>
      </div>
    </div>
  );
}

export default PagePlaceholder;
