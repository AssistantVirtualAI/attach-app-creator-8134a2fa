import { BACKEND_URL, BACKEND_ANON_KEY } from './lib/backendOrigin';
export const WHITELABEL = {
  clientName: 'Lemtel Communications',
  appName: 'Lemtel Telecom',
  tagline: 'Powered by AVA AI',
  primaryColor: '#003DA6',
  accentColor: '#FFD700',
  backgroundColor: '#0a0a1a',
  logoPath: '/assets/lemtel-logo.svg',
  logoType: 'lemtel' as 'lemtel' | 'ava' | 'custom',
  portalUrl: 'https://avastatistic.ca',
  providerName: 'AVA AI',
  providerUrl: 'https://assistantvirtualai.com',
  providerLogo: 'ava',
  supabaseUrl: BACKEND_URL,
  supabaseAnonKey:
    BACKEND_ANON_KEY,
};
