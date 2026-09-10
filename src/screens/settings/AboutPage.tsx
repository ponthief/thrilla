import React from 'react';
import { Linking } from 'react-native';
import { Group, Help, InfoRow, NavRow, Page } from './ui';

const REPO = 'https://github.com/ponthief/thrilla';

export default function AboutPage({ onBack }: { onBack: () => void }) {
  return (
    <Page title="About" onBack={onBack}>
      <Group title="Version">
        <InfoRow first title="Thrilla" value="0.1.0" />
      </Group>

      <Group title="Source">
        <NavRow
          first
          title="Source code"
          help="github.com/ponthief/thrilla"
          onPress={() => Linking.openURL(REPO).catch(() => {})}
        />
      </Group>

      <Help>
        Set in IBM Plex, by IBM, under the SIL Open Font License 1.1.
      </Help>
    </Page>
  );
}
