import { redirect } from "next/navigation";
import { currentUser, listUsers } from "@/lib/auth";
import { Callout } from "@/components/ui";
import { LoginForm } from "./LoginForm";
import { branding } from "@/lib/team/branding";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  const hasUsers = listUsers().length > 0;
  const brand = branding();
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="font-display text-display font-extrabold tracking-tight text-ink-strong">{brand.appName}</h1>
      <p className="mt-1 text-label text-ink-muted">{brand.teamName ? `Key account workspace for ${brand.teamName}.` : "Key account workspace."}</p>
      {hasUsers ? (
        <LoginForm />
      ) : (
        <Callout tone="warning" className="mt-6">
          No users are configured. Set <code className="font-mono">USER1_EMAIL</code> and <code className="font-mono">USER1_PASSWORD</code> in the environment and
          restart.
        </Callout>
      )}
    </main>
  );
}
