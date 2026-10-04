import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

const development = process.env.NODE_ENV !== 'production';
// NEXT_PUBLIC_API_URL is the API the pages call; NEXT_PUBLIC_APP_URL (optional) is the public https address of the site.
const https = /^https:\/\//i.test(process.env.NEXT_PUBLIC_API_URL || '') || /^https:\/\//i.test(process.env.NEXT_PUBLIC_APP_URL || '');

const nextConfig: NextConfig = {
  // Do not announce the framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders({ apiUrl: process.env.NEXT_PUBLIC_API_URL, development, https }) }];
  },
};

export default nextConfig;
