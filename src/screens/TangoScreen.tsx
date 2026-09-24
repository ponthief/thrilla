import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as api from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { getWalletKeys } from '@services/secureKeys';
import { useBalancesHidden, MASK } from '@stores/balancePrivacy';
import * as tango from '@services/tango';
import * as commits from '@services/tangoCommit';
import { parseSpAddress, fromHex, toHex } from '@services/spSign';
import { colors, space, type as type_ } from '@/theme';
import { Block, Button, Chips, Field, Group, Note, Page } from './settings/ui';

// Tango: a two-party mix.
//
// WHAT IT DOES, in the sentence the screen has to be able to say. You and one
// connected person each put in the same amount and each take the same amount
// back. Nobody pays anybody. Because the two outputs are identical, someone
// reading the chain cannot tell which is yours — an anonymity set of two.
//
// WHAT IT DOES NOT DO, which the screen also says. Two is two: a coin flip, not
// anonymity, though it compounds if you do it again with someone else. And the
// server running this sees both sides, so Tango hides the mapping from chain
// analysis and nothing from this instance.
//
// WHERE THE KEYS STAY. Both of this side's outputs are derived here from the
// wallet's scan key, and its inputs are signed here with the spend key.
// services/tango.ts holds the derivation and the checks that run before any
// signature exists; this file is the wiring.

type Row = api.TangoRoundRow;
type Tab = 'mix' | 'people' | 'rounds' | 'past';

const TERMINAL = ['BROADCAST', 'CANCELLED'];

