export default function DashboardLoading() {
  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto space-y-10 animate-pulse">
      <div className="h-8 w-64 bg-neutral-200 rounded" />
      <div className="space-y-3">
        <div className="h-5 w-32 bg-neutral-200 rounded" />
        <div className="h-6 bg-neutral-100 rounded" />
        <div className="h-6 bg-neutral-100 rounded" />
        <div className="h-6 bg-neutral-100 rounded" />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-32 bg-neutral-200 rounded" />
        <div className="h-6 bg-neutral-100 rounded" />
        <div className="h-6 bg-neutral-100 rounded" />
      </div>
    </main>
  );
}
