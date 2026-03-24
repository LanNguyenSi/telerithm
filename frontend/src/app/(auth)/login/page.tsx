import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { getRegistrationSettings } from "@/lib/api/client";

export const metadata: Metadata = { title: "Sign In" };

export default async function LoginPage() {
  const { registrationMode } = await getRegistrationSettings();

  return <LoginForm registrationMode={registrationMode} />;
}
