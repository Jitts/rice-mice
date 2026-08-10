export default function DashboardLoading() {
  // Renders inside the dashboard shell, so this is content-only. The width
  // must track DashboardClient's wrapper — if they disagree the page visibly
  // jumps width the moment the skeleton is replaced.
  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-pulse">
      <div className="h-8 w-64 bg-muted rounded" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="h-20 bg-card border border-border rounded-xl" />
        <div className="h-20 bg-card border border-border rounded-xl" />
        <div className="h-20 bg-card border border-border rounded-xl" />
        <div className="h-20 bg-card border border-border rounded-xl" />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="h-40 bg-card border border-border rounded-xl" />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="h-40 bg-card border border-border rounded-xl" />
      </div>
    </div>
  );
}
