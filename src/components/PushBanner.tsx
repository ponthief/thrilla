import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePushBanner } from '@stores/pushBanner';
import { colors } from '@/theme';

// Renders foreground push messages as a dismissible banner at the top of the
// screen. Android suppresses FCM notification display while the app is in the
// foreground, so this is how a payment that arrives with the app open becomes
// visible. Auto-dismisses after a few seconds; tap to dismiss immediately.
const AUTO_DISMISS_MS = 6000;

export default function PushBanner() {
  const banner = usePushBanner((s) => s.banner);
  const clear = usePushBanner((s) => s.clear);
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    if (!banner) return;
    Animated.spring(slide, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
    }).start();
    const t = setTimeout(() => clear(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [banner, slide, clear]);

  if (!banner) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { paddingTop: insets.top + 10, transform: [{ translateY: slide }] },
      ]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={clear}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`${banner.title}. ${banner.body}`}>
        {/* The full-colour mark, which a system notification cannot carry —
            its small icon is an alpha mask, so the logo would flatten to a
            blob there. This banner is our own view, so it can show the real
            thing, and it is the surface seen most often: Android leaves
            notifications to the app while the app is open. */}
        <Image
          source={require('../assets/icon.png')}
          style={styles.mark}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {banner.title}
          </Text>
          <Text style={styles.body} numberOfLines={3}>
            {banner.body}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 10,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.green,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // Same radius-to-size ratio as the Wallet tab's masthead mark, so the two
  // read as one logo at two sizes rather than two different treatments.
  mark: { width: 36, height: 36, borderRadius: 8 },
  // flexShrink, or a long body pushes the mark off the left edge instead of
  // wrapping.
  text: { flex: 1, flexShrink: 1 },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  body: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
});
