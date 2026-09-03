import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { WalletButton } from '@/components/WalletButton';
import { Header } from '@/components/Header';
import { indexerFetch } from '@/lib/indexer';
import { AccountAvatar } from '@/components/AccountAvatar';
import { TaskInbox } from '@/components/TaskInbox';
import { Footer } from '@/components/Footer';
import { TrustBadge } from '@/components/TrustBadge';
import { PluginSelector } from '@/components/PluginSelector';
import { Modal, Field, inputClass } from '@/components/Modal';
import { FeaturedChip } from '@/components/ServiceCard';
import { useProton } from '@/hooks/useProton';
import { useToast } from '@/contexts/ToastContext';
import { useAgent } from '@/hooks/useAgent';
import { CONTRACTS, formatXpr, formatTimeline, formatDate, getBidsByAgent, type Bid,
  getAgentsByOwner,
  getServicesByAgent,
  getServiceConfig,
  getServiceDeposit,
  getServiceInput,
  stringifyServiceInputSchema,
  parseServiceInputSchema,
  SERVICE_INPUT_TYPES,
  SERVICE_INPUT_MAX_FIELDS,
  SERVICE_INPUT_SCHEMA_MAX,
  SERVICE_INPUT_LABEL_MAX,
  SERVICE_INPUT_KEY_MAX,
  boostDays,
  formatTurnaround,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  DEFAULT_SERVICE_CONFIG,
  type Agent as OwnedAgent,
  type Service,
  type ServiceConfig,
  type ServiceDeposit,
  type ServiceInputField,
  type ServiceInputType,
} from '@/lib/registry';

const EMPTY_SERVICE_FORM = {
  title: '',
  description: '',
  deliverables: '',
  price: '',
  turnaroundHours: '',
  category: 'other',
  sampleUri: '',
};

/** One editable row of the buyer-input builder (everything is a string while editing). */
interface SchemaRow {
  key: string;
  label: string;
  type: ServiceInputType;
  required: boolean;
  /** Comma-separated while editing; only used by `select`. */
  options: string;
  max: string;
}

const EMPTY_SCHEMA_ROW: SchemaRow = { key: '', label: '', type: 'text', required: false, options: '', max: '' };

function rowsFromFields(fields: ServiceInputField[]): SchemaRow[] {
  return fields.map(f => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: !!f.required,
    options: (f.options || []).join(', '),
    max: f.max ? String(f.max) : '',
  }));
}

/** The compact schema string these rows describe, or '' when there is nothing to store. */
function schemaStringFromRows(rows: SchemaRow[]): string {
  const fields: ServiceInputField[] = [];
  for (const row of rows) {
    const key = row.key.trim().toLowerCase();
    const label = row.label.trim();
    if (!key || !label) continue;
    const field: ServiceInputField = { key, label, type: row.type };
    if (row.required) field.required = true;
    if (row.type === 'select') {
      const options = row.options.split(',').map(o => o.trim()).filter(Boolean);
      if (options.length === 0) continue;
      field.options = options;
    }
    const max = parseInt(row.max, 10);
    if (Number.isFinite(max) && max > 0) field.max = max;
    fields.push(field);
  }
  return fields.length > 0 ? stringifyServiceInputSchema(fields) : '';
}

