import { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json. Cleartext HTTP is allowed ONLY when the API URL is plain http:// (LAN pilot).
 * Production builds must use an https:// API URL, which keeps Android's cleartext block in place.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
  const cleartext = apiUrl.startsWith('http://');
  return {
    ...(config as ExpoConfig),
    plugins: [
      ...(config.plugins ?? []),
      ['expo-build-properties', { android: { usesCleartextTraffic: cleartext } }],
    ],
  };
};
