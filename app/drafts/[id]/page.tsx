import { DraftPage } from "@/components/local/Workspace";
export default async function Route({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DraftPage id={id} />;
}
