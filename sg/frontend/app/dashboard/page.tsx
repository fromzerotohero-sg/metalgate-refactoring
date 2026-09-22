import { redirect } from "next/navigation";

/**
 * `/dashboard` is an alias for `/account`.
 *
 * The backend's `SG_DASHBOARD_URL` sends users here after email verification (when
 * the link carried no `redirect`) and when returning from the Stripe portal. Its
 * default now points at `/account`, but the alias is kept so that either value
 * works — including any environment already configured with `/dashboard`, and any
 * link a platform may have hardcoded. The cost of the alias is one route.
 */
export default function DashboardPage() {
  redirect("/account");
}
