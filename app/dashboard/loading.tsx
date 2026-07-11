export default function DashboardLoading() {
  // Renders inside the dashboard shell, so this is content-only.
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-pulse">
      <div className="h-8 w-64 bg-neutral-200 rounded" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="h-20 bg-white border border-neutral-200 rounded-xl" />
        <div className="h-20 bg-white border border-neutral-200 rounded-xl" />
        <div className="h-20 bg-white border border-neutral-200 rounded-xl" />
        <div className="h-20 bg-white border border-neutral-200 rounded-xl" />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-32 bg-neutral-200 rounded" />
        <div className="h-40 bg-white border border-neutral-200 rounded-xl" />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-32 bg-neutral-200 rounded" />
        <div className="h-40 bg-white border border-neutral-200 rounded-xl" />
      </div>
    </div>
  );
}