function parseInputs(raw?: string | null): tango.PayjoinInput[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export default function TangoScreen() {
  const inkey = useAuthStore((s) => s.inkey);
  const adminkey = useAuthStore((s) => s.adminkey);
  const hidden = useBalancesHidden();

  const [walletId, setWalletId] = useState<string | null>(null);
  const [network, setNetwork] = useState('signet');
  const [spAddress, setSpAddress] = useState('');
  const [coins, setCoins] = useState<api.Utxo[]>([]);
  const [rounds, setRounds] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Four tabs, the same four the web has. One scroll held the coin picker, the
  // proposal form, every round and the caveats at once, which meant the thing
  // you came for was never the thing on screen.
  const [tab, setTab] = useState<Tab>('mix');

  const [partner, setPartner] = useState('');
  const [denom, setDenom] = useState('');

  // The connection graph. A Tango needs mutual consent — the propose endpoint
  // refuses a partner who is not an accepted contact — so the phone needs the
  // whole of it, not just a username field that fails after the fact.
  const [people, setPeople] = useState<api.Connections>({
    accepted: [], incoming: [], outgoing: [], declined: [],
  });
  const [newPerson, setNewPerson] = useState('');
  const [labels, setLabels] = useState<Record<string, string>>({});
  // The coins THIS user has chosen, by outpoint. Explicit on purpose: which of
  // your coins go into a mix is the decision the mix is made of, and a picker
  // that chooses for you has made it without saying so.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // What this device committed to each round, read back from the keystore. See
  // services/tangoCommit.ts: the "these are the coins I chose" check needs a
  // list the server did not supply.
  const [committed, setCommitted] = useState<commits.TangoCommitMap>({});

  const key = (u: api.Utxo) => `${u.txid}:${u.vout}`;
  const chosen = useMemo(
    () => coins.filter((c) => picked.has(key(c))),
    [coins, picked],
  );
  const chosenTotal = chosen.reduce((s, c) => s + c.amount, 0);

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
      const [utxos, list] = await Promise.all([
        api.getUtxos(inkey, w.id),
        api.listTango(inkey),
      ]);
      setCoins(utxos.filter((u) => u.utxo_state === 'unspent' && !u.frozen));
      // Not in the Promise.all above: a connection list that fails is not a
      // reason to tell someone their coins would not load.
      api
        .listConnections(inkey, w.network)
        .then((p) => {
          setPeople(p);
          setLabels(
            Object.fromEntries(p.accepted.map((c) => [c.id, c.label || ''])),
          );
        })
        .catch(() => {});
      const live = list.rounds || [];
      setRounds(live);
      // Forget what was committed to rounds that are over: the list is only
      // needed while there is still something left to sign.
      const stored = await commits.loadTangoCommits();
      setCommitted(
        await commits.pruneTangoCommits(
          stored,
          live
            .filter((r) => !TERMINAL.includes(r.status))
            .map((r) => r.id),
        ),
      );
    } catch (e: any) {
      setError(e?.message || 'Could not load Tango.');
    } finally {
      setLoading(false);
    }
  }, [inkey]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * What the chosen coins would do at the entered denomination.
   *
   * Priced against this side's own coins standing in for the other side's,
   * which is what the server does when it takes a proposal — the real fee
   * depends on how many coins the partner brings. Good enough to tell you the
   * thing that matters before you commit: whether your selection leaves
   * change, and therefore whether the mix will be clean.
   */
  const preview = useMemo(() => {
    const d = Number(denom);
    if (!Number.isFinite(d) || d <= 0 || !chosen.length) return null;
    const rows = chosen.map((c) => ({
      txid: c.txid, vout: c.vout, amount: c.amount, pub_key: c.pub_key,
    }));
    try {
      const p = tango.plan(rows, rows, d, 2);
      return { change: p.a_change, fee: p.a_fee, error: null as string | null };
    } catch (e: any) {
      return { change: 0, fee: 0, error: e?.message || 'Does not work.' };
    }
  }, [denom, chosen]);

  const wire = (u: api.Utxo): api.PayjoinSpWireInput => ({
    txid: u.txid, vout: u.vout, pub_key: u.pub_key, amount: u.amount,
  });
  const local = (u: api.Utxo): tango.PayjoinInput => ({
    txid: u.txid, vout: u.vout, amount: u.amount,
    pub_key: u.pub_key, priv_key_tweak: u.priv_key_tweak,
  });

  const fail = (e: any) => {
    setMsg(null);
    setError(e?.message || 'Something went wrong.');
  };

  const toggle = (u: api.Utxo) => {
    setPicked((prev) => {
      const next = new Set(prev);
      const k = key(u);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  // ── connections ──
  // Every one of these takes the inkey: they are read-and-consent calls on a
  // contact list, not spends.
  const refreshPeople = useCallback(async () => {
    if (!inkey) return;
    try {
      const p = await api.listConnections(inkey, network);
      setPeople(p);
      setLabels(Object.fromEntries(p.accepted.map((c) => [c.id, c.label || ''])));
    } catch (e) {
      fail(e);
    }
  }, [inkey]);

  const askConnect = useCallback(async () => {
    if (!inkey) return;
    const username = newPerson.trim();
    if (!username) {
      setError('Enter a username.');
      return;
    }
    setBusy('connect');
    setError(null);
    try {
      await api.requestConnection(inkey, username, network);
      setNewPerson('');
      // Names the person back. The endpoint refuses a username nobody holds,
      // so reaching here means it went to a real account — and seeing which
      // one is what catches the other kind of typo, the one that lands on
      // somebody.
      setMsg(`Request sent to ${username}. They have to approve it.`);
      await refreshPeople();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [inkey, newPerson, refreshPeople]);

  const respond = useCallback(
    async (c: api.Connection, what: 'approve' | 'decline' | 'remove') => {
      if (!inkey) return;
      setBusy(c.id);
      setError(null);
      try {
        if (what === 'approve') await api.approveConnection(inkey, c.id);
        else if (what === 'decline') await api.declineConnection(inkey, c.id);
        else await api.removeConnection(inkey, c.id);
        setMsg(
          what === 'approve'
            ? 'Connected. Either of you can propose a Tango now.'
            : what === 'decline'
              ? 'Declined.'
              : 'Connection removed.',
        );
        await refreshPeople();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [inkey, refreshPeople],
  );

  const removeWithConfirm = useCallback(
    (c: api.Connection) => {
      Alert.alert(
        `Remove ${c.counterparty_username}?`,
        'Either side can, and it stops you starting a Tango with them. ' +
          'Nothing already broadcast is affected.',
        [
          { text: 'Keep' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => respond(c, 'remove'),
          },
        ],
      );
    },
    [respond],
  );

  const saveLabel = useCallback(
    async (c: api.Connection) => {
      if (!inkey) return;
      setBusy(c.id);
      try {
        await api.labelConnection(inkey, c.id, (labels[c.id] || '').trim());
        setMsg('Label saved. Only you see it.');
        await refreshPeople();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [inkey, labels, refreshPeople],
  );

  // ── A: propose ──
  const propose = useCallback(async () => {
    if (!adminkey || !walletId) return;
    const d = Number(denom);
    if (!Number.isFinite(d) || d <= 0) {
      setError('Enter the amount you each want back.');
      return;
    }
    if (!chosen.length) {
      setError('Choose which of your coins go in.');
      return;
    }
    setBusy('propose');
    setError(null);
    try {
      const row = await api.proposeTango(adminkey, {
        wallet_id: walletId,
        partner_username: partner.trim(),
        denom_sats: d,
        fee_rate: 2,
        inputs: chosen.map(wire),
        network,
      });
      // Remembered before anything else can change: this is the only copy of
      // the selection that the server did not write.
      setCommitted(await commits.recordTangoCommit(committed, row.id, chosen));
      setPartner('');
      setDenom('');
      setPicked(new Set());
      setMsg('Sent. They match it, then you both sign.');
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [adminkey, walletId, denom, partner, chosen, network, committed, load]);

  // ── B: accept, which means deriving both of this side's outputs ──
  const accept = useCallback(
    async (row: Row) => {
      if (!adminkey || !walletId) return;
      if (!chosen.length) {
        setError('Choose which of your coins go in, then accept.');
        return;
      }
      setBusy(row.id);
      setError(null);
      try {
        const keys = await getWalletKeys(walletId);
        if (!keys) throw new Error('This device does not hold this wallet’s keys.');

        // The complete input set exists for the first time here, which is why
        // both scripts are derived in this call and not an earlier one.
        const all = [...parseInputs(row.a_inputs), ...chosen.map(local)];
        const amounts = tango.plan(
          parseInputs(row.a_inputs), chosen.map(local), row.denom_sats, row.fee_rate,
        );
        const { spend } = parseSpAddress(spAddress);
        const own = tango.deriveOwnOutputs(
          keys.scanSecret, spend, all, !!amounts.b_change,
        );

        await api.acceptTango(adminkey, row.id, {
          wallet_id: walletId,
          inputs: chosen.map(wire),
          mix_spk: toHex(own.mix),
          change_spk: own.change ? toHex(own.change) : null,
        });
        setCommitted(await commits.recordTangoCommit(committed, row.id, chosen));
        setPicked(new Set());
        setMsg(
          amounts.clean
            ? 'Matched, and neither side needs change — a clean mix.'
            : 'Matched. One or both sides have change, which weakens it.',
        );
        await load();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [adminkey, walletId, spAddress, chosen, committed, load],
  );

  // ── both: sign, after the checks ──
  const sign = useCallback(
    async (row: Row) => {
      if (!adminkey || !inkey || !walletId) return;
      setBusy(row.id);
      setError(null);
      try {
        const keys = await getWalletKeys(walletId);
        if (!keys) throw new Error('This device does not hold this wallet’s keys.');

        // Re-fetched: the list is however old the screen is, and what is about
        // to be signed is a transaction.
        const fresh = await api.getTango(inkey, row.id);
        const side = fresh.role!;
        const aRows = parseInputs(fresh.a_inputs);
        const bRows = parseInputs(fresh.b_inputs);
        const all = [...aRows, ...bRows];
        // Tweaks come from this device's own coin records, never from the
        // server's copy of the set — which carries none, by design.
        const mine = tango.withLocalTweaks(side === 'a' ? aRows : bRows, coins);

        const amounts: tango.TangoAmounts = {
          denom: fresh.denom_sats,
          a_in: fresh.a_in_sats!, b_in: fresh.b_in_sats!,
          a_change: fresh.a_change_sats || 0, b_change: fresh.b_change_sats || 0,
          a_fee: fresh.a_fee_sats!, b_fee: fresh.b_fee_sats!,
          fee: fresh.fee_sats!, vsize: fresh.vsize!,
          clean: !!fresh.clean,
        };

        const { spend } = parseSpAddress(spAddress);
        const myChange = side === 'a' ? amounts.a_change : amounts.b_change;
        const own = tango.deriveOwnOutputs(keys.scanSecret, spend, all, !!myChange);

        // A derives at sign time; B derived at accept time and its scripts are
        // already on the row.
        const aMix = side === 'a' ? own.mix : fromHex(fresh.a_mix_spk || '');
        const bMix = side === 'b' ? own.mix : fromHex(fresh.b_mix_spk || '');
        const aChange = side === 'a'
          ? own.change
          : fresh.a_change_spk ? fromHex(fresh.a_change_spk) : null;
        const bChange = side === 'b'
          ? own.change
          : fresh.b_change_spk ? fromHex(fresh.b_change_spk) : null;

        // The coins this device chose, from this device. Comparing the
        // server's set to the server's set would pass whatever it contained.
        // Absent — proposed from the web, or from a phone since reinstalled —
        // the check cannot be made, and the screen says so rather than
        // implying it passed.
        const chose = committed[fresh.id] || null;
        const assembled = tango.checkBeforeSigning({
          side, inputs: all, mine, amounts,
          aMix, bMix, aChange, bChange,
          expectMix: own.mix, expectChange: own.change,
          committed: chose || mine,
          denom: fresh.denom_sats, feeRate: fresh.fee_rate,
        });

        const witnesses = tango.signOwnInputs(assembled, all, mine, keys.spendKey);
        const done = await api.signTango(adminkey, row.id, {
          witnesses,
          mix_spk: side === 'a' ? toHex(own.mix) : null,
          change_spk: side === 'a' && own.change ? toHex(own.change) : null,
          unsigned_tx: assembled.unsignedHex,
        });
        const unverified = chose
          ? ''
          : ' This device has no record of which coins you chose for it, so' +
            ' that part could not be checked.';
        setMsg(
          (done.status === 'BROADCAST'
            ? 'Sent. Both shares are the same size, so nothing on chain says which is yours.'
            : 'Approved. Waiting on the other side.') + unverified,
        );
        await load();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [adminkey, inkey, walletId, spAddress, coins, committed, load],
  );

  const cancel = useCallback(
    (row: Row) => {
      Alert.alert(
        'Cancel this Tango?',
        'The other side is told. Nothing has been broadcast, so no coins move.',
        [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Cancel it',
            style: 'destructive',
            onPress: async () => {
              if (!adminkey) return;
              setBusy(row.id);
              try {
                await api.cancelTango(adminkey, row.id);
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
    [adminkey, load],
  );

  const sats = (n?: number | null) =>
    n == null ? '—' : hidden ? MASK : `${n.toLocaleString()} sats`;

  // Mirrors tango.py::whose_turn, which stays the authority.
  const TURN: Record<string, 'a' | 'b'> = {
    PROPOSED: 'b', ACCEPTED: 'a', A_SIGNED: 'b',
  };

  // Who did the last thing, named.
  //
  // The stored statuses carry the role names the protocol needs — A proposes,
  // B matches, A_SIGNED means A has signed — and those names mean nothing to
  // the person reading them. This row used to print the status raw, so it read
  // "a_signed", which looks like a bug even when nothing is wrong. Nobody is
  // "A": they are you, or they are whoever you are mixing with, by name.
  const actor = (r: Row, which: 'a' | 'b') =>
    r.role === which
      ? 'You'
      : (which === 'a' ? r.a_username : r.b_username) || 'They';

  const statusLabel = (r: Row) => {
    switch (r.status) {
      case 'PROPOSED': return `${actor(r, 'a')} proposed it`;
      case 'ACCEPTED': return `${actor(r, 'b')} matched it`;
      case 'A_SIGNED': return `${actor(r, 'a')} approved it`;
      case 'BROADCAST': return 'Sent';
      // The sweeper closes a round nobody finished, and that is a different
      // outcome from someone deciding to stop: nothing was refused, the time
      // simply ran out and the coins went back.
      case 'CANCELLED':
        return r.reject_reason === 'expired' ? 'Expired' : 'Cancelled';
      default: return r.status;
    }
  };

  // "Sign" is what the code does; it is not what the person is doing, and the
  // two turns are not the same act. The first approves the mix and waits. The
  // second finishes it, puts it on the network, and cannot be undone — which a
  // button reading "Sign" for both gives no way to tell.
  const signLabel = (r: Row) =>
    r.status === 'A_SIGNED' ? 'Finish & send' : 'Approve';

  const renderRound = (r: Row) => {
    const side = r.role!;
    const mine = TURN[r.status] === side;
    const other = side === 'a' ? r.b_username : r.a_username;
    const myChange = side === 'a' ? r.a_change_sats : r.b_change_sats;
    return (
      <View key={r.id} style={styles.row}>
        <View style={styles.rowHead}>
          <Text style={styles.rowWho}>with {other}</Text>
          <Text style={styles.rowStatus}>{statusLabel(r)}</Text>
        </View>
        <Text style={styles.rowAmount}>{sats(r.denom_sats)} each</Text>
        {r.fee_sats != null ? (
          <Text style={styles.rowMeta}>
            your fee {sats(side === 'a' ? r.a_fee_sats : r.b_fee_sats)} · {r.vsize} vB
            {myChange ? ` · your change ${sats(myChange)}` : ''}
          </Text>
        ) : null}
        {r.clean === false ? (
          <Text style={styles.warn}>
            Change on one or both sides. An observer can often work out which
            output is whose from the amounts.
          </Text>
        ) : r.clean === true ? (
          <Text style={styles.good}>
            No change either side — nothing to work out from the amounts.
          </Text>
        ) : null}
        {r.txid ? (
          <Text style={styles.rowMeta} numberOfLines={1}>{r.txid}</Text>
        ) : null}
        <View style={styles.rowActions}>
          {mine && r.status === 'PROPOSED' ? (
            <Button small label="Match it" busy={busy === r.id}
              onPress={() => accept(r)} />
          ) : null}
          {mine && r.status !== 'PROPOSED' ? (
            <Button small label={signLabel(r)} busy={busy === r.id}
              onPress={() => sign(r)} />
          ) : null}
          {r.status !== 'BROADCAST' && r.status !== 'CANCELLED' ? (
            <Button small kind="danger" label="Cancel" busy={busy === r.id}
              onPress={() => cancel(r)} />
          ) : null}
        </View>
      </View>
    );
  };

  const mineNow = (r: Row) => !!r.role && TURN[r.status] === r.role;
  const waiting = rounds.filter(mineNow);
  const theirs = rounds.filter((r) => !TERMINAL.includes(r.status) && !mineNow(r));
  const past = rounds
    .filter((r) => TERMINAL.includes(r.status))
    .slice()
    .sort((a, b) =>
      String(b.updated_at || b.created_at || '').localeCompare(
        String(a.updated_at || a.created_at || ''),
      ),
    );

  // Only people a round could actually be built with. on_network is absent
  // when the server was not asked, in which case everyone stays offered.
  const reachable = people.accepted.filter((c) => c.on_network !== false);

  const partnerLabel = (c: api.ConnectedPartner | api.Connection) => {
    const name = 'username' in c ? c.username : c.counterparty_username;
    const l = ('label' in c ? c.label : '') || '';
    return l.trim() ? `${l.trim()} (${name})` : name;
  };

  return (
    <Page
      title="Tango"
      subtitle="Two of you, one amount each, and nothing saying which is whose.">
      {error ? (
        <Block><Note kind="error">{error}</Note></Block>
      ) : null}
      {msg ? <Block><Note kind="ok">{msg}</Note></Block> : null}

      <Block>
        <Chips<Tab>
          options={[
            { key: 'mix', label: 'Mix' },
            { key: 'people', label: 'People' },
            {
              key: 'rounds',
              label: waiting.length ? `Rounds (${waiting.length})` : 'Rounds',
            },
            { key: 'past', label: 'Past' },
          ]}
          selected={tab}
          onSelect={setTab}
        />
      </Block>

      {tab === 'mix' ? (
        <>
          <Group
            title="Your coins"
            footer={
              preview?.error
                ? undefined
                : preview
                  ? preview.change
                    ? `This selection leaves ${preview.change.toLocaleString()} sats of change. The mix still works, but change plus your share adds up to what you put in — which is often enough for someone to tell the two apart. A selection close to the amount plus your fee share is stronger.`
                    : 'No change from this selection. That is the strongest shape: coins in, two identical coins out, nothing to add up.'
                  : 'Pick the coins that go in. Which ones you choose is the decision a mix is made of, so nothing here chooses for you.'
            }>
            <Block>
              {coins.length === 0 ? (
                <Text style={styles.rowMeta}>No spendable coins.</Text>
              ) : (
                coins.map((c) => {
                  const on = picked.has(key(c));
                  return (
                    <Pressable
                      key={key(c)}
                      onPress={() => toggle(c)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={[styles.coin, on && styles.coinOn]}>
                      <View style={[styles.tick, on && styles.tickOn]}>
                        {on ? <Text style={styles.tickMark}>✓</Text> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.coinAmount}>{sats(c.amount)}</Text>
                        <Text style={styles.coinMeta} numberOfLines={1}>
                          {c.label ? `${c.label} · ` : ''}{c.txid.slice(0, 16)}…:{c.vout}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </Block>
            {chosen.length ? (
              <Block>
                <Text style={styles.rowMeta}>
                  {chosen.length} chosen · {sats(chosenTotal)}
                  {preview && !preview.error
                    ? ` · your fee about ${preview.fee.toLocaleString()} sats`
                    : ''}
                </Text>
                {preview?.error ? (
                  <Note kind="error">{preview.error}</Note>
                ) : null}
              </Block>
            ) : null}
          </Group>

          <Group
            title="Start one"
            footer="Both of you get the same amount back, so nobody is paying anybody — the point is that the two outputs look the same. They choose their own coins.">
            <Block>
              {reachable.length === 0 ? (
                <Text style={styles.rowMeta}>
                  {people.accepted.length
                    ? `None of your connections has a wallet on ${network}, so ` +
                      'there is nobody to mix with here. See People.'
                    : 'No connections yet. Add one under People — they approve, ' +
                      'then they appear here.'}
                </Text>
              ) : (
                reachable.map((c) => {
                  const on = partner === c.counterparty_username;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setPartner(on ? '' : c.counterparty_username)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={[styles.coin, on && styles.coinOn]}>
                      <View style={[styles.tick, styles.tickRound, on && styles.tickOn]}>
                        {on ? <Text style={styles.tickMark}>✓</Text> : null}
                      </View>
                      <Text style={styles.coinAmount}>{partnerLabel(c)}</Text>
                    </Pressable>
                  );
                })
              )}
            </Block>
            <Block>
              <Field
                value={denom}
                onChangeText={setDenom}
                placeholder="sats each"
                keyboardType="number-pad"
                action="Propose"
                onAction={propose}
                actionBusy={busy === 'propose'}
                actionDisabled={
                  !partner || !denom || !chosen.length || !walletId ||
                  !!preview?.error
                }
              />
            </Block>
          </Group>

          <Group title="What this hides">
            <Block>
              <Text style={styles.rowMeta}>
                Both shares are the same size, so nothing on chain says which is
                yours. That is an anonymity set of two — a coin flip, not
                anonymity, though it compounds if you do it again with someone
                else.
              </Text>
              <View style={{ height: space.sm }} />
              <Text style={styles.rowMeta}>
                It hides nothing from the server running this: it sees both
                sides. Tango is protection against someone reading the chain.
              </Text>
            </Block>
          </Group>
        </>
      ) : null}

      {tab === 'people' ? (
        <>
          <Group
            title="Add someone"
            footer="Connect by WhiSPa username. They approve, then either of you can propose a Tango — it stays connected until one side removes it. This is one list of people, shared with the PSBT PayJoin on the web.">
            <Block>
              <Field
                value={newPerson}
                onChangeText={setNewPerson}
                placeholder="their username"
                autoCapitalize="none"
                action="Ask"
                onAction={askConnect}
                actionBusy={busy === 'connect'}
                actionDisabled={!newPerson.trim()}
              />
            </Block>
          </Group>

          {people.incoming.length ? (
            <Group title="Asking to connect">
              <Block>
                {people.incoming.map((c) => (
                  <View key={c.id} style={styles.row}>
                    <View style={styles.rowHead}>
                      <Text style={styles.rowWho}>{c.counterparty_username}</Text>
                      <Text style={styles.rowStatus}>asking</Text>
                    </View>
                    <Text style={styles.rowMeta}>
                      They want to connect. Accepting lets either of you propose
                      a Tango.
                    </Text>
                    <View style={styles.rowActions}>
                      <Button small label="Approve" busy={busy === c.id}
                        onPress={() => respond(c, 'approve')} />
                      <Button small kind="secondary" label="Decline"
                        busy={busy === c.id} onPress={() => respond(c, 'decline')} />
                    </View>
                  </View>
                ))}
              </Block>
            </Group>
          ) : null}

          {people.outgoing.length ? (
            <Group
              title="Sent, not answered"
              footer="They have to accept before either of you can propose a Tango. Nothing happens until they do, and you can withdraw a request at any time.">
              <Block>
                {people.outgoing.map((c) => (
                  <View key={c.id} style={styles.row}>
                    <View style={styles.rowHead}>
                      <Text style={styles.rowWho}>{c.counterparty_username}</Text>
                      <Text style={styles.rowStatus}>pending</Text>
                    </View>
                    <Text style={styles.rowMeta}>
                      Waiting for them to accept or decline.
                    </Text>
                    <View style={styles.rowActions}>
                      <Button small kind="secondary" label="Withdraw"
                        busy={busy === c.id} onPress={() => respond(c, 'remove')} />
                    </View>
                  </View>
                ))}
              </Block>
            </Group>
          ) : null}

          <Group
            title="Connected"
            footer="A label is yours alone — it never leaves this account, and the other side never sees it.">
            <Block>
              {people.accepted.length === 0 ? (
                <Text style={styles.rowMeta}>Nobody yet.</Text>
              ) : (
                people.accepted.map((c) => (
                  <View key={c.id} style={styles.row}>
                    <View style={styles.rowHead}>
                      <Text style={styles.rowWho}>{c.counterparty_username}</Text>
                      <Text style={styles.rowStatus}>
                        {c.on_network === false ? `not on ${network}` : 'connected'}
                      </Text>
                    </View>
                    {c.on_network === false ? (
                      <Text style={styles.warn}>
                        They have no wallet on {network}, so a Tango with them
                        cannot be built. They appear here so you can remove
                        them; they are not offered under Mix.
                      </Text>
                    ) : null}
                    <View style={{ height: space.xs }} />
                    <Field
                      value={labels[c.id] || ''}
                      onChangeText={(t) =>
                        setLabels((prev) => ({ ...prev, [c.id]: t }))
                      }
                      placeholder="private label"
                      action="Save"
                      onAction={() => saveLabel(c)}
                      actionBusy={busy === c.id}
                    />
                    <View style={styles.rowActions}>
                      <Button small kind="danger" label="Remove"
                        busy={busy === c.id} onPress={() => removeWithConfirm(c)} />
                    </View>
                  </View>
                ))
              )}
            </Block>
          </Group>

          {people.declined.length ? (
            <Group title="Declined">
              <Block>
                {people.declined.map((c) => (
                  <View key={c.id} style={styles.row}>
                    <View style={styles.rowHead}>
                      <Text style={styles.rowWho}>{c.counterparty_username}</Text>
                      <Text style={styles.rowStatus}>declined</Text>
                    </View>
                    <Text style={styles.rowMeta}>
                      They turned your request down. Dismiss it to clear it.
                    </Text>
                    <View style={styles.rowActions}>
                      <Button small kind="secondary" label="Dismiss"
                        busy={busy === c.id} onPress={() => respond(c, 'remove')} />
                    </View>
                  </View>
                ))}
              </Block>
            </Group>
          ) : null}
        </>
      ) : null}

      {tab === 'rounds' ? (
        <>
          <Group
            title="Waiting on you"
            footer={
              waiting.some((r) => r.status === 'PROPOSED')
                ? 'Matching one derives your outputs from the whole input set, so choose your coins under Mix first.'
                : undefined
            }>
            <Block>
              {waiting.length === 0 ? (
                <Text style={styles.rowMeta}>
                  Nothing waiting on you. A round someone proposes shows up here.
                </Text>
              ) : (
                waiting.map(renderRound)
              )}
            </Block>
          </Group>

          <Group title="Waiting on them">
            <Block>
              {theirs.length === 0 ? (
                <Text style={styles.rowMeta}>Nothing waiting on the other side.</Text>
              ) : (
                theirs.map(renderRound)
              )}
            </Block>
          </Group>
        </>
      ) : null}

      {tab === 'past' ? (
        <Group
          title="Past rounds"
          footer="A round that ran out of time is closed by the server and both sides' coins go back into circulation.">
          <Block>
            {past.length === 0 ? (
              <Text style={styles.rowMeta}>No finished rounds yet.</Text>
            ) : (
              past.map(renderRound)
            )}
          </Block>
        </Group>
      ) : null}

      {loading ? <Block><Text style={styles.rowMeta}>Loading…</Text></Block> : null}
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
  warn: { ...type_.caption, color: colors.primary, marginTop: 4 },
  good: { ...type_.caption, color: colors.green, marginTop: 4 },
  rowActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  coin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  coinOn: { backgroundColor: colors.surfaceAlt },
  tick: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  // A radio, not a checkbox: you mix with one person, not several.
  tickRound: { borderRadius: 10 },
  tickOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  tickMark: { color: colors.onPrimary, fontSize: 13, fontWeight: '700', lineHeight: 16 },
  coinAmount: { ...type_.body, color: colors.text },
  coinMeta: { ...type_.caption, color: colors.muted },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    ...type_.body,
  },
});
