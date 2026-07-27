import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, Plug, Heart, Settings, Layers, Zap, Pause, Play,
  Trash2, Plus, Check, Clock, ExternalLink, Link2, RefreshCw, ChevronDown,
} from 'lucide-react';
import { Card, Badge, Button, Input, Modal, EmptyState } from '@/components/ui';
import { getProject, updateProject, deleteProject, listAgentTypes, setChannelAgent, listProjects, addPlatformToProject, type ProjectDetail as ProjectDetailType, type ProjectSummary } from '@/api/projects';
import { listProviders, addProvider, removeProvider, activateProvider, type Provider, listGlobalProviders, type GlobalProvider, saveProviderRefs } from '@/api/providers';
import { getHeartbeat, pauseHeartbeat, resumeHeartbeat, triggerHeartbeat, setHeartbeatInterval, type HeartbeatStatus } from '@/api/heartbeat';
import { restartSystem } from '@/api/status';
import { formatTime, cn, projectDisplayName } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import PlatformSetupQR from './PlatformSetupQR';
import PlatformManualForm from './PlatformManualForm';
import { platformMeta } from '@/lib/platformMeta';

const PLATFORM_OPTIONS: { key: string; label: string; color: string; abbr: string; qr?: boolean }[] = [
  { key: 'feishu', label: 'Feishu / Lark', abbr: 'FS', color: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', qr: true },
  { key: 'weixin', label: 'WeChat', abbr: 'WX', color: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400', qr: true },
  { key: 'telegram', label: 'Telegram', abbr: 'TG', color: 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' },
  { key: 'discord', label: 'Discord', abbr: 'DC', color: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' },
  { key: 'slack', label: 'Slack', abbr: 'SK', color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' },
  { key: 'dingtalk', label: 'DingTalk', abbr: 'DT', color: 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' },
  { key: 'wecom', label: 'WeChat Work', abbr: 'WC', color: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' },
  { key: 'qq', label: 'QQ (OneBot)', abbr: 'QQ', color: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400' },
  { key: 'qqbot', label: 'QQ Bot (Official)', abbr: 'QB', color: 'bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400' },
  { key: 'yuanbao', label: 'Yuanbao', abbr: 'YB', color: 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400' },
  { key: 'line', label: 'LINE', abbr: 'LN', color: 'bg-lime-50 dark:bg-lime-900/30 text-lime-600 dark:text-lime-400' },
  { key: 'weibo', label: 'Weibo (微博)', abbr: 'WB', color: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400' },
  { key: 'tuitui', label: 'TuiTui (推推)', abbr: 'TT', color: 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' },
  { key: 'cloud_web', label: 'Cloud Web (自建 IM)', abbr: 'CW', color: 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' },
];

const isQRPlatform = (type: string) => type === 'feishu' || type === 'lark' || type === 'weixin';

type Tab = 'overview' | 'providers' | 'heartbeat' | 'settings';

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { name } = useParams<{ name: string }>();
  const location = useLocation();
  const authToken = useAuthStore(s => s.token);
  const [tab, setTab] = useState<Tab>('overview');
  const [project, setProject] = useState<ProjectDetailType | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [heartbeat, setHeartbeatState] = useState<HeartbeatStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Settings form
  const [language, setLanguage] = useState('');
  const [adminFrom, setAdminFrom] = useState('');
  const [disabledCmds, setDisabledCmds] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [agentMode, setAgentMode] = useState('');
  const [showCtxIndicator, setShowCtxIndicator] = useState(true);
  const [showWorkdirIndicator, setShowWorkdirIndicator] = useState(true);
  const [replyFooter, setReplyFooter] = useState(true);
  const [injectSender, setInjectSender] = useState(false);
  const [platformAllowFrom, setPlatformAllowFrom] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Agent type
  const [agentTypes, setAgentTypes] = useState<string[]>([]);
  const [selectedAgentType, setSelectedAgentType] = useState('');

  // Header agent switcher (jump between / create sibling `<slug>__<agent>` projects)
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [switchingAgent, setSwitchingAgent] = useState(false);

  // Global providers & refs
  const [globalProviders, setGlobalProviders] = useState<GlobalProvider[]>([]);
  const [providerRefs, setProviderRefs] = useState<string[]>([]);
  const [savingRefs, setSavingRefs] = useState(false);

  // Add provider modal
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [addMode, setAddMode] = useState<'pick' | 'custom'>('pick');
  const [newProvider, setNewProvider] = useState({ name: '', api_key: '', base_url: '', model: '' });

  // Interval modal
  const [showInterval, setShowInterval] = useState(false);
  const [newInterval, setNewInterval] = useState('30');

  // Add platform
  const [showAddPlatform, setShowAddPlatform] = useState(false);
  const [addPlatType, setAddPlatType] = useState('');
  // Agent for the channel being added ('' = inherit the project default). Lets a
  // new channel bind its own agent up front (e.g. a 2nd Feishu bot → codex).
  const [addPlatAgent, setAddPlatAgent] = useState('');
  const [savingChannel, setSavingChannel] = useState<number | null>(null);

  // Delete project
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteProject = async () => {
    if (!name) return;
    setDeleting(true);
    try {
      const res = await deleteProject(name);
      setShowDeleteConfirm(false);
      if (res.restart_required && window.confirm(t('setup.restartAfterDelete'))) {
        await restartSystem();
        // Wait for service to come back up before navigating
        await waitForService(8000);
      }
      navigate('/projects');
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setDeleting(false);
    }
  };

  const waitForService = (maxMs: number) =>
    new Promise<void>((resolve) => {
      const start = Date.now();
      const poll = () => {
        // /api/v1/status requires the management token; a plain fetch returns
        // 401 forever and the poll never sees a 200 (spinning until timeout with
        // a flood of 401s). Send the auth header so a recovered service resolves
        // promptly. During the restart window the proxy returns 502 → treated as
        // "not ready yet" and retried.
        fetch('/api/v1/status', authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined)
          .then((r) => { if (r.ok) resolve(); else throw new Error(); })
          .catch(() => {
            if (Date.now() - start > maxMs) { resolve(); return; }
            setTimeout(poll, 500);
          });
      };
      setTimeout(poll, 1500);
    });

  // applyAndRefresh waits for a backend-triggered engine reload to complete,
  // then refreshes. Channel changes (add/agent) auto-reload on the backend (the
  // management hooks fire RestartCh), so the UI never asks the user to restart.
  // The initial delay covers the backend's ~300ms response-flush before it tears
  // the servers down, so waitForService doesn't return early on the still-up
  // pre-reload service.
  const applyAndRefresh = async () => {
    await new Promise((r) => setTimeout(r, 800));
    await waitForService(8000);
    await fetchAll();
  };

  const fetchAll = useCallback(async () => {
    if (!name) return;
    try {
      setLoading(true);
      const [proj, provs, hb, gp, at, pl] = await Promise.allSettled([
        getProject(name),
        listProviders(name),
        getHeartbeat(name),
        listGlobalProviders(),
        listAgentTypes(),
        listProjects(),
      ]);
      if (proj.status === 'fulfilled') {
        setProject(proj.value);
        setLanguage(proj.value.settings?.language || '');
        setAdminFrom(proj.value.settings?.admin_from || '');
        setDisabledCmds(proj.value.settings?.disabled_commands?.join(', ') || '');
        setWorkDir(proj.value.work_dir || '');
        setAgentMode(proj.value.agent_mode || 'default');
        setSelectedAgentType(proj.value.agent_type || '');
        setShowCtxIndicator(proj.value.show_context_indicator !== false);
        setShowWorkdirIndicator(proj.value.show_workdir_indicator !== false);
        setReplyFooter(proj.value.reply_footer !== false);
        setInjectSender(proj.value.inject_sender === true);
        setProviderRefs(proj.value.provider_refs || []);
        const afMap: Record<string, string> = {};
        proj.value.platform_configs?.forEach(pc => {
          if (pc.allow_from !== undefined) afMap[pc.type] = pc.allow_from;
        });
        setPlatformAllowFrom(afMap);
      }
      if (provs.status === 'fulfilled') {
        setProviders(provs.value.providers || []);
        setActiveProvider(provs.value.active_provider || '');
      }
      if (hb.status === 'fulfilled') {
        const hbVal = hb.value;
        setHeartbeatState(hbVal?.enabled ? hbVal : null);
      }
      if (gp.status === 'fulfilled') {
        setGlobalProviders(gp.value.providers || []);
      }
      if (at.status === 'fulfilled') {
        setAgentTypes((at.value.agents || []).sort());
      }
      if (pl.status === 'fulfilled') {
        setAllProjects(pl.value.projects || []);
      }
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    fetchAll();
    const handler = () => fetchAll();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetchAll]);

  const handleSetChannelAgent = async (index: number, agent: string) => {
    if (!name || index < 0) return;
    setSavingChannel(index);
    try {
      // Backend rebinds the channel agent and hot-reloads the engine
      // (SetChannelAgentBinding fires RestartCh); just wait it out + refresh.
      await setChannelAgent(name, index, agent);
      await applyAndRefresh();
    } catch (e) {
      console.error('set channel agent failed', e);
    } finally {
      setSavingChannel(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!name) return;
    setSaving(true);
    try {
      const agentTypeChanged = project && selectedAgentType !== project.agent_type;
      const res = await updateProject(name, {
        language,
        admin_from: adminFrom,
        disabled_commands: disabledCmds.split(',').map(s => s.trim()).filter(Boolean),
        work_dir: workDir,
        mode: agentMode,
        ...(agentTypeChanged ? { agent_type: selectedAgentType } : {}),
        show_context_indicator: showCtxIndicator,
        show_workdir_indicator: showWorkdirIndicator,
        reply_footer: replyFooter,
        inject_sender: injectSender,
        platform_allow_from: platformAllowFrom,
      });
      if (res && (res as any).restart_required) {
        // Settings that need a rebuild (agent type / work_dir / mode): auto
        // restart without asking, then refresh.
        await restartSystem();
        await applyAndRefresh();
        return;
      }
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const handleAddProvider = async () => {
    if (!name || !newProvider.name) return;
    await addProvider(name, newProvider);
    setShowAddProvider(false);
    setNewProvider({ name: '', api_key: '', base_url: '', model: '' });
    fetchAll();
  };

  const handleSetInterval = async () => {
    if (!name) return;
    await setHeartbeatInterval(name, parseInt(newInterval));
    setShowInterval(false);
    fetchAll();
  };

  const tabs: { key: Tab; icon: React.ElementType }[] = [
    { key: 'overview', icon: Layers },
    { key: 'providers', icon: Zap },
    { key: 'heartbeat', icon: Heart },
    { key: 'settings', icon: Settings },
  ];

  if (loading && !project) {
    return <div className="flex items-center justify-center h-64 text-gray-400 animate-pulse">Loading...</div>;
  }

  const isEmbedded = window.self !== window.top || (globalThis as any).__CC_EMBED_MODE__ === true;

  // Agent switcher: the project name is `<slug>__<agentType>`. Strip the suffix
  // for display, and let the user jump to (or create) a sibling project running
  // a different agent on the same workspace slug.
  const agentSuffix = project ? `__${project.agent_type}` : '';
  const slug = project && name && name.endsWith(agentSuffix)
    ? name.slice(0, name.length - agentSuffix.length)
    : '';
  const canSwitchAgent = !!(project && slug);
  const displayName = project ? projectDisplayName(name || '', project.agent_type) : (name || '');
  const siblingExists = (agent: string) => allProjects.some(p => p.name === `${slug}__${agent}`);

  // Only agents that work with just a work_dir are offered for one-click create.
  // Others (e.g. `acp` needs a `command`) would produce an invalid project that
  // breaks the cc-connect engine on startup — see GitHub issue. Always keep the
  // current project's agent visible so it can still be marked/selected.
  const SWITCHABLE_AGENTS = ['claudecode', 'codex'];
  const switchableAgents = project && !SWITCHABLE_AGENTS.includes(project.agent_type)
    ? [project.agent_type, ...SWITCHABLE_AGENTS]
    : SWITCHABLE_AGENTS;

  const handleSwitchAgent = async (agent: string) => {
    setAgentMenuOpen(false);
    if (!project || !canSwitchAgent || agent === project.agent_type) return;
    const target = `${slug}__${agent}`;
    if (siblingExists(agent)) {
      navigate(`/projects/${target}`);
      return;
    }
    try {
      setSwitchingAgent(true);
      // add-platform creates the project in config when it doesn't exist yet,
      // seeding it with the bridge platform + work_dir copied from this sibling.
      await addPlatformToProject(target, { type: 'bridge', options: {}, work_dir: project.work_dir, agent_type: agent });
      await restartSystem();
      await waitForService(8000);
      navigate(`/projects/${target}`);
    } finally {
      setSwitchingAgent(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in ">
      {/* Back + title */}
      <div className="flex flex-row items-center justify-between gap-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {!isEmbedded && (
            <Link to="/projects" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0">
              <ArrowLeft size={18} className="text-gray-400" />
            </Link>
          )}
          <h2 className="text-xl font-bold text-gray-900 dark:text-white break-all leading-tight">{displayName}</h2>
          {project && canSwitchAgent ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setAgentMenuOpen(o => !o)}
                disabled={switchingAgent}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-60"
                title={t('projects.switchAgent', 'Switch agent')}
              >
                {switchingAgent ? t('projects.switchingAgent', 'Switching…') : project.agent_type}
                <ChevronDown size={12} />
              </button>
              {agentMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAgentMenuOpen(false)} />
                  <div className="absolute left-0 mt-1 z-20 min-w-[150px] max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
                    {switchableAgents.map(a => {
                      const isCurrent = a === project.agent_type;
                      const exists = siblingExists(a);
                      return (
                        <button
                          key={a}
                          type="button"
                          onClick={() => handleSwitchAgent(a)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors',
                            isCurrent && 'font-semibold text-blue-600 dark:text-blue-400',
                          )}
                        >
                          <span className="truncate">{a}</span>
                          {isCurrent ? <Check size={12} className="shrink-0" />
                            : !exists ? <span className="shrink-0 text-[10px] text-gray-400">{t('projects.createNew', '新建')}</span>
                            : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : (
            project && <Badge variant="info" className="shrink-0">{project.agent_type}</Badge>
          )}
        </div>

        {isEmbedded && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fetchAll()}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-700 shadow-sm shrink-0"
              title={t('common.refresh', 'Refresh')}
              aria-label={t('common.refresh', 'Refresh')}
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => {
                const path = location.pathname;
                const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
                window.open(`/cc-connect${path}${tokenParam}`, '_blank');
              }}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-700 shadow-sm shrink-0"
              title="在新窗口打开"
            >
              <ExternalLink size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-1 bg-gray-100/60 dark:bg-gray-800/60 p-1 rounded-xl">
        {tabs.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-1.5 px-1 rounded-lg text-xs font-medium transition-all min-w-0',
              tab === key
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            )}
          >
            <Icon size={13} className="shrink-0" />
            <span className="truncate">{t(`projects.tabs.${key}`)}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && project && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('projects.platforms')}</h3>
              <Button size="sm" onClick={() => { setShowAddPlatform(true); setAddPlatType(''); setAddPlatAgent(''); }}>
                <Plus size={14} /> {t('setup.addPlatform', 'Add platform')}
              </Button>
            </div>
            <div className="space-y-2">
              {project.platforms?.map((p, i) => (
                <div
                  key={`${p.type}-${p.index ?? i}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 dark:border-gray-800 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Live connection indicator: green = long connection up,
                        gray = down/reconnecting (reflects the engine's real
                        per-platform ready state). */}
                    <span
                      title={p.connected ? t('projects.channelConnected', 'Connected') : t('projects.channelDisconnected', 'Disconnected')}
                      className={cn(
                        'inline-block w-2 h-2 rounded-full shrink-0',
                        p.connected ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
                      )}
                    />
                    <span className="text-sm text-gray-900 dark:text-white truncate">{p.type}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      className="text-xs rounded border border-gray-200 dark:border-gray-700 bg-transparent px-1.5 py-0.5 disabled:opacity-50"
                      value={p.inherited ? '' : (p.agent || '')}
                      disabled={savingChannel === p.index}
                      onChange={(e) => handleSetChannelAgent(p.index ?? -1, e.target.value)}
                    >
                      <option value="">{t('projects.channelAgentInherit', 'Inherit')} · {project.agent_type}</option>
                      {agentTypes.map(a => <option key={a} value={a}>{a}</option>)}
                      {!p.inherited && p.agent && !agentTypes.includes(p.agent) && (
                        <option value={p.agent}>{p.agent}</option>
                      )}
                    </select>
                  </div>
                </div>
              ))}
              {(!project.platforms || project.platforms.length === 0) && (
                <p className="text-xs text-gray-400">{t('projects.noPlatforms', 'No channels yet')}</p>
              )}
            </div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{t('sessions.title')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {project.sessions_count} {t('nav.sessions').toLowerCase()}
            </p>
            {project.active_session_keys?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {project.active_session_keys.map((k) => (
                  <Badge key={k} variant="default">{k}</Badge>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'providers' && (() => {
        const globalNames = new Set(globalProviders.map(g => g.name));
        const isGlobal = (pName: string) => globalNames.has(pName) && providerRefs.includes(pName);
        const currentAgentType = project?.agent_type || selectedAgentType || '';
        const unlinkedGlobals = globalProviders.filter(g =>
          !providerRefs.includes(g.name) &&
          (!g.agent_types?.length || g.agent_types.includes(currentAgentType))
        );
        return (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('providers.title')}</h3>
            <Button size="sm" onClick={() => { setAddMode('pick'); setShowAddProvider(true); }} className="shrink-0 self-end sm:self-auto"><Plus size={14} /> {t('providers.add')}</Button>
          </div>

          {/* Unified provider list */}
          {providers.length === 0 ? (
            <Card>
              <div className="py-6 text-center">
                <Plug size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('providers.emptyProject', 'No providers configured for this project.')}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('providers.emptyProjectHint', 'Link a global provider or add a custom one.')}</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {providers.map((p) => (
                <div
                  key={p.name}
                  className={cn(
                    'flex flex-col sm:flex-row sm:items-start justify-between gap-3 px-4 py-3 rounded-xl border transition-all',
                    p.active
                      ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-900/10'
                      : 'border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white break-all">{p.name}</span>
                      {p.active && <Badge variant="success">{t('providers.active')}</Badge>}
                      {isGlobal(p.name) && (
                        <Link to="/providers" className="inline-flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-accent transition-colors shrink-0">
                          <Link2 size={10} /> {t('providers.global', 'global')}
                        </Link>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-all whitespace-normal">
                      {p.model}{p.base_url ? ` · ${p.base_url}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 sm:ml-3 self-end sm:self-center">
                    {!p.active && (
                      <Button size="sm" variant="ghost" onClick={() => { activateProvider(name!, p.name).then(fetchAll); }}>
                        <Zap size={14} /> {t('providers.activate')}
                      </Button>
                    )}
                    {!p.active && (
                      isGlobal(p.name) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-gray-400 hover:text-red-500"
                          onClick={async () => {
                             const next = providerRefs.filter(r => r !== p.name);
                             setSavingRefs(true);
                             try {
                               await saveProviderRefs(name!, next);
                               await fetchAll();
                             } finally { setSavingRefs(false); }
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-gray-400 hover:text-red-500" onClick={() => { removeProvider(name!, p.name).then(fetchAll); }}>
                          <Trash2 size={14} />
                        </Button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Provider Modal */}
          <Modal open={showAddProvider} onClose={() => setShowAddProvider(false)} title={t('providers.add')}>
            <div className="space-y-4">
              {/* Toggle */}
              <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                <button
                  className={cn('flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all', addMode === 'pick' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500')}
                  onClick={() => setAddMode('pick')}
                >{t('providers.linkGlobal', 'Link global')}</button>
                <button
                  className={cn('flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all', addMode === 'custom' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500')}
                  onClick={() => setAddMode('custom')}
                >{t('providers.addCustom', 'Add custom')}</button>
              </div>

              {addMode === 'pick' ? (
                unlinkedGlobals.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{t('providers.allLinked', 'All global providers are already linked.')}</p>
                    <Link to="/providers" className="inline-flex items-center gap-1 mt-2 text-xs text-accent hover:underline">
                      {t('providers.manageGlobal', 'Manage global providers')} <ExternalLink size={11} />
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {unlinkedGlobals.map(gp => (
                      <button
                        key={gp.name}
                        className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-accent/40 hover:bg-accent/5 transition-all text-left"
                        onClick={async () => {
                          const next = [...providerRefs, gp.name];
                          setSavingRefs(true);
                          try {
                            await saveProviderRefs(name!, next);
                            await fetchAll();
                          } finally { setSavingRefs(false); }
                          setShowAddProvider(false);
                        }}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">{gp.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{gp.model}{gp.base_url ? ` · ${gp.base_url}` : ''}</div>
                        </div>
                        <Plus size={16} className="shrink-0 text-gray-400" />
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <Input label={t('providers.name')} value={newProvider.name} onChange={(e) => setNewProvider({...newProvider, name: e.target.value})} />
                  <Input label="API Key" type="password" value={newProvider.api_key} onChange={(e) => setNewProvider({...newProvider, api_key: e.target.value})} />
                  <Input label={t('providers.baseUrl')} value={newProvider.base_url} onChange={(e) => setNewProvider({...newProvider, base_url: e.target.value})} placeholder="https://api.example.com" />
                  <Input label={t('providers.model')} value={newProvider.model} onChange={(e) => setNewProvider({...newProvider, model: e.target.value})} />
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="secondary" onClick={() => setShowAddProvider(false)}>{t('common.cancel')}</Button>
                    <Button onClick={handleAddProvider}>{t('providers.add')}</Button>
                  </div>
                </div>
              )}
            </div>
          </Modal>
        </div>
        );
      })()}

      {tab === 'heartbeat' && (
        <div className="space-y-4">
          {!heartbeat ? (
            <EmptyState message={t('heartbeat.notEnabled', 'Heartbeat is not configured for this project. Add [heartbeat] section in config.toml to enable.')} />
          ) : (
            <>
              <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-4">
                <Card><p className="text-xs text-gray-500">{t('heartbeat.status')}</p><p className="text-lg font-bold text-gray-900 dark:text-white mt-1">{heartbeat.paused ? t('heartbeat.paused') : t('heartbeat.running')}</p></Card>
                <Card><p className="text-xs text-gray-500">{t('heartbeat.interval')}</p><p className="text-lg font-bold text-gray-900 dark:text-white mt-1">{heartbeat.interval_mins}m</p></Card>
                <Card><p className="text-xs text-gray-500">{t('heartbeat.runCount')}</p><p className="text-lg font-bold text-gray-900 dark:text-white mt-1">{heartbeat.run_count}</p></Card>
                <Card><p className="text-xs text-gray-500">{t('heartbeat.errorCount')}</p><p className="text-lg font-bold text-gray-900 dark:text-white mt-1">{heartbeat.error_count}</p></Card>
              </div>
              <Card>
                <div className="space-y-2 text-sm">
                  <p className="text-gray-500">{t('heartbeat.lastRun')}: <span className="text-gray-900 dark:text-white">{formatTime(heartbeat.last_run)}</span></p>
                  <p className="text-gray-500">{t('heartbeat.skippedBusy')}: <span className="text-gray-900 dark:text-white">{heartbeat.skipped_busy}</span></p>
                  {heartbeat.last_error && <p className="text-red-500 break-all">{heartbeat.last_error}</p>}
                </div>
              </Card>
              <div className="flex flex-wrap gap-2">
                {heartbeat.paused ? (
                  <Button onClick={() => { resumeHeartbeat(name!).then(fetchAll); }}><Play size={14} /> {t('heartbeat.resume')}</Button>
                ) : (
                  <Button variant="secondary" onClick={() => { pauseHeartbeat(name!).then(fetchAll); }}><Pause size={14} /> {t('heartbeat.pause')}</Button>
                )}
                <Button variant="secondary" onClick={() => { triggerHeartbeat(name!).then(fetchAll); }}><Heart size={14} /> {t('heartbeat.trigger')}</Button>
                <Button variant="secondary" onClick={() => setShowInterval(true)}><Clock size={14} /> {t('heartbeat.setInterval')}</Button>
              </div>
            </>
          )}
          <Modal open={showInterval} onClose={() => setShowInterval(false)} title={t('heartbeat.setInterval')}>
            <div className="space-y-3">
              <Input label={`${t('heartbeat.interval')} (min)`} type="number" value={newInterval} onChange={(e) => setNewInterval(e.target.value)} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowInterval(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleSetInterval}>{t('common.save')}</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {tab === 'settings' && project && (
        <div className="space-y-4">
        {/* Agent settings */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{t('projects.agentSettings', 'Agent')}</h3>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('projects.agentType', 'Agent type')}
              </label>
              <select
                value={selectedAgentType}
                onChange={(e) => setSelectedAgentType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                {agentTypes.map(a => <option key={a} value={a}>{a}</option>)}
                {selectedAgentType && !agentTypes.includes(selectedAgentType) && (
                  <option value={selectedAgentType}>{selectedAgentType}</option>
                )}
              </select>
              {selectedAgentType !== project.agent_type && (
                <p className="text-[11px] text-amber-500 mt-1">{t('projects.agentTypeChangeHint', 'Changing agent type requires restart. Incompatible providers will be removed.')}</p>
              )}
            </div>
            <Input label={t('projects.workDir', 'Working directory')} value={workDir} onChange={(e) => setWorkDir(e.target.value)} placeholder="/path/to/project" />
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('projects.agentMode', 'Permission mode')}
              </label>
              <select
                value={agentMode}
                onChange={(e) => setAgentMode(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="default">default</option>
                <option value="acceptEdits">acceptEdits (edit)</option>
                <option value="plan">plan</option>
                <option value="bypassPermissions">bypassPermissions (yolo)</option>
                <option value="dontAsk">dontAsk</option>
              </select>
            </div>
          </div>
        </Card>

        {/* General settings */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{t('projects.generalSettings', 'General')}</h3>
          <div className="space-y-4 max-w-lg">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('projects.replyFooter', 'Reply footer')}</label>
                <p className="text-[11px] text-gray-400 mt-0.5">{t('projects.replyFooterHint', 'Master toggle for the per-turn reply footer')}</p>
              </div>
              <button
                onClick={() => setReplyFooter(!replyFooter)}
                className={cn('w-10 h-6 rounded-full transition-colors', replyFooter ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-700')}
              >
                <div className={cn('w-4 h-4 bg-white rounded-full transition-transform mx-1', replyFooter ? 'translate-x-4' : 'translate-x-0')} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('projects.showCtxIndicator', 'Footer line 1: context')}</label>
                <p className="text-[11px] text-gray-400 mt-0.5">{t('projects.showCtxIndicatorHint', 'Show model · effort · token usage · context % line in the reply footer')}</p>
              </div>
              <button
                onClick={() => setShowCtxIndicator(!showCtxIndicator)}
                className={cn('w-10 h-6 rounded-full transition-colors', showCtxIndicator ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-700')}
              >
                <div className={cn('w-4 h-4 bg-white rounded-full transition-transform mx-1', showCtxIndicator ? 'translate-x-4' : 'translate-x-0')} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('projects.showWorkdirIndicator', 'Footer line 2: workdir')}</label>
                <p className="text-[11px] text-gray-400 mt-0.5">{t('projects.showWorkdirIndicatorHint', 'Show workspace directory line in the reply footer')}</p>
              </div>
              <button
                onClick={() => setShowWorkdirIndicator(!showWorkdirIndicator)}
                className={cn('w-10 h-6 rounded-full transition-colors', showWorkdirIndicator ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-700')}
              >
                <div className={cn('w-4 h-4 bg-white rounded-full transition-transform mx-1', showWorkdirIndicator ? 'translate-x-4' : 'translate-x-0')} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('projects.injectSender', 'Inject sender')}</label>
                <p className="text-[11px] text-gray-400 mt-0.5">{t('projects.injectSenderHint', 'Prepend sender identity to messages sent to agent')}</p>
              </div>
              <button
                onClick={() => setInjectSender(!injectSender)}
                className={cn('w-10 h-6 rounded-full transition-colors', injectSender ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-700')}
              >
                <div className={cn('w-4 h-4 bg-white rounded-full transition-transform mx-1', injectSender ? 'translate-x-4' : 'translate-x-0')} />
              </button>
            </div>
            <Input label={t('projects.language')} value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en, zh, ja..." />
            <Input label={t('projects.adminFrom')} value={adminFrom} onChange={(e) => setAdminFrom(e.target.value)} placeholder="user1,user2 or *" />
            <Input label={t('projects.disabledCommands')} value={disabledCmds} onChange={(e) => setDisabledCmds(e.target.value)} placeholder="restart, upgrade, cron" />
          </div>
        </Card>

        {/* Per-platform allow_from */}
        {project.platform_configs && project.platform_configs.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">{t('projects.platformAccess', 'Platform access control')}</h3>
          <div className="space-y-3 max-w-lg">
            {project.platform_configs.map(pc => (
              <Input
                key={pc.type}
                label={`${pc.type} — ${t('fields.allowFrom')}`}
                value={platformAllowFrom[pc.type] ?? pc.allow_from ?? ''}
                onChange={(e) => setPlatformAllowFrom(prev => ({ ...prev, [pc.type]: e.target.value }))}
                placeholder='user1,user2 or *'
              />
            ))}
          </div>
        </Card>
        )}

        <div className="max-w-lg">
          <Button loading={saving} onClick={handleSaveSettings}>{t('common.save')}</Button>
        </div>
        <Card>
          <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-3">{t('projects.dangerZone', 'Danger Zone')}</h3>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">{t('projects.deleteTitle')}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('projects.deleteHint', 'Remove this project from config. Requires restart.')}</p>
            </div>
            <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)} className="shrink-0 self-end sm:self-auto">
              <Trash2 size={14} /> {t('common.delete')}
            </Button>
          </div>
        </Card>
        </div>
      )}

      {/* Delete confirmation */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title={t('projects.deleteTitle')}>
        <div className="space-y-4 py-2">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('projects.deleteConfirm', { name })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={handleDeleteProject} disabled={deleting}>
              {deleting ? t('common.deleting', 'Deleting...') : t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Platform Modal */}
      <Modal open={showAddPlatform} onClose={() => setShowAddPlatform(false)} title={t('setup.addPlatform', 'Add platform')}>
        {!addPlatType ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              {t('setup.choosePlatform', 'Choose a platform to connect:')}
            </p>
            <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
              {PLATFORM_OPTIONS.map(({ key, label, color, qr, abbr }) => (
                <button
                  key={key}
                  onClick={() => setAddPlatType(key)}
                  className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-accent/50 hover:bg-accent/5 transition-all text-left"
                >
                  <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center shrink-0 font-bold text-xs`}>
                    {abbr}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{label}</div>
                    <div className="text-[11px] text-gray-400">
                      {qr ? t('setup.scanToConnect', 'Scan QR code') : t('setup.manualSetup', 'Manual setup')}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Per-channel agent for the channel being added. Empty = inherit. */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                {t('projects.channelAgent', 'Agent')}
              </label>
              <select
                className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5"
                value={addPlatAgent}
                onChange={(e) => setAddPlatAgent(e.target.value)}
              >
                <option value="">{t('projects.channelAgentInherit', 'Inherit')} · {project?.agent_type || ''}</option>
                {agentTypes.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {isQRPlatform(addPlatType) ? (
              <PlatformSetupQR
                platformType={addPlatType as 'feishu' | 'weixin'}
                projectName={name!}
                agentType={addPlatAgent || undefined}
                onComplete={async () => {
                  setShowAddPlatform(false);
                  await applyAndRefresh();
                }}
                onCancel={() => setAddPlatType('')}
              />
            ) : platformMeta[addPlatType] ? (
              <PlatformManualForm
                platformType={addPlatType}
                projectName={name!}
                agentType={addPlatAgent || undefined}
                onComplete={async () => {
                  setShowAddPlatform(false);
                  await applyAndRefresh();
                }}
                onCancel={() => setAddPlatType('')}
              />
            ) : (
              <div className="space-y-4 py-4 text-center">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('setup.manualHint', 'For {{platform}}, please configure credentials in config.toml and restart the service.', { platform: PLATFORM_OPTIONS.find(o => o.key === addPlatType)?.label || addPlatType })}
                </p>
                <Button variant="secondary" onClick={() => setAddPlatType('')}>{t('common.back')}</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
