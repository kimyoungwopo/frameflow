import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.FRAMEFLOW_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4310'),
  title: 'Frameflow — 이미지 작업실',
  description: '이미지 작업을 흐름으로 만들고 결과를 완성하는 크리에이티브 스튜디오',
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    siteName: 'Frameflow',
    url: '/',
    title: 'Frameflow — 이미지 작업실',
    description: '이미지 작업을 흐름으로 만들고 결과를 완성하는 크리에이티브 스튜디오',
    images: [{ url: '/og-image.jpg?v=2', width: 1200, height: 630, alt: 'Frameflow 이미지 작업실 — 이미지 작업을 흐름으로' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Frameflow — 이미지 작업실',
    description: '이미지 작업을 흐름으로 만들고 결과를 완성하는 크리에이티브 스튜디오',
    images: ['/og-image.jpg?v=2'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
