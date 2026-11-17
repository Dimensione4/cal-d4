import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { checkOnboardingRedirect } from "@calcom/features/auth/lib/onboardingUtils";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

const RedirectPage = async () => {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });

  if (!session?.user?.id) {
    // D4: i visitori non loggati atterrano direttamente sul calendario di prenotazione.
    // Variabile runtime server-only: si cambia da Coolify senza rebuild.
    // Solo path relativi ("/x"), mai "//dominio": niente open redirect.
    const publicRoot = process.env.D4_PUBLIC_ROOT_PATH;
    redirect(publicRoot && /^\/[^/]/.test(publicRoot) ? publicRoot : "/auth/login");
  }

  // Check if user needs onboarding and redirect before going to event-types
  const organizationId = session.user.profile?.organizationId ?? null;
  const onboardingPath = await checkOnboardingRedirect(session.user.id, {
    checkEmailVerification: true,
    organizationId,
  });
  if (onboardingPath) {
    redirect(onboardingPath);
  }

  redirect("/event-types");
};

export default RedirectPage;
