import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { getWalletKeys } from '@services/secureKeys';
import { useBalancesHidden, MASK } from '@stores/balancePrivacy';
import * as pj from '@services/spPayjoin';
import { parseSpAddress, fromHex, toHex } from '@services/spSign';
import { colors, space, type as type_ } from '@/theme';
import { Block, Button, Field, Group, InfoRow, Note, Page } from './ui';

// Silent Payments PayJoin, from this device.
//
// WHAT A PAYJOIN IS FOR, since the screen has to say it in a sentence: an
// ordinary send has every input belonging to the sender, which is the single
// most useful assumption chain analysis makes. A PayJoin breaks it — the
// recipient contributes an input too, so an observer cannot tell which inputs
// are whose, and the heuristic that links all of a transaction's inputs to one
// owner is simply wrong about this transaction.
//
// WHAT THIS SCREEN NEVER DOES. It derives its own output and signs its own
// inputs here, on the phone. The scan key and the spend key do not leave the
// keychain; what goes to the server is a scriptPubKey and a signature, both of
// which end up on chain anyway. services/spPayjoin.ts has the derivation and,
// more importantly, the checks that run before anything is signed.

type Row = api.PayjoinSpRequestRow;

function parseInputs(raw?: string | null): pj.PayjoinInput[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export default function PayjoinPage({ onBack }: { onBack: () => void }) {
  const inkey = useAuthStore((s) => s.inkey);
  const hidden = useBalancesHidden();

  const [walletId, setWalletId] = useState<string | null>(null);
  const [network, setNetwork] = useState('signet');
  const [spAddress, setSpAddress] = useState('');
  const [coins, setCoins] = useState<api.Utxo[]>([]);
  const [incoming, setIncoming] = useState<Row[]>([]);
  const [outgoing, setOutgoing] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');

  const load = useCallback(async () => {
    if (!inkey) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const wallets = await api.getSilntWallets(inkey);
      const w = api.pickSilntWallet(wallets);
      if (!w) {
        setError('No Silent Payments wallet on this network.');
        setWalletId(null);
        return;
      }
      setWalletId(w.id);
      setNetwork(w.network);
      setSpAddress(w.sp_address);
      const [utxos, queues] = await Promise.all([
        api.getUtxos(inkey, w.id),
        api.listPayjoinSp(inkey),
      ]);
      setCoins(utxos.filter((u) => u.utxo_state === 'unspent' && !u.frozen));
      setIncoming(queues.incoming);
      setOutgoing(queues.outgoing);
    } catch (e: any) {
      setError(e?.message || 'Could not load PayJoins.');
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * One coin, chosen the way this first pass chooses: the smallest that covers
   * what is needed.
   *
   * Deliberately not the coin picker from the Send screen. Choosing coins for a
   * PayJoin is a privacy decision of its own — which of your coins you are
   * willing to show the other party, and whether spending two of them together
   * links them — and quietly reusing a picker built for a different question
   * would make that choice for the user without saying so. Until there is a
   * picker that asks it properly, this takes one coin and shows which.
   */
  const pickCoin = useCallback(
    (need: number): api.Utxo | null => {
      const usable = coins
        .filter((c) => c.amount >= need)
        .sort((a, b) => a.amount - b.amount);
      return usable[0] || null;
    },
    [coins],
  );

  const wire = (u: api.Utxo): api.PayjoinSpWireInput => ({
    txid: u.txid,
    vout: u.vout,
    pub_key: u.pub_key,
    amount: u.amount,
  });

  const local = (u: api.Utxo): pj.PayjoinInput => ({
    txid: u.txid,
    vout: u.vout,
    amount: u.amount,
    pub_key: u.pub_key,
    priv_key_tweak: u.priv_key_tweak,
  });

  const fail = (e: any) => {
    setMsg(null);
    setError(e?.message || 'Something went wrong.');
  };

  // ── payer: propose ──
  const propose = useCallback(async () => {
    if (!inkey || !walletId) return;
    const sats = Number(amount);
    if (!Number.isFinite(sats) || sats <= 0) {
      setError('Enter an amount in sats.');
      return;
    }
    // A rough floor: the amount plus a fee for a 2-in-2-out taproot spend.
    const need = sats + pj.estimateFee(2, 2, 2).fee;
    const coin = pickCoin(need);
    if (!coin) {
      setError(
        `No single coin covers ${sats} sats plus the fee. Consolidating first ` +
          `would link the coins, so this does not do it for you.`,
      );
      return;
    }
    setBusy('propose');
    setError(null);
    try {
      await api.proposePayjoinSp(inkey, {
        payer_wallet_id: walletId,
        payee_username: payee.trim(),
        amount_sats: sats,
        fee_rate: 2,
        inputs: [wire(coin)],
        network,
      });
      setPayee('');
      setAmount('');
      setMsg('Sent. They have to accept before anything is signed.');
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [inkey, walletId, amount, payee, network, pickCoin, load]);

  // ── payee: contribute, which means deriving the payment output here ──
  const contribute = useCallback(
    async (row: Row) => {
      if (!inkey || !walletId) return;
      setBusy(row.id);
      setError(null);
      try {
        const keys = await getWalletKeys(walletId);
        if (!keys) throw new Error('This device does not hold this wallet’s keys.');

        // Any coin will do for the payee — it comes straight back out in the
        // payment, so the payee is no worse off for contributing it. The
        // smallest one keeps the least exposed.
        const coin = pickCoin(1);
        if (!coin) throw new Error('You have no coin to contribute.');

        // The complete input set, which exists for the first time right here.
        // Everything derived below depends on it, and it must not change
        // afterwards — that is why the payment script goes in this same call.
        const all = [...parseInputs(row.payer_inputs), local(coin)];
        const { spend } = parseSpAddress(spAddress);
        const paymentSpk = pj.paymentScript(keys.scanSecret, spend, all);

        await api.contributePayjoinSp(inkey, row.id, {
          payee_wallet_id: walletId,
          inputs: [wire(coin)],
          payment_spk: toHex(paymentSpk),
        });
        setMsg('Accepted. They sign next, then it comes back to you.');
        await load();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [inkey, walletId, spAddress, pickCoin, load],
  );

  // ── both: sign, after the checks ──
  const sign = useCallback(
    async (row: Row) => {
      if (!inkey || !walletId) return;
      setBusy(row.id);
      setError(null);
      try {
        const keys = await getWalletKeys(walletId);
        if (!keys) throw new Error('This device does not hold this wallet’s keys.');

        // Re-fetched rather than taken from the list: the row is about to be
        // signed over, and a list that loaded a minute ago is not what to sign.
        const fresh = await api.getPayjoinSp(inkey, row.id);
        const role = fresh.role!;
        const payerInputs = parseInputs(fresh.payer_inputs);
        const payeeInputs = parseInputs(fresh.payee_inputs);
        const all = [...payerInputs, ...payeeInputs];
        const mine = role === 'payer' ? payerInputs : payeeInputs;
        if (!fresh.payment_spk) throw new Error('This PayJoin has no payment output yet.');

        const amounts: pj.PayjoinAmounts = {
          payer_in: fresh.payer_in_sats!,
          payee_in: fresh.payee_in_sats!,
          payment: fresh.payment_sats!,
          amount: fresh.amount_sats,
          fee: fresh.fee_sats!,
          change: fresh.change_sats!,
          vsize: fresh.vsize!,
        };

        const { spend } = parseSpAddress(spAddress);
        // The payer derives its change now; the payee derives the payment
        // script again so it can check the server still holds the same one.
        const changeSpk =
          role === 'payer' && amounts.change
            ? pj.changeScript(keys.scanSecret, spend, all)
            : fresh.change_spk
              ? fromHex(fresh.change_spk)
              : null;
        const expectPaymentSpk =
          role === 'payee' ? pj.paymentScript(keys.scanSecret, spend, all) : null;

        // Nothing is signed until this returns. It throws with a sentence to
        // show the user, and every throw means cancel rather than retry.
        const assembled = pj.checkBeforeSigning({
          role,
          inputs: all,
          mine,
          amounts,
          paymentSpk: fromHex(fresh.payment_spk),
          changeSpk,
          expectPaymentSpk,
          expectChangeSpk: role === 'payer' ? changeSpk : null,
          committed: mine,
          amount: fresh.amount_sats,
          feeRate: fresh.fee_rate,
        });

        const witnesses = pj.signOwnInputs(assembled, all, mine, keys.spendKey);
        const done = await api.signPayjoinSp(inkey, row.id, {
          witnesses,
          change_spk: role === 'payer' && changeSpk ? toHex(changeSpk) : null,
        });
        setMsg(
          done.status === 'BROADCAST'
            ? 'Broadcast. Both of you spent a coin into it.'
            : 'Signed. Waiting on the other side.',
        );
        await load();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [inkey, walletId, spAddress, load],
  );

  const cancel = useCallback(
    (row: Row) => {
      Alert.alert(
        'Cancel this PayJoin?',
        'The other side is told. Nothing has been broadcast, so no coins move.',
        [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Cancel it',
            style: 'destructive',
            onPress: async () => {
              if (!inkey) return;
              setBusy(row.id);
              try {
                await api.cancelPayjoinSp(inkey, row.id);
                setMsg('Cancelled.');
                await load();
              } catch (e) {
                fail(e);
              } finally {
                setBusy(null);
              }
            },
          },
        ],
      );
    },
    [inkey, load],
  );

  const sats = (n?: number | null) =>
    n == null ? '—' : hidden ? MASK : `${n.toLocaleString()} sats`;

  const renderRow = (row: Row, role: 'payer' | 'payee') => {
    const turn =
      (row.status === 'PROPOSED' && role === 'payee') ||
      (row.status === 'CONTRIBUTED' && role === 'payer') ||
      (row.status === 'PAYER_SIGNED' && role === 'payee');
    const other = role === 'payer' ? row.payee_username : row.payer_username;
    return (
      <View key={row.id} style={styles.row}>
        <View style={styles.rowHead}>
          <Text style={styles.rowWho}>
            {role === 'payer' ? `To ${other}` : `From ${other}`}
          </Text>
          <Text style={styles.rowStatus}>{row.status.toLowerCase()}</Text>
        </View>
        <Text style={styles.rowAmount}>{sats(row.amount_sats)}</Text>
        {row.fee_sats != null ? (
          <Text style={styles.rowMeta}>
            fee {sats(row.fee_sats)} · {row.vsize} vB
            {row.change_sats ? ` · change ${sats(row.change_sats)}` : ''}
          </Text>
        ) : null}
        {row.txid ? <Text style={styles.rowMeta} numberOfLines={1}>{row.txid}</Text> : null}
        <View style={styles.rowActions}>
          {turn && row.status === 'PROPOSED' ? (
            <Button
              small
              label="Accept"
              busy={busy === row.id}
              onPress={() => contribute(row)}
            />
          ) : null}
          {turn && row.status !== 'PROPOSED' ? (
            <Button
              small
              label="Sign"
              busy={busy === row.id}
              onPress={() => sign(row)}
            />
          ) : null}
          {row.status !== 'BROADCAST' && row.status !== 'CANCELLED' ? (
            <Button
              small
              kind="danger"
              label="Cancel"
              busy={busy === row.id}
              onPress={() => cancel(row)}
            />
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <Page
      title="PayJoin"
      subtitle="Pay someone who pays in too, so the inputs are not all yours."
      onBack={onBack}>
      <ScrollView>
        {error ? (
          <Block>
            <Note kind="error">{error}</Note>
          </Block>
        ) : null}
        {msg ? (
          <Block>
            <Note kind="ok">{msg}</Note>
          </Block>
        ) : null}

        <Group
          title="Start one"
          footer="Both of you must be WhiSPa users and connected to each other. They contribute a coin, which comes straight back to them in the payment, so it costs them nothing but the round trip — and it is what makes the transaction ambiguous about whose coins are whose.">
          <Block>
            <TextInput
              value={payee}
              onChangeText={setPayee}
              placeholder="their username"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              style={styles.input}
            />
            <View style={{ height: space.sm }} />
            <Field
              value={amount}
              onChangeText={setAmount}
              placeholder="sats"
              keyboardType="number-pad"
              action="Propose"
              onAction={propose}
              actionBusy={busy === 'propose'}
              actionDisabled={!payee.trim() || !amount || !walletId}
            />
          </Block>
          <InfoRow title="Your coins available" value={String(coins.length)} />
        </Group>

        <Group
          title="Waiting on you"
          footer={
            incoming.length
              ? undefined
              : 'Nothing right now. A PayJoin someone starts with you shows up here, and you get a notification.'
          }>
          {incoming.length ? (
            <Block>{incoming.map((r) => renderRow(r, 'payee'))}</Block>
          ) : null}
        </Group>

        <Group
          title="Yours"
          footer={outgoing.length ? undefined : 'PayJoins you start show up here.'}>
          {outgoing.length ? (
            <Block>{outgoing.map((r) => renderRow(r, 'payer'))}</Block>
          ) : null}
        </Group>

        {loading ? (
          <Block>
            <Text style={styles.rowMeta}>Loading…</Text>
          </Block>
        ) : null}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between' },
  rowWho: { ...type_.body, color: colors.text, fontWeight: '600', flexShrink: 1 },
  rowStatus: { ...type_.overline, color: colors.muted },
  rowAmount: { ...type_.body, color: colors.text, marginTop: 2 },
  rowMeta: { ...type_.caption, color: colors.muted, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  // Matches ui.tsx's own input, which is not exported separately.
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    ...type_.body,
  },
});
