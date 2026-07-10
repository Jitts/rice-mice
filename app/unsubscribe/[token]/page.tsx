import { UnsubscribeForm } from "@/components/UnsubscribeForm";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <UnsubscribeForm token={token} />
    </main>
  );
}
