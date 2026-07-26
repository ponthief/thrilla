import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Camera, CameraType } from 'react-native-camera-kit';
import { colors } from '@/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScanned: (value: string) => void;
}

type PermState = 'checking' | 'granted' | 'denied';

export default function QRScanner({ visible, onClose, onScanned }: Props) {
  const [perm, setPerm] = useState<PermState>('checking');
  const handled = useRef(false);

  useEffect(() => {
    if (!visible) {
      handled.current = false;
      setPerm('checking');
      return;
    }
    let active = true;
    (async () => {
      if (Platform.OS === 'android') {
        try {
          const res = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
          );
          if (active) {
            setPerm(res === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
          }
        } catch {
          if (active) setPerm('denied');
        }
      } else {
        // iOS: camera-kit triggers its own permission prompt.
        setPerm('granted');
      }
    })();
    return () => {
      active = false;
    };
  }, [visible]);

  const onRead = useCallback(
    (event: any) => {
      if (handled.current) return;
      const value = event?.nativeEvent?.codeStringValue;
      if (!value) return;
      handled.current = true; // guard against multiple rapid reads
      onScanned(String(value).trim());
      onClose();
    },
    [onScanned, onClose],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {perm === 'granted' ? (
          <Camera
            style={StyleSheet.absoluteFill}
            cameraType={CameraType.Back}
            scanBarcode
            onReadCode={onRead}
          />
        ) : perm === 'denied' ? (
          <View style={styles.center}>
            <Text style={styles.msg}>
              Camera permission is required to scan. Enable it for Thrilla in
              your device settings.
            </Text>
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={styles.msg}>Requesting camera…</Text>
          </View>
        )}

        {perm === 'granted' ? (
          <View style={styles.overlay} pointerEvents="box-none">
            <View style={styles.frame} />
            <Text style={styles.hint}>Point at a QR code</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  msg: { color: '#fff', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: colors.primary,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  hint: { color: '#fff', fontSize: 14, marginTop: 20, fontWeight: '600' },
  cancel: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  cancelText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
