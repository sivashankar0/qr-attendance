/**
 * Guided face capture with an oval guide and step prompts.
 *
 * The app only CAPTURES frames. Every decision (face present, quality, match, liveness) is made by
 * the server. Frames are resized in memory, sent once over TLS, and never saved by the app.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, StyleSheet, Text, View } from 'react-native';

import { colors, space } from '@/lib/theme';

import { Banner, Body, Button } from './ui';

export interface CaptureStep {
  key: string;
  prompt: string;
  arrow?: 'left' | 'right';
  frames: number;
  settleMs: number; // time given to the student to get into position
  gapMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function FaceCapture({
  steps,
  onComplete,
  onCancel,
  header,
  startLabel = 'Start',
}: {
  steps: CaptureStep[];
  onComplete: (frames: Record<string, string[]>) => void;
  onCancel?: () => void;
  header?: React.ReactNode;
  startLabel?: string;
}) {
  usePreventScreenCapture(); // FLAG_SECURE on this screen (roadmap 10.5)
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [prompt, setPrompt] = useState('Place your face inside the oval');
  const [arrow, setArrow] = useState<'left' | 'right' | undefined>();
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const announce = (text: string) => {
    setPrompt(text);
    AccessibilityInfo.announceForAccessibility(text);
  };

  const grab = useCallback(async (): Promise<string> => {
    const pic = await camera.current!.takePictureAsync({ quality: 0.7, shutterSound: false });
    const ctx = ImageManipulator.manipulate(pic.uri);
    ctx.resize({ width: 720 });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: 0.8, format: SaveFormat.JPEG, base64: true });
    if (!out.base64) throw new Error('capture failed');
    return out.base64;
  }, []);

  const run = useCallback(async () => {
    if (!camera.current || !ready) return;
    setRunning(true);
    setError(null);
    const result: Record<string, string[]> = {};
    try {
      for (const step of steps) {
        announce(step.prompt);
        setArrow(step.arrow);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await sleep(step.settleMs);
        result[step.key] = [];
        for (let i = 0; i < step.frames; i++) {
          if (!mounted.current) return;
          result[step.key].push(await grab());
          if (i < step.frames - 1) await sleep(step.gapMs);
        }
      }
      setArrow(undefined);
      announce('Checking…');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onComplete(result);
    } catch {
      if (mounted.current) {
        setError('The camera could not take a picture. Try again, or ask your teacher for manual verification.');
        setRunning(false);
        setArrow(undefined);
        announce('Place your face inside the oval');
      }
    }
  }, [grab, onComplete, ready, steps]);

  if (!permission) return <View style={{ flex: 1 }} />;

  if (!permission.granted) {
    return (
      <View style={{ padding: space.lg, gap: space.lg }}>
        <Banner kind="warning" title="Camera permission is required">
          <Body>
            The camera is used only while this screen is open, to check that it is really you. Photos are not stored on
            your phone.
          </Body>
        </Banner>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Button title="Open settings" onPress={() => Linking.openSettings()} />
        )}
        {onCancel ? <Button title="Request teacher verification instead" variant="secondary" onPress={onCancel} /> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="front"
        onCameraReady={() => setReady(true)}
        onMountError={() => setError('The camera is not available. It may be in use by another app.')}
      />
      {/* oval guide */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.ovalWrap}>
          <View style={[styles.oval, running && { borderColor: colors.success }]} />
        </View>
      </View>
      <View style={styles.top}>{header}</View>
      <View style={styles.bottom}>
        <View style={styles.promptBox} accessibilityLiveRegion="assertive">
          {arrow ? <Text style={styles.arrow}>{arrow === 'left' ? '⟵' : '⟶'}</Text> : null}
          <Text style={styles.prompt}>{prompt}</Text>
          {!running ? (
            <Text style={styles.hint}>Good light on your face · Remove sunglasses or mask if you can · Hold the phone at eye level</Text>
          ) : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!running ? (
          <View style={{ gap: space.sm }}>
            <Button title={ready ? startLabel : 'Opening camera…'} onPress={run} disabled={!ready} />
            {onCancel ? <Button title="Cancel" variant="ghost" onPress={onCancel} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ovalWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 120 },
  oval: {
    width: 250,
    height: 330,
    borderRadius: 165,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  top: { position: 'absolute', top: space.lg, left: space.lg, right: space.lg },
  bottom: { position: 'absolute', bottom: space.xl, left: space.lg, right: space.lg, gap: space.md },
  promptBox: { backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 16, padding: space.lg, alignItems: 'center', gap: 6 },
  arrow: { color: '#fff', fontSize: 48, fontWeight: '800' },
  prompt: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  hint: { color: '#D8DDE6', fontSize: 14, textAlign: 'center' },
  error: { color: '#fff', backgroundColor: colors.danger, padding: space.md, borderRadius: 12, fontSize: 15 },
});
