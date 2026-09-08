export const PASSWORD_RESET_PATH = "/reset-password/";
export const PRODUCTION_PASSWORD_RESET_REDIRECT_URL = "https://office.beeschool.jp/reset-password/";

export function getPasswordResetRedirectUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${PASSWORD_RESET_PATH}`;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://office.beeschool.jp";
  return `${siteUrl.replace(/\/+$/, "")}${PASSWORD_RESET_PATH}`;
}
