import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { LegalDoc } from "@/src/lib/legal";

export default async function LegalPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const normalized = page === "privacy" ? "privacy" : "terms";
  return (
    <main className="site-page light-page">
      <SiteHeader />
      <LegalDoc page={normalized} />
      <SiteFooter />
    </main>
  );
}
