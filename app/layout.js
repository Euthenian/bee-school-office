import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

export const metadata = {
  title: "Bee School Office",
  description: "Internal school and franchise management for Bee School.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://office.beeschool.jp")
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
