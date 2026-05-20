/**
 * Plan 08-02 Task 5 — RecapCanonical → PDF Buffer (@react-pdf/renderer).
 *
 * Default Helvetica/Times font (research Open Q #7 — no custom embed in v1).
 * Reads RecapCanonical ONLY — never HTML.
 */
import * as React from 'react';
import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';
import type { RecapCanonical, Block } from '../schema';

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  heading2: { fontSize: 14, fontWeight: 700, marginTop: 12, marginBottom: 6 },
  paragraph: { marginBottom: 4, lineHeight: 1.4 },
  bullet: { marginLeft: 12, marginBottom: 2 },
  narrative: { marginBottom: 8, fontStyle: 'italic' },
  empty: { fontStyle: 'italic', color: '#888' },
});

function BlocksView({ blocks }: { blocks: Block[] }): JSX.Element {
  if (blocks.length === 0) {
    return <Text style={styles.empty}>(none)</Text>;
  }
  return (
    <View>
      {blocks.map((b, i) => {
        if (b.kind === 'paragraph') {
          return <Text key={i} style={styles.paragraph}>{b.text}</Text>;
        }
        if (b.kind === 'bullet_list') {
          return (
            <View key={i}>
              {b.items.map((item, j) => (
                <Text key={j} style={styles.bullet}>• {item}</Text>
              ))}
            </View>
          );
        }
        return (
          <View key={i}>
            {b.items.map((item, j) => (
              <Text key={j} style={styles.bullet}>{j + 1}. {item}</Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

export function RecapDocument({ canonical }: { canonical: RecapCanonical }): JSX.Element {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.heading2}>{canonical.meetings.heading}</Text>
        <BlocksView blocks={canonical.meetings.blocks} />
        <Text style={styles.heading2}>{canonical.actions.heading}</Text>
        <BlocksView blocks={canonical.actions.blocks} />
        <Text style={styles.heading2}>{canonical.wins.heading}</Text>
        <BlocksView blocks={canonical.wins.blocks} />
        <Text style={styles.heading2}>{canonical.upcoming.heading}</Text>
        <BlocksView blocks={canonical.upcoming.blocks} />
        <Text style={styles.heading2}>{canonical.whatAriaDid.heading}</Text>
        {canonical.whatAriaDid.narrative.trim().length > 0 ? (
          <Text style={styles.narrative}>{canonical.whatAriaDid.narrative}</Text>
        ) : null}
        <BlocksView blocks={canonical.whatAriaDid.blocks} />
      </Page>
    </Document>
  );
}

export async function exportRecapPdf(canonical: RecapCanonical): Promise<Buffer> {
  const instance = pdf(<RecapDocument canonical={canonical} />);
  // @react-pdf returns a NodeJS Buffer or Blob depending on platform; toBuffer
  // is the supported path under Node.
  const buf = await instance.toBuffer();
  return buf as unknown as Buffer;
}
