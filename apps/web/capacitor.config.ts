import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ajaxbuilding.granted',
  appName: 'Granted',
  webDir: 'dist',
  ios: {
    // Draw under the status bar; the header and screens add the safe-area padding themselves.
    contentInset: 'never',
    backgroundColor: '#0133A2',
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0, launchAutoHide: false, backgroundColor: '#0133A2', showSpinner: false },
    StatusBar: { style: 'DARK', overlaysWebView: true },
  },
};

export default config;
