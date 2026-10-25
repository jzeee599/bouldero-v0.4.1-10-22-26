import { createClient } from "@supabase/supabase-js";

// This release uses device storage even when legacy hosting variables exist.
const url: string = "";
const key: string = "";
export const cloudConfigurationError =
  Boolean(url) !== Boolean(key)
    ? "Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then redeploy."
    : url && !/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(url)
      ? "The Supabase Project URL must be an HTTPS project origin."
      : "";
export const cloudAvailable = Boolean(url && key && !cloudConfigurationError);
export const deviceModeKey = "bouldero-storage-mode";
function usesDeviceStorage() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(deviceModeKey) === "local";
  } catch {
    return false;
  }
}
export const deviceMode = usesDeviceStorage();
export const cloudEnabled = cloudAvailable && !deviceMode;
export const supabase = cloudEnabled ? createClient(url!, key!) : null;

export async function cloudOwner() {
  if (!supabase) throw new Error("Cloud storage is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.is_anonymous)
    throw new Error("Sign in with your email to open your private workspace.");
  const id = data.session.user.id;
  const { error: profileError } = await supabase
    .from("users")
    .upsert({ id }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError) throw profileError;
  return id;
}
