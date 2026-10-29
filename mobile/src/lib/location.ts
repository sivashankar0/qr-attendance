import * as Location from 'expo-location';

/** Position sent to the server for the classroom geofence check. Read once, never tracked. */
export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
  mocked: boolean;
}

export class LocationError extends Error {
  kind: 'denied' | 'blocked' | 'off' | 'timeout';
  constructor(kind: LocationError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race<T>([p, new Promise<T>((_, rej) => setTimeout(() => rej(new LocationError('timeout', 'timeout')), ms))]);

export async function getFix(timeoutMs = 15000): Promise<Fix> {
  let perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    throw new LocationError(
      perm.canAskAgain ? 'denied' : 'blocked',
      'Location permission is needed to confirm you are in the classroom.',
    );
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new LocationError('off', 'Location is turned off. Turn it on in your phone settings.');
  }
  try {
    const pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), timeoutMs);
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? 9999,
      mocked: !!pos.mocked,
    };
  } catch (e) {
    if (e instanceof LocationError) throw new LocationError('timeout', 'Could not get your location. Move near a window and try again.');
    throw new LocationError('timeout', 'Could not get your location. Try again.');
  }
}
