import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lemtel.softphone',
  appName: 'Lemtel Softphone',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  ios: {
    allowsLinkPreview: false,
    scrollEnabled: false,
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 1800,
      backgroundColor: '#EEF3FB',
      showSpinner: false,
    },
    StatusBar: {
      style: 'light',
      backgroundColor: '#0023e6',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#0023e6',
    },
  },
};

export default config;
