import { getTeamBySlug } from "@/lib/team";
import { notFound } from "next/navigation";

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return notFound();

  return <>{children}</>;
}
