import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { getRegistrationSettings } from "@/lib/api/client";

export const metadata: Metadata = { title: "Register" };

export default async function RegisterPage() {
  const { registrationMode } = await getRegistrationSettings();

  if (registrationMode === "invite-only") {
    redirect("/login");
  }

  return <RegisterForm registrationMode={registrationMode} />;
}
