import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist_Mono, Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { dictionaryFor } from '@/lib/i18n/dictionaries';
import { getLocale } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';
import { AuthProvider } from '@/lib/auth';

import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Finansify',
  description: 'Investment-portfolio tracker for a Polish investor.',
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn('h-full', 'antialiased', inter.variable, geistMono.variable)}
    >
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
            <I18nProvider locale={locale} dictionary={dictionaryFor(locale)}>
              <TooltipProvider>{children}</TooltipProvider>
            </I18nProvider>
          </ThemeProvider>
        </AuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
