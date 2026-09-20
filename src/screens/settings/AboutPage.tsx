import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';
import { Group, Help, InfoRow, NavRow, Page } from './ui';
import { APP_VERSION } from '@/version';
import {
  checkForUpdate,
  flavorAssetName,
  RELEASES_URL,
  UpdateCheckError,
} from '@services/updateCheck';

const REPO = 'https://github.com/ponthief/thrilla';
const VERIFY = 'https://whispawallet.com/download.html#verify';

export default function AboutPage({ onBack }: { onBack: () => void }) {
  const [checking, setChecking] = useState(false);

  const open = (url: string) => Linking.openURL(url).catch(() => {});

  const onCheck = useCallback(async () => {
    setChecking(true);
    try {
      const status = await checkForUpdate();
      if (!status.updateAvailable) {
        Alert.alert(
          'Up to date',
          `You have ${status.current}, which is the newest release.`,
        );
        return;
      }

      // The APK's signing certificate is checked by Android on every update, so
      // an APK signed by any other key cannot replace this one. Saying so is
      // what makes tapping "Download" a reasonable thing to do.
      const body =
        `${status.latest.version} is out — you have ${status.current}.\n\n` +
        'Download replaces this app in place. Android only accepts an update ' +
        'signed with the same key, so your wallet and keys stay where they are.';

      const buttons = [
        { text: 'Later', style: 'cancel' as const },
        {
          text: 'Release notes',
          onPress: () => open(status.latest.pageUrl),
        },
        ...(status.latest.apkUrl
          ? [
              {
                text: 'Download',
                onPress: () => open(status.latest.apkUrl as string),
              },
            ]
          : []),
      ];

      Alert.alert(
        `WhiSPa ${status.latest.version}`,
        status.latest.apkUrl
          ? body
          : `${body}\n\nThis release has no ${flavorAssetName()} to download — ` +
            'open the release notes to see what it does have.',
        buttons,
      );
    } catch (e: any) {
      Alert.alert(
        'Could not check',
        e instanceof UpdateCheckError
          ? e.message
          : e?.message || 'The update check did not complete.',
      );
    } finally {
      setChecking(false);
    }
  }, []);

  return (
    <Page title="About" onBack={onBack}>
      <Group title="Version">
        <InfoRow first title="WhiSPa" value={APP_VERSION} />
        {checking ? (
          <View style={{ paddingVertical: 14, alignItems: 'center' }}>
            <ActivityIndicator />
          </View>
        ) : (
          <NavRow
            title="Check for updates"
            help="Asks github.com — only when you tap it"
            onPress={onCheck}
          />
        )}
      </Group>

      <Group title="Source">
        <NavRow
          first
          title="Source code"
          help="github.com/ponthief/thrilla"
          onPress={() => open(REPO)}
        />
        <NavRow
          title="All releases"
          help="Every version, with checksums and signatures"
          onPress={() => open(RELEASES_URL)}
        />
        <NavRow
          title="Verify a download"
          help="whispawallet.com/download.html#verify"
          onPress={() => open(VERIFY)}
        />
      </Group>

      <Help>
        Set in Geist and Geist Mono, by Vercel with basement.studio, under the
        SIL Open Font License 1.1.
      </Help>
    </Page>
  );
}
