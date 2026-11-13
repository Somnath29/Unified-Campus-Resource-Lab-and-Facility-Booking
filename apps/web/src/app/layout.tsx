import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'LPU Smart Campus | Unified Resource & Laboratory Booking Platform',
  description: 'Enterprise campus facility, classroom, laboratory, equipment, and venue reservation platform for Lovely Professional University.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#F5F5F5] text-[#292929] antialiased min-h-screen">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

