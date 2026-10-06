import { BACKEND_URL, BACKEND_ANON_KEY } from './lib/backendOrigin';
export const WHITELABEL = {
  clientName: 'Lemtel Communications',
  appName: 'Lemtel Telecom',
  tagline: 'Business communications, simplified',
  primaryColor: '#003DA6',
  accentColor: '#FFD700',
  backgroundColor: '#0a0a1a',
  logoPath: '/assets/lemtel-logo.svg',
  logoType: 'lemtel' as 'lemtel' | 'ava' | 'custom',
  portalUrl: 'https://avastatistic.ca',
  providerName: 'Lemtel Communications',
  providerUrl: 'https://lemtel.avastatistic.ca',
  providerLogo: 'lemtel',
  supabaseUrl: BACKEND_URL,
  supabaseAnonKey:
    BACKEND_ANON_KEY,
};
