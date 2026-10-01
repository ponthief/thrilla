import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import TangoPayoutCard from '../../components/TangoPayoutCard';
import { useAuthStore } from '@stores/authStore';
import { useSilntWallet } from '../../hooks/useSilntWallet';
import { Page } from './ui';
import { colors } from '@/theme';

// Where a Tango round's change goes — reachable from Settings, not only from
// the Tango screen.
//
// WHY IT IS HERE AS WELL. It is an account setting: saved on the server, per
// network, and it outlives any one round. Someone who switched it off went
// looking for it in Settings to switch it back on, and it was not there — the
// only copy was a card halfway down the Tango tab, which is where you go to
// start a round, not to change a preference. One component, rendered in both
// places, so the two cannot drift.
//
// The card is the whole page. It already decides what to render for a network
// or a server that does not offer this, so there is nothing to duplicate here
// — including rendering nothing at all, which is why the fallback below says
// what happened rather than leaving a blank page.

export default function TangoChangePage({ onBack }: { onBack: () => void }) {
  const inkey = useAuthStore((s) => s.inkey);
  const { wallet, loading, missing } = useSilntWallet();
  const network = wallet?.network ?? '';

  return (
    <Page
      title="Tango change"
      subtitle="Where the change from a round goes"
      onBack={onBack}>
      {/* Page already pads the gutter; the card brings its own frame. */}
      <View>
        {network ? (
          <TangoPayoutCard inkey={inkey} network={network} />
        ) : (
          <Text style={styles.muted}>
            {loading
              ? 'Loading…'
              : missing
                ? 'No Silent Payments wallet on this network yet.'
                : 'Could not read your wallet.'}
          </Text>
        )}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: colors.muted, marginTop: 16, lineHeight: 18 },
});