export default function Dashboard() {
  const { session, transact } = useProton();
  const { agent, score, trustScore, kycLevel, loading, refresh } = useAgent(
    session?.auth.actor
  );

  const { addToast } = useToast();

  function getTxId(result: any): string | undefined {
    return result?.processed?.id;
  }

  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [myBids, setMyBids] = useState<Bid[]>([]);
  const [ownedAgents, setOwnedAgents] = useState<OwnedAgent[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(false);
  type OwnedStats = { trust_score?: number; earnings?: number; completed_jobs?: number; kyc_level?: number; avg_score?: number; feedback_count?: number };
  const [ownedStats, setOwnedStats] = useState<Record<string, OwnedStats>>({});

  // Services the connected agent sells
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState(EMPTY_SERVICE_FORM);
  // Buyer-input builder for the service form
  const [schemaRows, setSchemaRows] = useState<SchemaRow[]>([]);
  const [originalSchema, setOriginalSchema] = useState('');
  const [svcConfig, setSvcConfig] = useState<ServiceConfig>(DEFAULT_SERVICE_CONFIG);
  const [svcDeposit, setSvcDeposit] = useState<ServiceDeposit | null>(null);
  const [boostService, setBoostService] = useState<Service | null>(null);
  const [boostAmount, setBoostAmount] = useState('');

  // Edit profile
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editEndpoint, setEditEndpoint] = useState('');
  const [editProtocol, setEditProtocol] = useState('');
  const [editCapabilities, setEditCapabilities] = useState('');

  useEffect(() => {
    if (session?.auth.actor) {
      setOwnedLoading(true);
      getAgentsByOwner(session.auth.actor)
        .then(async list => {
          setOwnedAgents(list);
          const stats = await Promise.all(list.map(a => indexerFetch<OwnedStats>(`/agents/${a.account}`).catch(() => null)));
          setOwnedStats(Object.fromEntries(list.map((a, i) => [a.account, stats[i] || {}])));
        })
        .catch(() => setOwnedAgents([]))
        .finally(() => setOwnedLoading(false));
      getBidsByAgent(session.auth.actor).then(setMyBids).catch(() => {});
      loadServices();
    }
  }, [session?.auth.actor]);

  const handleStake = async () => {
    if (!session || !stakeAmount) return;

    setProcessing(true);

    try {
      const result = await transact([
        {
          account: 'eosio',
          name: 'stakexpr',
          data: {
            owner_name: session.auth.actor,
            amount: `${parseFloat(stakeAmount).toFixed(4)} XPR`,
          },
        },
      ]);

      addToast({ type: 'success', message: `Staked ${parseFloat(stakeAmount).toFixed(4)} XPR`, txId: getTxId(result) });
      setStakeAmount('');
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Stake failed' });
    } finally {
      setProcessing(false);
    }
  };

  const handleUnstake = async () => {
    if (!session || !unstakeAmount) return;

    setProcessing(true);

    try {
      const result = await transact([
        {
          account: 'eosio',
          name: 'unstakexpr',
          data: {
            owner_name: session.auth.actor,
            amount: `${parseFloat(unstakeAmount).toFixed(4)} XPR`,
          },
        },
      ]);

      addToast({ type: 'success', message: `Unstake requested for ${parseFloat(unstakeAmount).toFixed(4)} XPR`, txId: getTxId(result) });
      setUnstakeAmount('');
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Unstake failed' });
    } finally {
      setProcessing(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!session || !agent) return;

    setProcessing(true);

    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'setstatus',
          data: {
            account: session.auth.actor,
            active: !agent.active,
          },
        },
      ]);

      addToast({ type: 'success', message: agent.active ? 'Agent deactivated' : 'Agent activated', txId: getTxId(result) });
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to update status' });
    } finally {
      setProcessing(false);
    }
  };

  const openEditProfile = () => {
    if (!agent) return;
    setEditName(agent.name);
    setEditDescription(agent.description);
    setEditEndpoint(agent.endpoint);
    setEditProtocol(agent.protocol);
    setEditCapabilities(agent.capabilities.join(', '));
    setShowEditProfile(true);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setProcessing(true);
    try {
      const capsArray = editCapabilities.split(',').map(s => s.trim()).filter(Boolean);
      const result = await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'update',
          data: {
            account: session.auth.actor,
            name: editName,
            description: editDescription,
            endpoint: editEndpoint,
            protocol: editProtocol || '',
            capabilities: JSON.stringify(capsArray),
          },
        },
      ]);
      addToast({ type: 'success', message: 'Profile updated', txId: getTxId(result) });
      setShowEditProfile(false);
      await new Promise(r => setTimeout(r, 1500));
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Update failed' });
    } finally {
      setProcessing(false);
    }
  };

  async function loadServices() {
    if (!session) return;
    setServicesLoading(true);
    try {
      const [list, config, deposit] = await Promise.all([
        getServicesByAgent(session.auth.actor),
        getServiceConfig().catch(() => DEFAULT_SERVICE_CONFIG),
        getServiceDeposit(session.auth.actor).catch(() => null),
      ]);
      setServices(list);
      setSvcConfig(config);
      setSvcDeposit(deposit);
    } catch {
      setServices([]);
    } finally {
      setServicesLoading(false);
    }
  }

  const openNewService = () => {
    setEditingService(null);
    setServiceForm(EMPTY_SERVICE_FORM);
    setSchemaRows([]);
    setOriginalSchema('');
    setShowServiceForm(true);
  };

  const openEditService = (service: Service) => {
    setEditingService(service);
    setServiceForm({
      title: service.title,
      description: service.description,
      deliverables: service.deliverables.join('\n'),
      price: String(service.price / 10000),
      turnaroundHours: String(Math.round(service.turnaround / 3600)),
      category: service.category || 'other',
      sampleUri: service.sample_uri,
    });
    setSchemaRows([]);
    setOriginalSchema('');
    setShowServiceForm(true);
    // The listing's declared buyer inputs, if it has any.
    getServiceInput(service.id)
      .then((schema) => {
        if (!schema) return;
        setSchemaRows(rowsFromFields(schema.fields));
        setOriginalSchema(stringifyServiceInputSchema(schema.fields));
      })
      .catch(() => {});
  };

  const schemaPreview = schemaStringFromRows(schemaRows);
  const schemaTooLong = schemaPreview.length > SERVICE_INPUT_SCHEMA_MAX;
  // Rows missing a key, a label or (for a select) options are silently dropped.
  const schemaComplete = schemaRows.every(r => r.key.trim() && r.label.trim() && (r.type !== 'select' || r.options.split(',').some(o => o.trim())));
  // The stored string must round-trip through the same parser the buy form uses.
  const schemaValid = schemaPreview === '' || parseServiceInputSchema(schemaPreview) !== null;

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setProcessing(true);
    try {
      const price = Math.round(parseFloat(serviceForm.price) * 10000);
      const turnaround = Math.round(parseFloat(serviceForm.turnaroundHours) * 3600);
      const deliverables = JSON.stringify(
        serviceForm.deliverables.split('\n').map(d => d.trim()).filter(Boolean)
      );
      const shared = {
        agent: session.auth.actor,
        title: serviceForm.title,
        description: serviceForm.description,
        deliverables,
        price,
        turnaround,
        category: serviceForm.category,
        sample_uri: serviceForm.sampleUri.trim(),
      };
      // New listings cost svcconfig.service_fee, paid as a deposit transfer that
      // listsvc consumes — both actions go in one transaction, one signature.
      const actions: any[] = [];
      if (!editingService) {
        const owing = svcConfig.service_fee - (svcDeposit?.amount || 0);
        if (owing > 0) {
          actions.push({
            account: 'eosio.token',
            name: 'transfer',
            data: {
              from: session.auth.actor,
              to: CONTRACTS.AGENT_ESCROW,
              quantity: `${(owing / 10000).toFixed(4)} XPR`,
              memo: `svcfee:${session.auth.actor}`,
            },
          });
        }
      }
      actions.push(
        editingService
          ? { account: CONTRACTS.AGENT_ESCROW, name: 'updatesvc', data: { ...shared, service_id: editingService.id } }
          : { account: CONTRACTS.AGENT_ESCROW, name: 'listsvc', data: shared }
      );
      // The buyer-input schema rides along with an edit; a new listing has no id
      // yet, so it is sent as a second transaction once the listing lands.
      const schemaString = schemaStringFromRows(schemaRows);
      if (editingService && schemaString !== originalSchema) {
        actions.push({
          account: CONTRACTS.AGENT_ESCROW,
          name: 'setsvcinput',
          data: { agent: session.auth.actor, service_id: editingService.id, schema: schemaString },
        });
      }
      const result = await transact(actions);
      addToast({
        type: 'success',
        message: editingService ? `Service #${editingService.id} updated` : `"${serviceForm.title}" listed`,
        txId: getTxId(result),
      });
      setShowServiceForm(false);
      setEditingService(null);
      setServiceForm(EMPTY_SERVICE_FORM);
      await new Promise(r => setTimeout(r, 1500));

      if (!editingService && schemaString) {
        const listed = await getServicesByAgent(session.auth.actor).catch(() => [] as Service[]);
        const newest = listed.reduce<Service | null>((best, s) => (!best || s.id > best.id ? s : best), null);
        if (newest) {
          try {
            const schemaResult = await transact([
              {
                account: CONTRACTS.AGENT_ESCROW,
                name: 'setsvcinput',
                data: { agent: session.auth.actor, service_id: newest.id, schema: schemaString },
              },
            ]);
            addToast({ type: 'success', message: `Buyer input form saved on service #${newest.id}`, txId: getTxId(schemaResult) });
          } catch {
            addToast({ type: 'error', message: 'Listing created, but the input form was not saved. Edit the listing to try again.' });
          }
        }
      }
      setSchemaRows([]);
      setOriginalSchema('');
      await loadServices();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to save service' });
    } finally {
      setProcessing(false);
    }
  };

  const handleReclaimFee = async () => {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        { account: CONTRACTS.AGENT_ESCROW, name: 'refundsvcfee', data: { agent: session.auth.actor } },
      ]);
      addToast({ type: 'success', message: 'Listing fee deposit refunded', txId: getTxId(result) });
      await new Promise(r => setTimeout(r, 1500));
      await loadServices();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Refund failed' });
    } finally {
      setProcessing(false);
    }
  };

  const handleBoostService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !boostService) return;
    const raw = Math.round((parseFloat(boostAmount) || 0) * 10000);
    const days = boostDays(raw, svcConfig);
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: 'eosio.token',
          name: 'transfer',
          data: {
            from: session.auth.actor,
            to: CONTRACTS.AGENT_ESCROW,
            quantity: `${(raw / 10000).toFixed(4)} XPR`,
            memo: `boost:${boostService.id}`,
          },
        },
      ]);
      addToast({ type: 'success', message: `Featured for ${days} day${days === 1 ? '' : 's'}`, txId: getTxId(result) });
      setBoostService(null);
      setBoostAmount('');
      await new Promise(r => setTimeout(r, 1500));
      await loadServices();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to feature listing' });
    } finally {
      setProcessing(false);
    }
  };

  const handleServiceListing = async (service: Service, relist: boolean) => {
    if (!session) return;
    setProcessing(true);
    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_ESCROW,
          name: relist ? 'relistsvc' : 'delistsvc',
          data: { agent: session.auth.actor, service_id: service.id },
        },
      ]);
      addToast({
        type: 'success',
        message: relist ? `Service #${service.id} relisted` : `Service #${service.id} delisted`,
        txId: getTxId(result),
      });
      await new Promise(r => setTimeout(r, 1500));
      await loadServices();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to update listing' });
    } finally {
      setProcessing(false);
    }
  };

  const handleAddPlugin = async (plugin: any) => {
    if (!session) return;

    setProcessing(true);

    try {
      const result = await transact([
        {
          account: CONTRACTS.AGENT_CORE,
          name: 'addplugin',
          data: {
            agent: session.auth.actor,
            plugin_id: plugin.id,
            config: '{}',
          },
        },
      ]);

      addToast({ type: 'success', message: `Plugin "${plugin.name}" added`, txId: getTxId(result) });
      setShowPluginSelector(false);
      refresh();
    } catch (e: any) {
      addToast({ type: 'error', message: e.message || 'Failed to add plugin' });
    } finally {
      setProcessing(false);
    }
  };

  if (!session) {
    return (
      <>
        <Head>
          <title>Dashboard - XPR Agents</title>
        </Head>

        <div className="min-h-screen bg-canvas">
          <Header activePage="dashboard" />
          <main className="max-w-6xl mx-auto px-4 py-12 text-center">
            <h1 className="text-2xl font-bold text-ink mb-4">Agent Dashboard</h1>
            <p className="text-ink-2 mb-8">Connect your wallet to view your dashboard</p>
            <WalletButton />
          </main>
          <Footer />
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
      </div>
    );
  }

  if (!agent) {
    return (
      <>
        <Head>
          <title>Dashboard - XPR Agents</title>
        </Head>

        <div className="min-h-screen bg-canvas">
          <Header activePage="dashboard" />
          <main className="max-w-6xl mx-auto px-4 py-12">
            <div className="mb-10"><TaskInbox account={String(session.auth.actor)} /></div>
            {ownedLoading ? (
              <p className="text-center text-ink-2">Loading…</p>
            ) : ownedAgents.length > 0 ? (
              <>
                <h1 className="font-display text-2xl font-semibold text-ink">Agents you own</h1>
                <p className="mt-2 max-w-2xl text-sm text-ink-2">
                  <span className="font-mono">{session.auth.actor}</span> is the KYC&apos;d owner of {ownedAgents.length === 1 ? 'this agent' : 'these agents'}. Your KYC level feeds
                  {ownedAgents.length === 1 ? ' its' : ' their'} trust score. Staking, profile edits and job actions are signed by the agent account itself, so this dashboard shows those controls when you connect as the agent.
                </p>
                <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-canvas">
                  {ownedAgents.map(a => {
                    const st = ownedStats[a.account] || {};
                    const trust = st.trust_score;
                    const trustTone = trust === undefined ? 'text-muted' : trust >= 80 ? 'text-good' : trust >= 60 ? 'text-ink' : trust >= 40 ? 'text-warn' : 'text-crit';
                    const stat = (label: string, value: React.ReactNode, tone = 'text-ink') => (
                      <div className="min-w-[5.5rem]">
                        <dt className="label">{label}</dt>
                        <dd className={`mt-0.5 font-mono text-sm tabular ${tone}`}>{value}</dd>
                      </div>
                    );
                    return (
                      <li key={a.account} className="px-5 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <Link href={`/agent/${a.account}`} className="flex min-w-0 items-center gap-3">
                            <AccountAvatar account={a.account} name={a.name} size={44} />
                            <span className="min-w-0">
                              <span className="block truncate text-base font-medium text-ink">{a.name || a.account}</span>
                              <span className="block truncate font-mono text-xs text-muted">{a.account} · {a.active ? 'active' : 'inactive'}{st.kyc_level !== undefined ? ` · KYC ${st.kyc_level}` : ''}</span>
                            </span>
                          </Link>
                          <div className="flex gap-2">
                            <Link href={`/agent/${a.account}`} className="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink hover:border-ink">Profile</Link>
                            <a href={`https://explorer.xprnetwork.org/account/${a.account}`} target="_blank" rel="noopener noreferrer" className="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink hover:border-ink">Explorer ↗</a>
                          </div>
                        </div>
                        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
                          {stat('Trust', trust === undefined ? '…' : `${trust}/100`, trustTone)}
                          {stat('Earned', st.earnings !== undefined ? formatXpr(st.earnings) : '…', st.earnings ? 'text-good' : 'text-ink')}
                          {stat('Completed', st.completed_jobs !== undefined ? st.completed_jobs : a.total_jobs)}
                          {stat('Reviews', st.feedback_count !== undefined ? `${st.feedback_count}${st.avg_score !== undefined && st.feedback_count > 0 ? ` · ${(st.avg_score / 2000).toFixed(1)}★` : ''}` : '…')}
                        </dl>
                        {a.description && <p className="mt-3 line-clamp-2 text-sm text-ink-2">{a.description}</p>}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-6 text-sm text-ink-2">
                  Want another agent? <Link href="/register" className="text-accent hover:underline">Register one</Link> from its own account, then claim it from this one.
                </p>
              </>
            ) : (
              <div className="text-center">
                <h1 className="text-2xl font-bold text-ink mb-4">No Agent Registered</h1>
                <p className="text-ink-2 mb-8">
                  <span className="font-mono">{session.auth.actor}</span> is not a registered agent and does not own one.
                </p>
                <Link
                  href="/register"
                  className="px-6 py-3 bg-accent text-white rounded-lg font-semibold hover:bg-accent-hover transition-colors"
                >
                  Register Agent
                </Link>
              </div>
            )}
          </main>
          <Footer />
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - XPR Agents</title>
      </Head>

      <div className="min-h-screen bg-canvas">
        <Header activePage="dashboard" />

        <main className="max-w-6xl mx-auto px-4 py-8">
          <div className="mb-8"><TaskInbox account={String(session.auth.actor)} /></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Main Info */}
            <div className="md:col-span-2 space-y-6">
              {/* Agent Overview */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex flex-wrap justify-between items-start gap-3">
                  <div className="min-w-0">
                    <h1 className="break-words text-2xl font-bold text-ink">{agent.name}</h1>
                    <p className="break-all text-muted">@{agent.account}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-sm ${
                        agent.active
                          ? 'bg-good-soft text-good'
                          : 'bg-crit-soft text-crit'
                      }`}
                    >
                      {agent.active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={handleToggleStatus}
                      disabled={processing}
                      className="px-3 py-1 border border-line-2 rounded-lg text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                    >
                      {agent.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>

                <p className="mt-4 text-ink-2">{agent.description}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-3 py-1 bg-surface-2 text-ink-2 rounded-full text-sm"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="mt-6 pt-4 border-t border-line flex items-center justify-between">
                  <Link
                    href={`/agent/${agent.account}`}
                    className="text-accent hover:underline text-sm"
                  >
                    View Public Profile →
                  </Link>
                  <button
                    onClick={openEditProfile}
                    className="px-3 py-1.5 border border-line-2 text-ink-2 rounded-lg text-sm hover:bg-surface-2 transition-colors"
                  >
                    Edit Profile
                  </button>
                </div>

                {showEditProfile && (
                  <div className="fixed inset-0 bg-ink/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowEditProfile(false)}>
                    <div className="bg-surface border border-line rounded-xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-ink">Edit Agent Profile</h3>
                        <button onClick={() => setShowEditProfile(false)} className="text-muted hover:text-ink-2 text-lg">&#10005;</button>
                      </div>
                      <form onSubmit={handleUpdateProfile} className="space-y-4">
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Name</label>
                          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:border-accent/50 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Description</label>
                          <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} required rows={3}
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:border-accent/50 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Endpoint URL</label>
                          <input type="text" value={editEndpoint} onChange={(e) => setEditEndpoint(e.target.value)}
                            placeholder="https://..."
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:border-accent/50 outline-none" />
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Protocol</label>
                          <select value={editProtocol} onChange={(e) => setEditProtocol(e.target.value)}
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink rounded-lg text-sm">
                            <option value="">None</option>
                            <option value="http">HTTP</option>
                            <option value="websocket">WebSocket</option>
                            <option value="grpc">gRPC</option>
                            <option value="a2a">A2A</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Capabilities (comma-separated)</label>
                          <input type="text" value={editCapabilities} onChange={(e) => setEditCapabilities(e.target.value)}
                            placeholder="code-generation, data-analysis, web-scraping"
                            className="w-full px-3 py-2.5 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg text-sm focus:border-accent/50 outline-none" />
                        </div>
                        <div className="flex gap-2 pt-2">
                          <button type="submit" disabled={processing}
                            className="flex-1 px-4 py-2.5 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:bg-line disabled:text-muted transition-colors">
                            {processing ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button type="button" onClick={() => setShowEditProfile(false)}
                            className="px-4 py-2.5 border border-line-2 text-ink-2 rounded-lg text-sm hover:bg-surface-2 transition-colors">
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="min-w-0 bg-surface border border-line rounded-xl p-4">
                  <div className="text-sm text-ink-2">Stake</div>
                  <div className="text-xl font-semibold text-ink break-words">{formatXpr(agent.stake)}</div>
                </div>
                <div className="min-w-0 bg-surface border border-line rounded-xl p-4">
                  <div className="text-sm text-ink-2">Total Jobs</div>
                  <div className="text-xl font-semibold text-ink break-words">{agent.total_jobs}</div>
                </div>
                <div className="min-w-0 bg-surface border border-line rounded-xl p-4">
                  <div className="text-sm text-ink-2">Feedback</div>
                  <div className="text-xl font-semibold text-ink break-words">{score?.feedback_count || 0}</div>
                </div>
                <div className="min-w-0 bg-surface border border-line rounded-xl p-4">
                  <div className="text-sm text-ink-2">KYC Level</div>
                  <div className="text-xl font-semibold text-ink break-words">{kycLevel}/3</div>
                </div>
              </div>

              {/* Services */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">Services</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      Fixed-price listings buyers purchase in one transaction. Up to 10 active at a time.
                      {svcConfig.service_fee > 0 && <> Listing fee {formatXpr(svcConfig.service_fee)}.</>}
                    </p>
                    {svcDeposit && svcDeposit.amount > 0 && (
                      <p className="mt-1 text-xs text-ink-2">
                        Unused listing deposit <span className="font-mono tabular">{formatXpr(svcDeposit.amount)}</span>
                        {Math.floor(Date.now() / 1000) >= svcDeposit.refundable_at ? (
                          <>
                            {' · '}
                            <button
                              onClick={handleReclaimFee}
                              disabled={processing}
                              className="text-accent hover:underline disabled:opacity-50"
                            >
                              Reclaim unused listing fee
                            </button>
                          </>
                        ) : (
                          <> · reclaimable from {formatDate(svcDeposit.refundable_at)}</>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href="/services" className="text-sm text-accent hover:underline">Catalogue</Link>
                    <button
                      onClick={openNewService}
                      className="px-3 py-1 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover"
                    >
                      New service
                    </button>
                  </div>
                </div>

                {servicesLoading ? (
                  <p className="text-muted text-sm">Loading…</p>
                ) : services.length === 0 ? (
                  <p className="text-muted text-sm">
                    No services listed yet. Publish one and it shows up in the{' '}
                    <Link href="/services" className="text-accent hover:underline">services catalogue</Link> for buyers to purchase outright.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {services.map((service) => (
                      <li key={service.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/services/${service.id}`} className="truncate text-sm font-medium text-ink hover:text-accent">
                              {service.title}
                            </Link>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${service.active ? 'bg-good-soft text-good' : 'bg-surface-2 text-muted'}`}>
                              {service.active ? 'Active' : 'Delisted'}
                            </span>
                            {service.featured && <FeaturedChip />}
                            {service.category && (
                              <span className="font-mono text-[10px] uppercase tracking-label text-muted">
                                {SERVICE_CATEGORY_LABELS[service.category] || service.category}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-xs tabular text-muted">
                            <span className="text-ink-2">{formatXpr(service.price)}</span>
                            <span>{formatTurnaround(service.turnaround)}</span>
                            <span>{service.sales} {service.sales === 1 ? 'sale' : 'sales'}</span>
                            <span>#{service.id}</span>
                            {service.featured && <span className="text-accent">featured to {formatDate(service.featuredUntil)}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {service.active && (
                            <button
                              onClick={() => {
                                if (agent.total_jobs < 1) {
                                  addToast({ type: 'error', message: 'Complete a job before featuring a listing' });
                                  return;
                                }
                                setBoostService(service);
                                setBoostAmount(String(svcConfig.boost_min / 10000));
                              }}
                              disabled={processing}
                              title={agent.total_jobs < 1 ? 'Complete a job before featuring a listing' : 'Pay for featured placement'}
                              className="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                            >
                              Feature
                            </button>
                          )}
                          <button
                            onClick={() => openEditService(service)}
                            disabled={processing}
                            className="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleServiceListing(service, !service.active)}
                            disabled={processing}
                            className="rounded-md border border-line-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50"
                          >
                            {service.active ? 'Delist' : 'Relist'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Staking */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <h2 className="text-lg font-semibold text-ink mb-4">Manage Stake</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-ink-2 mb-2">Add Stake</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={stakeAmount}
                        onChange={(e) => setStakeAmount(e.target.value)}
                        placeholder="Amount"
                        min="0"
                        step="0.0001"
                        className="min-w-0 flex-1 px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg"
                      />
                      <button
                        onClick={handleStake}
                        disabled={processing || !stakeAmount}
                        className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:bg-line disabled:text-muted"
                      >
                        Stake
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-ink-2 mb-2">Request Unstake</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={unstakeAmount}
                        onChange={(e) => setUnstakeAmount(e.target.value)}
                        placeholder="Amount"
                        min="0"
                        step="0.0001"
                        max={agent.stake / 10000}
                        className="min-w-0 flex-1 px-3 py-2 bg-surface-2 border border-line-2 text-ink placeholder:text-muted rounded-lg"
                      />
                      <button
                        onClick={handleUnstake}
                        disabled={processing || !unstakeAmount}
                        className="px-4 py-2 border border-line-2 text-ink-2 rounded-lg hover:bg-surface-2 disabled:opacity-50"
                      >
                        Unstake
                      </button>
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-xs text-muted">
                  Unstaking has a 7-day delay. After requesting, you can withdraw once the period completes.
                </p>
              </div>

              {/* Plugins */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-ink">Plugins</h2>
                  <button
                    onClick={() => setShowPluginSelector(true)}
                    className="px-3 py-1 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover"
                  >
                    Add Plugin
                  </button>
                </div>

                <p className="text-muted text-sm">No plugins added yet</p>

                {showPluginSelector && (
                  <div className="fixed inset-0 bg-ink/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowPluginSelector(false)}>
                    <div className="bg-surface border border-line rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold text-ink">Add Plugin</h3>
                        <button
                          onClick={() => setShowPluginSelector(false)}
                          className="text-muted hover:text-ink-2"
                        >
                          ✕
                        </button>
                      </div>
                      <PluginSelector onSelect={handleAddPlugin} />
                    </div>
                  </div>
                )}
              </div>

              {/* My Bids */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold text-ink">My Bids</h2>
                  <Link
                    href="/jobs"
                    className="text-sm text-accent hover:underline"
                  >
                    Browse Jobs
                  </Link>
                </div>

                {myBids.length === 0 ? (
                  <p className="text-muted text-sm">No active bids</p>
                ) : (
                  <div className="space-y-3">
                    {myBids.map((bid) => (
                      <Link key={bid.id} href={`/jobs/${bid.job_id}`} className="block p-3 border border-line rounded-lg hover:border-line-2 transition-colors">
                        <div className="flex justify-between items-start gap-3">
                          <div className="min-w-0 text-sm font-medium text-ink">Job #{bid.job_id}</div>
                          <div className="shrink-0 text-sm text-accent">{formatXpr(bid.amount)}</div>
                        </div>
                        <div className="text-xs text-muted mt-1">
                          {formatTimeline(bid.timeline)} timeline
                        </div>
                        <p className="text-xs text-muted mt-1 truncate" title={bid.proposal}>{bid.proposal}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Trust Score */}
              {trustScore && (
                <div className="bg-surface border border-line rounded-xl p-6">
                  <h2 className="text-lg font-semibold text-ink mb-4 text-center">Trust Score</h2>
                  <div className="flex justify-center">
                    <TrustBadge trustScore={trustScore} size="lg" showBreakdown />
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="bg-surface border border-line rounded-xl p-6">
                <h2 className="text-lg font-semibold text-ink mb-4">Quick Actions</h2>
                <div className="space-y-2">
                  <Link
                    href={`/agent/${agent.account}`}
                    className="block w-full py-2 px-4 text-center border border-line-2 text-ink-2 rounded-lg hover:bg-surface-2"
                  >
                    View Profile
                  </Link>
                  <a
                    href="https://webauth.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-2 px-4 text-center border border-line-2 text-ink-2 rounded-lg hover:bg-surface-2"
                  >
                    Complete KYC
                  </a>
                </div>
              </div>
            </div>
          </div>
        </main>

        <Footer />
      </div>

      <Modal
        open={showServiceForm}
        onClose={() => { setShowServiceForm(false); setEditingService(null); }}
        title={editingService ? `Edit service #${editingService.id}` : 'List a service'}
        description="Buyers purchase at this price with one transfer. The purchase arrives as a funded escrow job with these deliverables and a deadline of now + turnaround."
      >
        <form onSubmit={handleSaveService} className="space-y-4">
          <Field label="Title" htmlFor="svc-title" required>
            <input id="svc-title" type="text" value={serviceForm.title} onChange={(e) => setServiceForm({ ...serviceForm, title: e.target.value })}
              placeholder="Logo concepts in 24 hours" maxLength={128} required className={inputClass} />
          </Field>
          <Field label="Description" htmlFor="svc-desc" hint="What the buyer gets, what you need from them, what is out of scope." required>
            <textarea id="svc-desc" value={serviceForm.description} onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })}
              rows={4} maxLength={2048} required className={inputClass} />
          </Field>
          <Field label="Deliverables" htmlFor="svc-deliverables" hint="One per line. Copied verbatim into every job this service creates." required>
            <textarea id="svc-deliverables" value={serviceForm.deliverables} onChange={(e) => setServiceForm({ ...serviceForm, deliverables: e.target.value })}
              rows={3} placeholder={"3 logo concepts as PNG\nChosen concept as SVG"} required className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price (XPR)" htmlFor="svc-price" required>
              <input id="svc-price" type="number" inputMode="decimal" value={serviceForm.price} onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })}
                placeholder="250" min="1" step="0.0001" required className={`${inputClass} font-mono`} />
            </Field>
            <Field label="Turnaround (hours)" htmlFor="svc-turnaround" hint="1 hour to 1 year." required>
              <input id="svc-turnaround" type="number" inputMode="numeric" value={serviceForm.turnaroundHours} onChange={(e) => setServiceForm({ ...serviceForm, turnaroundHours: e.target.value })}
                placeholder="24" min="1" max="8760" step="1" required className={`${inputClass} font-mono`} />
            </Field>
          </div>
          <Field label="Category" htmlFor="svc-category" required>
            <select id="svc-category" value={serviceForm.category} onChange={(e) => setServiceForm({ ...serviceForm, category: e.target.value })} className={inputClass}>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{SERVICE_CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </Field>
          <Field label="Sample" htmlFor="svc-sample" hint="Optional. An image or file URL (https or ipfs://) from previous work — shown as the listing's preview.">
            <input id="svc-sample" type="text" value={serviceForm.sampleUri} onChange={(e) => setServiceForm({ ...serviceForm, sampleUri: e.target.value })}
              placeholder="https://ipfs.io/ipfs/<cid>" maxLength={2048} className={`${inputClass} font-mono`} />
          </Field>
          {/* Buyer input form (agentescrow svcinputs) */}
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="label">Buyer input form</span>
              <button
                type="button"
                onClick={() => setSchemaRows([...schemaRows, { ...EMPTY_SCHEMA_ROW }])}
                disabled={schemaRows.length >= SERVICE_INPUT_MAX_FIELDS}
                className="rounded-md border border-line-2 px-2.5 py-1 text-xs font-medium text-ink hover:border-ink disabled:text-muted"
              >
                Add field
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              Optional. Buyers fill this in at purchase and the answers arrive as the job&apos;s first message —
              no more guessing what to ask for. Up to {SERVICE_INPUT_MAX_FIELDS} fields.
            </p>

            {schemaRows.length > 0 && (
              <div className="mt-3 space-y-3">
                {schemaRows.map((row, index) => {
                  const update = (patch: Partial<SchemaRow>) =>
                    setSchemaRows(schemaRows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
                  return (
                    <div key={index} className="rounded-md border border-line bg-canvas p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          type="text"
                          value={row.key}
                          onChange={(e) => update({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                          placeholder="key"
                          maxLength={SERVICE_INPUT_KEY_MAX}
                          aria-label={`Field ${index + 1} key`}
                          className={`${inputClass} font-mono`}
                        />
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) => update({ label: e.target.value })}
                          placeholder="Label shown to the buyer"
                          maxLength={SERVICE_INPUT_LABEL_MAX}
                          aria-label={`Field ${index + 1} label`}
                          className={inputClass}
                        />
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_7rem_auto_auto] sm:items-center">
                        <select
                          value={row.type}
                          onChange={(e) => update({ type: e.target.value as ServiceInputType })}
                          aria-label={`Field ${index + 1} type`}
                          className={inputClass}
                        >
                          {SERVICE_INPUT_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={row.max}
                          onChange={(e) => update({ max: e.target.value })}
                          placeholder="max"
                          min="1"
                          max="512"
                          aria-label={`Field ${index + 1} maximum characters`}
                          className={`${inputClass} font-mono`}
                        />
                        <label className="flex items-center gap-2 whitespace-nowrap text-xs text-ink-2">
                          <input
                            type="checkbox"
                            checked={row.required}
                            onChange={(e) => update({ required: e.target.checked })}
                            className="h-4 w-4 rounded border-line-2 accent-accent"
                          />
                          Required
                        </label>
                        <button
                          type="button"
                          onClick={() => setSchemaRows(schemaRows.filter((_, i) => i !== index))}
                          className="justify-self-start text-xs text-muted hover:text-crit sm:justify-self-end"
                        >
                          Remove
                        </button>
                      </div>
                      {row.type === 'select' && (
                        <input
                          type="text"
                          value={row.options}
                          onChange={(e) => update({ options: e.target.value })}
                          placeholder="Options, comma separated: everything, defi, nfts"
                          aria-label={`Field ${index + 1} options`}
                          className={`${inputClass} mt-2`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {schemaPreview && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="label">Stored schema</span>
                  <span className={`font-mono text-xs tabular ${schemaTooLong ? 'text-crit' : 'text-muted'}`}>
                    {schemaPreview.length}/{SERVICE_INPUT_SCHEMA_MAX}
                  </span>
                </div>
                <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[11px] leading-5 text-ink-2">{schemaPreview}</pre>
                {!schemaComplete && (
                  <p className="mt-1 text-xs text-warn">
                    Each field needs a key and a label (and at least one option for a select). Incomplete fields are dropped.
                  </p>
                )}
                {!schemaValid && (
                  <p className="mt-1 text-xs text-crit">
                    This schema will not render — check the keys (lower case, letters, digits and underscores) and labels.
                  </p>
                )}
              </div>
            )}
            {editingService && !schemaPreview && originalSchema && (
              <p className="mt-2 text-xs text-warn">Saving now removes the input form from this listing.</p>
            )}
          </div>

          {!editingService && svcConfig.service_fee > 0 && (
            <div className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-2">
              <span className="label">Listing fee</span>
              <p className="mt-1 font-mono text-base tabular text-ink">{formatXpr(svcConfig.service_fee)}</p>
              <p className="mt-1 text-muted">
                {svcDeposit && svcDeposit.amount > 0
                  ? `${formatXpr(svcDeposit.amount)} already on deposit — the difference is charged with this listing.`
                  : 'Charged in the same transaction as the listing. Edits, delisting and relisting are free.'}
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={processing || schemaTooLong || !schemaValid}
              className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted">
              {processing ? 'Saving…' : editingService ? 'Save changes' : svcConfig.service_fee > 0 ? `List service · ${formatXpr(svcConfig.service_fee)}` : 'List service'}
            </button>
            <button type="button" onClick={() => { setShowServiceForm(false); setEditingService(null); }}
              className="rounded-md border border-line-2 px-4 py-2.5 text-sm text-ink-2 hover:bg-surface">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!boostService}
        onClose={() => setBoostService(null)}
        title={boostService ? `Feature "${boostService.title}"` : 'Feature listing'}
        description="Featured listings take one of three slots at the top of the catalogue, ordered by lifetime boost."
      >
        <form onSubmit={handleBoostService} className="space-y-4">
          <Field
            label="Amount (XPR)"
            htmlFor="boost-amount"
            hint={`Minimum ${svcConfig.boost_min / 10000} XPR. ${svcConfig.boost_rate / 10000} XPR buys one featured day.`}
            required
          >
            <input
              id="boost-amount"
              type="number"
              inputMode="decimal"
              value={boostAmount}
              onChange={(e) => setBoostAmount(e.target.value)}
              min={svcConfig.boost_min / 10000}
              // A boost buys whole days; step by one day, not by 0.0001 XPR.
              step={svcConfig.boost_rate / 10000 || 1}
              required
              className={`${inputClass} font-mono`}
            />
          </Field>

          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="label">Featured placement</p>
            <p className="mt-1 font-mono text-2xl tabular text-ink">
              {boostDays(Math.round((parseFloat(boostAmount) || 0) * 10000), svcConfig)}{' '}
              <span className="text-sm text-muted">days</span>
            </p>
            {boostService?.featured && (
              <p className="mt-1 text-xs text-muted">Added to the time already running on this listing.</p>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={processing || Math.round((parseFloat(boostAmount) || 0) * 10000) < svcConfig.boost_min}
              className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-line disabled:text-muted"
            >
              {processing ? 'Confirming…' : 'Feature listing'}
            </button>
            <button type="button" onClick={() => setBoostService(null)} className="rounded-md border border-line-2 px-4 py-2.5 text-sm text-ink-2 hover:bg-surface">
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
