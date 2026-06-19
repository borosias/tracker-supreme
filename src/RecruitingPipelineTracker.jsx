import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Inbox,
  Link,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import './tracker.css';

const HIRING_STAGES = {
  application: { label: 'Заявка / контакт', short: 'Заявка', color: '#8B92A0' },
  recruiter_talk: { label: 'Общение с рекрутером', short: 'Рекрутер', color: '#4FB3BF' },
  hr_screen: { label: 'Первое интервью / HR screen', short: 'HR screen', color: '#6E88D8' },
  tech_interview: { label: 'Тех интервью', short: 'Тех', color: '#9D7CD8' },
  client_tech_or_final: { label: 'Клиентское тех / финальное', short: 'Клиент', color: '#D88B62' },
  pre_offer_final: { label: 'Финальное пред оффером', short: 'Пред оффер', color: '#E8A33D' },
  offer: { label: 'Оффер', short: 'Оффер', color: '#6FAE8A' },
};

const HIRING_STAGE_ORDER = Object.keys(HIRING_STAGES);

const WORK_STATES = {
  active: { label: 'Активно', color: '#6FAE8A' },
  waiting: { label: 'Ждём ответ', color: '#4FB3BF' },
  action_required: { label: 'Нужно действие', color: '#E8A33D' },
  paused: { label: 'Пауза', color: '#B6A06B' },
  lost: { label: 'Отвалилось', color: '#C56B5D' },
  offer_received: { label: 'Оффер получен', color: '#78C69A' },
  offer_accepted: { label: 'Оффер принят', color: '#6FAE8A' },
  offer_declined: { label: 'Оффер отклонён', color: '#B777E0' },
};

const ACTIVE_WORK_STATES = ['active', 'waiting', 'action_required', 'paused', 'offer_received'];

const STATUS_REASONS = {
  client_rejected: 'Клиент отказался',
  failed_interview: 'Не прошёл интервью',
  position_closed: 'Позицию закрыли',
  internal_hire: 'Закрыли внутрянкой',
  recruiter_ghosted: 'Рекрутер игнорит',
  project_postponed: 'Проект перенесли',
  candidate_withdrew: 'Сам отказался',
  no_budget: 'Нет бюджета',
  other: 'Другое',
};

const EVENT_TYPES = {
  created: { label: 'Процесс создан', icon: Plus },
  source_imported: { label: 'Источник импортирован', icon: Link },
  stage_changed: { label: 'Этап изменён', icon: ChevronRight },
  message_sent: { label: 'Сообщение отправлено', icon: MessageCircle },
  reply_received: { label: 'Ответ получен', icon: MessageCircle },
  interview_scheduled: { label: 'Интервью назначено', icon: CalendarDays },
  interview_completed: { label: 'Интервью пройдено', icon: Check },
  feedback_received: { label: 'Фидбек получен', icon: FileText },
  paused: { label: 'Поставлено на паузу', icon: Clock },
  lost: { label: 'Процесс отвалился', icon: X },
  resumed: { label: 'Процесс возобновлён', icon: RefreshCw },
  offer_received: { label: 'Оффер получен', icon: Briefcase },
  offer_decided: { label: 'Решение по офферу', icon: Check },
  note_added: { label: 'Заметка', icon: FileText },
};

const SOURCE_TYPES = {
  linkedin: 'LinkedIn',
  djinni: 'Djinni',
  manual: 'Вручную',
  other: 'Другое',
};

const NEXT_ACTION_TYPES = {
  follow_up: 'Follow-up',
  interview: 'Интервью',
  send_cv: 'Отправить CV',
  prepare: 'Подготовиться',
  decision: 'Принять решение',
  none: 'Нет действия',
};

const CONFIG_KEY = 'recruiting-pipeline-config-v1';
const STAGE_PREVIEW_LIMIT = 3;
const WORK_STATE_FILTER_ORDER = [
  'action_required',
  'waiting',
  'active',
  'paused',
  'lost',
  'offer_received',
  'offer_accepted',
  'offer_declined',
];

const pad2 = (value) => String(value).padStart(2, '0');

const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

const toDateParts = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const normalizeDateOnly = (value) => {
  if (!value) return '';
  if (value instanceof Date) return toDateParts(value);
  if (typeof value === 'number') {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return toDateParts(date);
  }

  const raw = textValue(value).trim();
  if (!raw) return '';

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const localMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (localMatch) {
    const [, day, month, year] = localMatch;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const parsed = new Date(raw);
  return toDateParts(parsed);
};

const safeDate = (value) => {
  const iso = normalizeDateOnly(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
};

const addDays = (iso, days) => {
  const base = safeDate(iso) || safeDate(todayISO()) || new Date();
  base.setDate(base.getDate() + days);
  return toDateParts(base);
};

const fmtDate = (iso) => {
  const d = safeDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const compareDateAsc = (a, b) => (normalizeDateOnly(a) || '9999-12-31').localeCompare(normalizeDateOnly(b) || '9999-12-31');

const storageGet = async (key) => {
  try {
    if (window.storage) {
      const res = await window.storage.get(key, false);
      return res?.value ? JSON.parse(res.value) : null;
    }
  } catch (error) {
    console.warn('Config storage read failed', error);
  }
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Local config read failed', error);
    return null;
  }
};

const storageSet = async (key, value) => {
  try {
    if (window.storage) {
      await window.storage.set(key, JSON.stringify(value), false);
      return;
    }
  } catch (error) {
    console.warn('Config storage save failed', error);
  }
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Local config save failed', error);
  }
};

const textValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const parsed = value.parsed && typeof value.parsed === 'object' ? value.parsed : {};
    return (
      textValue(value.default) ||
      textValue(value.short) ||
      textValue(value.linkedinText) ||
      textValue(value.text) ||
      textValue(value.name) ||
      textValue(value.title) ||
      textValue(value.companyName) ||
      textValue(parsed.text) ||
      [parsed.city || value.city, parsed.state || value.state, parsed.country || value.country].filter(Boolean).join(', ')
    );
  }
  return '';
};

const cleanProcess = (process) => ({
  id: process.id || genId(),
  title: textValue(process.title),
  companyName: textValue(process.companyName),
  role: textValue(process.role),
  recruiterName: textValue(process.recruiterName),
  recruiterTitle: textValue(process.recruiterTitle),
  recruiterLinkedinUrl: textValue(process.recruiterLinkedinUrl),
  recruiterEmail: textValue(process.recruiterEmail),
  sourceType: textValue(process.sourceType) || 'manual',
  sourceUrl: textValue(process.sourceUrl),
  sourceRawText: textValue(process.sourceRawText),
  hiringStage: process.hiringStage || 'application',
  workState: process.workState || 'active',
  statusReason: textValue(process.statusReason),
  statusNote: textValue(process.statusNote),
  nextActionType: process.nextActionType || 'follow_up',
  nextActionDate: normalizeDateOnly(process.nextActionDate) || todayISO(),
  nextActionTime: textValue(process.nextActionTime),
  nextActionNote: textValue(process.nextActionNote),
  salary: textValue(process.salary),
  location: textValue(process.location),
  calendarEventId: textValue(process.calendarEventId),
  createdAt: process.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastEventAt: process.lastEventAt || '',
});

const emptyProcess = () =>
  cleanProcess({
    title: '',
    hiringStage: 'application',
    workState: 'active',
    nextActionType: 'follow_up',
    nextActionDate: todayISO(),
  });

const createEvent = (process, type, note = '', patch = {}) => ({
  id: genId(),
  processId: process.id,
  type,
  occurredAt: new Date().toISOString(),
  title: EVENT_TYPES[type]?.label || type,
  note,
  hiringStage: patch.hiringStage || process.hiringStage,
  workState: patch.workState || process.workState,
  statusReason: patch.statusReason ?? process.statusReason ?? '',
  sourceType: patch.sourceType || process.sourceType || '',
  sourceUrl: patch.sourceUrl || process.sourceUrl || '',
  calendarEventId: patch.calendarEventId || process.calendarEventId || '',
});

const sortByDateAsc = (a, b) => compareDateAsc(a.nextActionDate, b.nextActionDate);

const sortStageItems = (items) =>
  [...items].sort((a, b) => {
    const stateOrder = Number(b.workState === 'action_required') - Number(a.workState === 'action_required');
    return stateOrder || sortByDateAsc(a, b);
  });

const getSortedStageItems = (processes, stageKey) => sortStageItems(processes.filter((process) => process.hiringStage === stageKey));

const getFilteredStageItems = (items, filter) => (filter && filter !== 'all' ? items.filter((process) => process.workState === filter) : items);

const getVisiblePreviewItems = (items, limit = STAGE_PREVIEW_LIMIT) => items.slice(0, limit);

const getStageFilterOptions = (items) => {
  const counts = new Map();
  items.forEach((process) => {
    counts.set(process.workState, (counts.get(process.workState) || 0) + 1);
  });
  const ordered = WORK_STATE_FILTER_ORDER.filter((state) => counts.has(state));
  const extras = [...counts.keys()].filter((state) => !WORK_STATE_FILTER_ORDER.includes(state)).sort();
  return [
    { key: 'all', label: 'Все', count: items.length },
    ...[...ordered, ...extras].map((state) => ({
      key: state,
      label: WORK_STATES[state]?.label || state,
      count: counts.get(state) || 0,
    })),
  ];
};

const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;

function callAppsScript(config, payload) {
  if (!config.apiUrl) {
    throw new Error('Добавь Apps Script Web App URL в настройках.');
  }

  return fetch(config.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, sharedSecret: config.sharedSecret || '' }),
  }).then(async (response) => {
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Apps Script error ${response.status}`);
    }
    return data;
  });
}

export default function RecruitingPipelineTracker() {
  const [config, setConfig] = useState({ apiUrl: '', sharedSecret: '' });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState('today');
  const [processes, setProcesses] = useState([]);
  const [events, setEvents] = useState([]);
  const [draft, setDraft] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState('');
  const [importState, setImportState] = useState({
    sourceType: 'linkedin',
    url: '',
    rawText: '',
    loading: false,
    result: null,
    warnings: [],
  });

  const selected = useMemo(
    () => processes.find((process) => process.id === selectedId) || null,
    [processes, selectedId]
  );

  const eventsByProcess = useMemo(() => {
    const map = new Map();
    events.forEach((event) => {
      const current = map.get(event.processId) || [];
      current.push(event);
      map.set(event.processId, current);
    });
    map.forEach((items) => items.sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || '')));
    return map;
  }, [events]);

  const stats = useMemo(() => {
    const active = processes.filter((process) => ACTIVE_WORK_STATES.includes(process.workState)).length;
    const action = processes.filter((process) => process.workState === 'action_required').length;
    const waiting = processes.filter((process) => process.workState === 'waiting').length;
    const offers = processes.filter((process) => process.workState.startsWith('offer')).length;
    return { active, action, waiting, offers };
  }, [processes]);

  const todayItems = useMemo(
    () =>
      processes
        .filter((process) => {
          const actionDate = normalizeDateOnly(process.nextActionDate);
          const due = actionDate && actionDate <= todayISO();
          return due && ACTIVE_WORK_STATES.includes(process.workState);
        })
        .sort(sortByDateAsc),
    [processes]
  );

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }, []);

  const loadFromApi = useCallback(
    async (targetConfig) => {
      if (!targetConfig.apiUrl) return;
      setLoading(true);
      try {
        const data = await callAppsScript(targetConfig, { action: 'listProcesses' });
        setProcesses((data.processes || []).map(cleanProcess));
        setEvents(data.events || []);
      } catch (error) {
        showToast(error.message);
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    (async () => {
      const saved = await storageGet(CONFIG_KEY);
      const nextConfig = saved || { apiUrl: '', sharedSecret: '' };
      setConfig(nextConfig);
      setLoaded(true);
      if (nextConfig.apiUrl) {
        await loadFromApi(nextConfig);
      }
    })();
  }, [loadFromApi]);

  const reload = async (overrideConfig = config) => {
    await loadFromApi(overrideConfig);
  };

  const saveConfig = async (nextConfig) => {
    const trimmed = {
      apiUrl: nextConfig.apiUrl.trim(),
      sharedSecret: nextConfig.sharedSecret.trim(),
    };
    setConfig(trimmed);
    await storageSet(CONFIG_KEY, trimmed);
    showToast('Настройки сохранены');
    if (trimmed.apiUrl) await reload(trimmed);
  };

  const persistProcess = async (process, event = null) => {
    setSaving(true);
    try {
      const cleaned = cleanProcess(process);
      await callAppsScript(config, { action: 'upsertProcess', process: cleaned });
      if (event) {
        await callAppsScript(config, { action: 'appendEvent', processId: cleaned.id, event });
      }
      setProcesses((prev) => {
        const exists = prev.some((item) => item.id === cleaned.id);
        return exists ? prev.map((item) => (item.id === cleaned.id ? cleaned : item)) : [cleaned, ...prev];
      });
      if (event) setEvents((prev) => [event, ...prev.filter((item) => item.id !== event.id)]);
      setDraft(null);
      setSelectedId(cleaned.id);
      showToast('Сохранено в Google Sheet');
      return cleaned;
    } catch (error) {
      showToast(error.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    if (!draft?.title?.trim() && !draft?.companyName?.trim()) {
      showToast('Нужно хотя бы название роли или компании');
      return;
    }
    const isNew = !processes.some((process) => process.id === draft.id);
    const process = cleanProcess(draft);
    const pendingEvent = draft.pendingEvent
      ? { ...draft.pendingEvent, processId: process.id, hiringStage: process.hiringStage, workState: process.workState }
      : null;
    const event = isNew ? pendingEvent || createEvent(process, 'created', 'Создана карточка hiring process') : null;
    await persistProcess(process, event);
  };

  const appendEvent = async (process, type, note, patch = {}) => {
    const nextProcess = cleanProcess({
      ...process,
      ...patch,
      lastEventAt: new Date().toISOString(),
    });
    const event = createEvent(process, type, note, patch);
    return await persistProcess(nextProcess, event);
  };

  const importSource = async () => {
    setImportState((state) => ({ ...state, loading: true, result: null, warnings: [] }));
    try {
      const data = await callAppsScript(config, {
        action: 'importSource',
        sourceType: importState.sourceType,
        url: importState.url.trim(),
        rawText: importState.rawText.trim(),
      });
      const processDraft = cleanProcess(data.processDraft || {});
      setImportState((state) => ({
        ...state,
        loading: false,
        result: { processDraft, eventDraft: data.eventDraft || null, confidence: data.confidence || 'low' },
        warnings: data.warnings || [],
      }));
      setDraft({ ...processDraft, pendingEvent: data.eventDraft || null });
      setView('today');
      showToast('Черновик импорта готов');
    } catch (error) {
      const fallback = cleanProcess({
        title: importState.sourceType === 'djinni' ? 'Djinni opportunity' : 'LinkedIn contact',
        sourceType: importState.sourceType,
        sourceUrl: importState.url.trim(),
        sourceRawText: importState.rawText.trim(),
        nextActionNote: 'Проверить импорт и заполнить недостающие поля',
        workState: 'action_required',
      });
      setDraft(fallback);
      setImportState((state) => ({
        ...state,
        loading: false,
        result: null,
        warnings: [error.message, 'Открыт ручной fallback-черновик.'],
      }));
    }
  };

  const syncCalendar = async (process) => {
    setSaving(true);
    try {
      const data = await callAppsScript(config, { action: 'syncCalendar', processId: process.id, process: cleanProcess(process) });
      if (data.process) {
        const cleaned = cleanProcess(data.process);
        setProcesses((prev) => prev.map((item) => (item.id === cleaned.id ? cleaned : item)));
      }
      if (data.event) setEvents((prev) => [data.event, ...prev]);
      showToast('Calendar синхронизирован');
    } catch (error) {
      showToast(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <Shell>
        <EmptyState icon={Loader2} title="Загрузка..." text="Поднимаю настройки треккера." spin />
      </Shell>
    );
  }

  return (
    <Shell>
      <Header stats={stats} loading={loading} onReload={() => reload()} />

      {!config.apiUrl && (
        <Notice
          tone="warning"
          title="Нужен Apps Script Web App URL"
          text="Google Sheet будет базой данных. Добавь URL в настройках, после деплоя backend скрипта."
          actionLabel="Открыть настройки"
          onAction={() => setView('settings')}
        />
      )}

      <Nav view={view} setView={setView} />

      <main className="app-main px-4 pb-28 sm:px-6">
        {view === 'today' && (
          <TodayView
            items={todayItems}
            processes={processes}
            eventsByProcess={eventsByProcess}
            onOpen={setSelectedId}
            onAdd={() => setDraft(emptyProcess())}
          />
        )}
        {view === 'funnel' && (
          <FunnelView
            processes={processes}
            eventsByProcess={eventsByProcess}
            onOpen={setSelectedId}
            onAdd={() => setDraft(emptyProcess())}
          />
        )}
        {view === 'import' && (
          <ImportView
            state={importState}
            setState={setImportState}
            onImport={importSource}
            disabled={!config.apiUrl}
          />
        )}
        {view === 'settings' && <SettingsView config={config} onSave={saveConfig} loading={loading} />}
      </main>

      {view !== 'settings' && (
        <button
          onClick={() => setDraft(emptyProcess())}
          className="fab fixed bottom-5 right-5 flex items-center justify-center shadow-lg"
          style={{ width: 52, height: 52, background: '#E8A33D', color: '#16191F', borderRadius: 6 }}
          title="Добавить hiring process"
        >
          <Plus size={23} />
        </button>
      )}

      {selected && (
        <ProcessDrawer
          process={selected}
          events={eventsByProcess.get(selected.id) || []}
          saving={saving}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setDraft(selected);
            setSelectedId(null);
          }}
          onEvent={appendEvent}
          onSyncCalendar={syncCalendar}
        />
      )}

      {draft && (
        <ProcessForm
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          onClose={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}

      {toast && (
        <div
          className="toast fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 font-mono text-xs"
          style={{ zIndex: 80, background: '#EDEEF0', color: '#16191F', borderRadius: 6 }}
        >
          {toast}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="app-shell" style={{ background: '#15181E', color: '#EDEEF0' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Space Grotesk', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        button, input, textarea, select { font: inherit; }
        button:disabled { opacity: .48; cursor: not-allowed; }
        .scroll-thin::-webkit-scrollbar { width: 8px; height: 8px; }
        .scroll-thin::-webkit-scrollbar-thumb { background: #3D424D; border-radius: 8px; }
      `}</style>
      {children}
    </div>
  );
}

function Header({ stats, loading, onReload }) {
  return (
    <header className="app-header px-4 pt-5 pb-4 sm:px-6" style={{ borderBottom: '1px solid #2B303B' }}>
      <div className="app-header-bar flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="app-title font-display text-2xl font-semibold">Recruiting Pipeline</h1>
          <p className="font-mono mt-1 text-xs" style={{ color: '#8B92A0' }}>
            {stats.active} активных · {stats.action} требуют действия · {stats.waiting} ждут · {stats.offers} офферов
          </p>
        </div>
        <button
          onClick={onReload}
          className="flex items-center gap-2 px-3 py-2 font-mono text-xs"
          style={{ border: '1px solid #2B303B', color: '#8B92A0', borderRadius: 5 }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Sync
        </button>
      </div>
    </header>
  );
}

function Nav({ view, setView }) {
  const items = [
    ['today', 'Дела', Clock],
    ['funnel', 'Воронка', Briefcase],
    ['import', 'Импорт', Sparkles],
    ['settings', 'API', Settings],
  ];
  return (
    <nav className="app-tabs flex gap-1 px-4 pt-4 sm:px-6">
      {items.map(([key, label, Icon]) => (
        <button
          key={key}
          onClick={() => setView(key)}
          className="flex items-center gap-1.5 px-3 py-2 font-mono text-xs"
          style={{
            color: view === key ? '#16191F' : '#8B92A0',
            background: view === key ? '#EDEEF0' : 'transparent',
            border: '1px solid ' + (view === key ? '#EDEEF0' : '#2B303B'),
            borderRadius: 5,
          }}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </nav>
  );
}

function Notice({ tone, title, text, actionLabel, onAction }) {
  const color = tone === 'warning' ? '#E8A33D' : '#4FB3BF';
  return (
    <div className="mx-4 mt-4 p-3 sm:mx-6" style={{ border: `1px solid ${color}`, background: '#1E222B' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs font-semibold" style={{ color }}>
            {title}
          </div>
          <p className="font-mono mt-1 text-xs" style={{ color: '#AAB0BC' }}>
            {text}
          </p>
        </div>
        {actionLabel && (
          <button onClick={onAction} className="px-2 py-1 font-mono text-xs" style={{ color, border: `1px solid ${color}` }}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function TodayView({ items, processes, eventsByProcess, onOpen, onAdd }) {
  const riskItems = processes
    .filter((process) => process.workState === 'paused' || process.workState === 'lost')
    .slice(0, 5);

  if (processes.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Пока нет hiring processes"
        text="Создай процесс вручную или импортируй LinkedIn/Djinni источник."
        actionLabel="Создать процесс"
        onAction={onAdd}
      />
    );
  }

  return (
    <div className="pt-4">
      <SectionTitle title="Сегодня и просрочено" count={items.length} color="#E8A33D" />
      {items.length === 0 ? (
        <InlineEmpty text="На сегодня нет обязательных действий." />
      ) : (
        <div>
          {items.map((process) => (
            <ProcessRow
              key={process.id}
              process={process}
              lastEvent={(eventsByProcess.get(process.id) || [])[0]}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}

      <SectionTitle title="Риски и паузы" count={riskItems.length} color="#C56B5D" />
      {riskItems.length === 0 ? (
        <InlineEmpty text="Нет процессов на паузе или в отвале." />
      ) : (
        riskItems.map((process) => (
          <ProcessRow
            key={process.id}
            process={process}
            lastEvent={(eventsByProcess.get(process.id) || [])[0]}
            onOpen={onOpen}
          />
        ))
      )}
    </div>
  );
}

function FunnelView({ processes, eventsByProcess, onOpen, onAdd }) {
  const [hoveredStageId, setHoveredStageId] = useState(null);
  const [pinnedStageId, setPinnedStageId] = useState(null);
  const [mobileExpandedStageId, setMobileExpandedStageId] = useState(null);
  const [stageFilters, setStageFilters] = useState({});

  useEffect(() => {
    const closeOpenStage = (event) => {
      const target = event.target;
      const element = target?.closest ? target : target?.parentElement;
      if (!element?.closest?.('[data-stage-folder="true"]')) {
        setHoveredStageId(null);
        setPinnedStageId(null);
        setMobileExpandedStageId(null);
      }
    };

    document.addEventListener('pointerdown', closeOpenStage);
    return () => document.removeEventListener('pointerdown', closeOpenStage);
  }, []);

  if (processes.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Воронка пустая"
        text="Добавь первую заявку, рекрутера или оффер-процесс."
        actionLabel="Добавить"
        onAction={onAdd}
      />
    );
  }

  const openStageId = mobileExpandedStageId || pinnedStageId || hoveredStageId;

  return (
    <div className="funnel-grid grid gap-4 pt-4 xl:grid-cols-2">
      {HIRING_STAGE_ORDER.map((stageKey) => {
        const stage = HIRING_STAGES[stageKey];
        const items = getSortedStageItems(processes, stageKey);
        const filter = stageFilters[stageKey] || 'all';
        const isPinned = pinnedStageId === stageKey;
        const isOpen = openStageId === stageKey;
        return (
          <StageFolder
            key={stageKey}
            stageKey={stageKey}
            stage={stage}
            items={items}
            filter={filter}
            isOpen={isOpen}
            isPinned={isPinned}
            eventsByProcess={eventsByProcess}
            onOpen={onOpen}
            onHover={setHoveredStageId}
            onToggle={() => {
              if (isCoarsePointer()) {
                setPinnedStageId(null);
                setMobileExpandedStageId((current) => (current === stageKey ? null : stageKey));
                return;
              }
              setMobileExpandedStageId(null);
              setPinnedStageId((current) => (current === stageKey ? null : stageKey));
            }}
            onFilterChange={(nextFilter) =>
              setStageFilters((current) => ({
                ...current,
                [stageKey]: nextFilter,
              }))
            }
          />
        );
      })}
    </div>
  );
}

function StageFolder({
  stageKey,
  stage,
  items,
  filter,
  isOpen,
  isPinned,
  eventsByProcess,
  onOpen,
  onHover,
  onToggle,
  onFilterChange,
}) {
  const filterOptions = getStageFilterOptions(items);
  const selectedFilter = filterOptions.some((option) => option.key === filter) ? filter : 'all';
  const filteredItems = getFilteredStageItems(items, selectedFilter);
  const previewItems = getVisiblePreviewItems(items);
  const hiddenCount = Math.max(items.length - previewItems.length, 0);

  return (
    <section
      data-stage-folder="true"
      data-stage-key={stageKey}
      className={`stage-folder min-w-0 ${isOpen ? 'is-open' : ''} ${isPinned ? 'is-pinned' : ''}`}
      style={{ '--stage-color': stage.color }}
      onMouseEnter={() => onHover(stageKey)}
      onMouseLeave={() => onHover((current) => (current === stageKey ? null : current))}
      onFocus={() => onHover(stageKey)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onHover((current) => (current === stageKey ? null : current));
        }
      }}
    >
      <button
        type="button"
        className="stage-folder-head"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="stage-folder-title font-display text-sm font-semibold">{stage.label}</span>
        <span className="stage-folder-meta font-mono text-xs">
          <span>{items.length}</span>
          <span className="stage-folder-indicator">{isOpen ? 'открыто' : 'папка'}</span>
        </span>
      </button>

      {items.length === 0 ? (
        <InlineEmpty text="Нет процессов на этом этапе." />
      ) : (
        <>
          <div className="stage-folder-preview" aria-hidden={isOpen ? 'true' : undefined}>
            <div className="stage-folder-card-stack">
              {previewItems.map((process, index) => (
                <div key={process.id} className="stage-folder-preview-item" style={{ '--stack-index': index }}>
                  <ProcessCard
                    process={process}
                    lastEvent={(eventsByProcess.get(process.id) || [])[0]}
                    onOpen={onOpen}
                  />
                </div>
              ))}
            </div>
            {hiddenCount > 0 && (
              <button type="button" className="stage-folder-more font-mono text-xs" onClick={onToggle} tabIndex={isOpen ? -1 : 0}>
                +{hiddenCount} ещё
              </button>
            )}
          </div>

          {isOpen && (
            <div className="stage-folder-expanded">
              <div className="stage-filter-chips">
                {filterOptions.map((option) => {
                  const active = selectedFilter === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`stage-filter-chip font-mono text-xs ${active ? 'is-active' : ''}`}
                      onClick={() => onFilterChange(option.key)}
                      aria-pressed={active}
                    >
                      {option.label}
                      <span>{option.count}</span>
                    </button>
                  );
                })}
              </div>

              {filteredItems.length === 0 ? (
                <InlineEmpty text="Нет процессов с этим состоянием." />
              ) : (
                <div className="stage-folder-list scroll-thin">
                  {filteredItems.map((process) => (
                    <ProcessCard
                      key={process.id}
                      process={process}
                      lastEvent={(eventsByProcess.get(process.id) || [])[0]}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ImportView({ state, setState, onImport, disabled }) {
  const set = (key, value) => setState((current) => ({ ...current, [key]: value }));
  return (
    <div className="pt-4">
      <div className="max-w-2xl p-4" style={{ background: '#1E222B', border: '1px solid #2B303B' }}>
        <div className="flex items-center gap-2">
          <Sparkles size={18} style={{ color: '#E8A33D' }} />
          <h2 className="font-display text-lg font-semibold">Импорт источника</h2>
        </div>
        <p className="font-mono mt-1 text-xs" style={{ color: '#8B92A0' }}>
          LinkedIn уходит в Apps Script + Apify. Djinni разбирается из URL или вставленного текста без логин-скрейпинга.
        </p>

        <label className="mt-4 block font-mono text-xs" style={{ color: '#8B92A0' }}>
          Источник
        </label>
        <Segmented
          value={state.sourceType}
          onChange={(value) => set('sourceType', value)}
          items={[
            ['linkedin', 'LinkedIn'],
            ['djinni', 'Djinni'],
            ['other', 'Другое'],
          ]}
        />

        <Field label="URL">
          <input
            value={state.url}
            onChange={(event) => set('url', event.target.value)}
            placeholder="https://www.linkedin.com/in/... или https://djinni.co/jobs/..."
            className="w-full p-2 font-mono text-sm"
            style={inputStyle}
          />
        </Field>

        <Field label="Скопированный текст / описание">
          <textarea
            value={state.rawText}
            onChange={(event) => set('rawText', event.target.value)}
            rows={6}
            placeholder="Для Djinni вставь текст вакансии или переписки. Для LinkedIn можно оставить пустым."
            className="w-full p-2 font-mono text-sm"
            style={inputStyle}
          />
        </Field>

        {state.warnings.length > 0 && (
          <div className="mt-3 p-3 font-mono text-xs" style={{ border: '1px solid #C56B5D', color: '#E6A49B' }}>
            {state.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )}

        <button
          onClick={onImport}
          disabled={disabled || state.loading || (!state.url.trim() && !state.rawText.trim())}
          className="mt-4 flex w-full items-center justify-center gap-2 py-2.5 font-mono text-xs"
          style={{ background: '#EDEEF0', color: '#16191F' }}
        >
          {state.loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Создать черновик
        </button>
      </div>
    </div>
  );
}

function SettingsView({ config, onSave, loading }) {
  const [local, setLocal] = useState(config);
  return (
    <div className="pt-4">
      <div className="max-w-2xl p-4" style={{ background: '#1E222B', border: '1px solid #2B303B' }}>
        <div className="flex items-center gap-2">
          <Settings size={18} style={{ color: '#4FB3BF' }} />
          <h2 className="font-display text-lg font-semibold">Apps Script API</h2>
        </div>
        <p className="font-mono mt-1 text-xs" style={{ color: '#8B92A0' }}>
          Вставь Web App URL деплоймента. Shared secret опционален, но лучше включить его в Script Properties.
        </p>

        <Field label="Web App URL">
          <input
            value={local.apiUrl}
            onChange={(event) => setLocal((current) => ({ ...current, apiUrl: event.target.value }))}
            placeholder="https://script.google.com/macros/s/.../exec"
            className="w-full p-2 font-mono text-sm"
            style={inputStyle}
          />
        </Field>

        <Field label="Shared secret">
          <input
            value={local.sharedSecret}
            onChange={(event) => setLocal((current) => ({ ...current, sharedSecret: event.target.value }))}
            placeholder="тот же SHARED_SECRET, если задан в Apps Script"
            className="w-full p-2 font-mono text-sm"
            style={inputStyle}
          />
        </Field>

        <button
          onClick={() => onSave(local)}
          disabled={loading}
          className="mt-4 flex w-full items-center justify-center gap-2 py-2.5 font-mono text-xs"
          style={{ background: '#EDEEF0', color: '#16191F' }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Сохранить и синхронизировать
        </button>
      </div>
    </div>
  );
}

function ProcessRow({ process, lastEvent, onOpen }) {
  const actionDate = normalizeDateOnly(process.nextActionDate);
  const overdue = actionDate && actionDate < todayISO();
  return (
    <button
      onClick={() => onOpen(process.id)}
      className="process-row w-full py-3 text-left"
      style={{ borderBottom: '1px solid #2B303B' }}
    >
      <div className="process-row-head flex items-center justify-between gap-3">
        <ProcessIdentity process={process} />
        <div className="process-date flex-shrink-0 text-right font-mono text-xs" style={{ color: overdue ? '#C56B5D' : '#8B92A0' }}>
          {fmtDate(process.nextActionDate)}
          <div>{NEXT_ACTION_TYPES[process.nextActionType] || 'Действие'}</div>
        </div>
      </div>
      {lastEvent && (
        <div className="mt-1 truncate pl-4 font-mono text-xs" style={{ color: '#666D7A' }}>
          {EVENT_TYPES[lastEvent.type]?.label || lastEvent.type}: {lastEvent.note || 'без заметки'}
        </div>
      )}
    </button>
  );
}

function ProcessCard({ process, lastEvent, onOpen }) {
  return (
    <button
      onClick={() => onOpen(process.id)}
      className="process-card mb-2 w-full p-3 text-left"
      style={{ background: '#1E222B', border: '1px solid #2B303B', borderRadius: 6 }}
    >
      <div className="process-card-head flex items-start justify-between gap-3">
        <ProcessIdentity process={process} />
        <StatePill state={process.workState} />
      </div>
      <div className="process-meta-row mt-3 flex items-center justify-between gap-3 font-mono text-xs" style={{ color: '#8B92A0' }}>
        <span className="process-card-note">{process.nextActionNote || NEXT_ACTION_TYPES[process.nextActionType] || 'Нет действия'}</span>
        <span className="process-date">{fmtDate(process.nextActionDate)}</span>
      </div>
      {(process.statusReason || lastEvent) && (
        <div className="mt-2 truncate font-mono text-xs" style={{ color: process.workState === 'lost' ? '#C56B5D' : '#666D7A' }}>
          {process.statusReason ? STATUS_REASONS[process.statusReason] : lastEvent?.note}
        </div>
      )}
    </button>
  );
}

function ProcessIdentity({ process }) {
  const stage = HIRING_STAGES[process.hiringStage] || HIRING_STAGES.application;
  return (
    <div className="process-identity min-w-0">
      <div className="flex items-center gap-2">
        <span style={{ width: 7, height: 7, background: stage.color, display: 'inline-block', flexShrink: 0 }} />
        <span className="truncate font-mono text-sm">{process.title || process.role || process.companyName || 'Без названия'}</span>
      </div>
      <div className="mt-0.5 truncate pl-4 font-mono text-xs" style={{ color: '#8B92A0' }}>
        {process.companyName || 'Компания не указана'} · {stage.short}
      </div>
    </div>
  );
}

function StatePill({ state }) {
  const item = WORK_STATES[state] || WORK_STATES.active;
  return (
    <span className="state-pill flex-shrink-0 px-2 py-1 font-mono text-xs" style={{ color: item.color, border: `1px solid ${item.color}` }}>
      {item.label}
    </span>
  );
}

function ProcessDrawer({ process, events, saving, onClose, onEdit, onEvent, onSyncCalendar }) {
  const [eventDraft, setEventDraft] = useState({ type: 'note_added', note: '', reason: process.statusReason || '' });
  const set = (key, value) => setEventDraft((current) => ({ ...current, [key]: value }));

  const quick = async (type) => {
    let savedProcess;
    if (type === 'message_sent') {
      savedProcess = await onEvent(process, type, eventDraft.note || 'Отправлено сообщение / follow-up', {
        workState: 'waiting',
        nextActionDate: addDays(todayISO(), 3),
        nextActionType: 'follow_up',
        nextActionNote: 'Проверить, ответил ли рекрутер',
      });
    } else if (type === 'reply_received') {
      savedProcess = await onEvent(process, type, eventDraft.note || 'Получен ответ', { workState: 'active' });
    } else if (type === 'interview_scheduled') {
      savedProcess = await onEvent(process, type, eventDraft.note || 'Назначено интервью', {
        workState: 'active',
        nextActionType: 'interview',
        nextActionDate: process.nextActionDate || todayISO(),
        nextActionNote: process.nextActionNote || 'Подготовиться к интервью',
      });
    } else if (type === 'paused') {
      savedProcess = await onEvent(process, type, eventDraft.note || 'Процесс поставлен на паузу', {
        workState: 'paused',
        statusReason: eventDraft.reason || 'project_postponed',
      });
    } else if (type === 'lost') {
      savedProcess = await onEvent(process, type, eventDraft.note || 'Процесс отвалился', {
        workState: 'lost',
        statusReason: eventDraft.reason || 'other',
      });
    } else if (type === 'offer_received') {
      savedProcess = await onEvent(process, type, eventDraft.note || 'Получен оффер', {
        hiringStage: 'offer',
        workState: 'offer_received',
        nextActionType: 'decision',
        nextActionDate: addDays(todayISO(), 2),
        nextActionNote: 'Принять решение по офферу',
      });
    } else if (type === 'offer_accept') {
      savedProcess = await onEvent(process, 'offer_decided', eventDraft.note || 'Оффер принят', {
        hiringStage: 'offer',
        workState: 'offer_accepted',
        nextActionType: 'none',
        nextActionNote: 'Оффер принят',
      });
    } else if (type === 'offer_decline') {
      savedProcess = await onEvent(process, 'offer_decided', eventDraft.note || 'Оффер отклонён', {
        hiringStage: 'offer',
        workState: 'offer_declined',
        nextActionType: 'none',
        nextActionNote: 'Оффер отклонён',
      });
    } else {
      savedProcess = await onEvent(process, type, eventDraft.note || EVENT_TYPES[type]?.label || type);
    }
    if (savedProcess && ['message_sent', 'interview_scheduled', 'offer_received'].includes(type)) {
      await onSyncCalendar(savedProcess);
    }
    setEventDraft({ type: 'note_added', note: '', reason: process.statusReason || '' });
  };

  const quickActions =
    process.hiringStage === 'offer' || process.workState === 'offer_received'
      ? [
          ['message_sent', EVENT_TYPES.message_sent.label],
          ['reply_received', EVENT_TYPES.reply_received.label],
          ['offer_accept', 'Оффер принят'],
          ['offer_decline', 'Оффер отклонён'],
        ]
      : [
          ['message_sent', EVENT_TYPES.message_sent.label],
          ['reply_received', EVENT_TYPES.reply_received.label],
          ['interview_scheduled', EVENT_TYPES.interview_scheduled.label],
          ['paused', EVENT_TYPES.paused.label],
          ['lost', EVENT_TYPES.lost.label],
          ['offer_received', EVENT_TYPES.offer_received.label],
        ];

  return (
    <div className="drawer-backdrop fixed inset-0 flex justify-end" style={{ zIndex: 60, background: 'rgba(0,0,0,0.55)' }}>
      <aside className="drawer-panel scroll-thin h-full w-full max-w-2xl overflow-y-auto p-5" style={{ background: '#1A1E26', borderLeft: '1px solid #2B303B' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{process.title || process.companyName || 'Hiring process'}</h2>
            <p className="font-mono mt-1 text-xs" style={{ color: '#8B92A0' }}>
              {process.companyName || 'Компания не указана'} · {HIRING_STAGES[process.hiringStage]?.label}
            </p>
          </div>
          <button onClick={onClose} title="Закрыть">
            <X size={20} style={{ color: '#8B92A0' }} />
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <InfoLine icon={UserRound} label="Рекрутер" value={process.recruiterName || '—'} />
          <InfoLine icon={Briefcase} label="Роль" value={process.role || '—'} />
          <InfoLine icon={Clock} label="Next action" value={`${fmtDate(process.nextActionDate)} · ${process.nextActionNote || NEXT_ACTION_TYPES[process.nextActionType]}`} />
          <InfoLine icon={AlertTriangle} label="Состояние" value={WORK_STATES[process.workState]?.label || process.workState} />
          <InfoLine icon={CalendarDays} label="Calendar" value={process.calendarEventId ? 'Синхронизирован' : 'Не синхронизирован'} />
        </div>

        {process.sourceUrl && (
          <a
            href={process.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center gap-2 font-mono text-xs"
            style={{ color: '#4FB3BF' }}
          >
            <ExternalLink size={14} />
            {SOURCE_TYPES[process.sourceType] || process.sourceType}: {process.sourceUrl}
          </a>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={onEdit} className="px-3 py-2 font-mono text-xs" style={secondaryButtonStyle}>
            Редактировать
          </button>
          <button onClick={() => onSyncCalendar(process)} disabled={saving} className="px-3 py-2 font-mono text-xs" style={secondaryButtonStyle}>
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14} /> {process.calendarEventId ? 'Update Calendar' : 'Sync Calendar'}
            </span>
          </button>
        </div>

        <div className="mt-5 p-3" style={{ background: '#15181E', border: '1px solid #2B303B' }}>
          <div className="font-display text-sm font-semibold">Быстрое событие</div>
          <Field label="Заметка">
            <input
              value={eventDraft.note}
              onChange={(event) => set('note', event.target.value)}
              placeholder="например: проект перенесли на 2 месяца"
              className="w-full p-2 font-mono text-sm"
              style={inputStyle}
            />
          </Field>
          <Field label="Причина для паузы/отвала">
            <select value={eventDraft.reason} onChange={(event) => set('reason', event.target.value)} className="w-full p-2 font-mono text-sm" style={inputStyle}>
              <option value="">Не выбрано</option>
              {Object.entries(STATUS_REASONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {quickActions.map(([type, label]) => (
              <button
                key={type}
                onClick={() => quick(type)}
                disabled={saving}
                className="py-2 font-mono text-xs"
                style={secondaryButtonStyle}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <SectionTitle title="История событий" count={events.length} color="#4FB3BF" />
          {events.length === 0 ? (
            <InlineEmpty text="Пока нет событий." />
          ) : (
            events.map((event) => <EventItem key={event.id} event={event} />)
          )}
        </div>
      </aside>
    </div>
  );
}

function ProcessForm({ draft, setDraft, saving, onClose, onSave }) {
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="form-backdrop fixed inset-0 flex items-end justify-center sm:items-center" style={{ zIndex: 70, background: 'rgba(0,0,0,0.58)' }}>
      <div className="form-panel scroll-thin max-h-[92vh] w-full max-w-2xl overflow-y-auto p-5" style={{ background: '#1E222B', border: '1px solid #2B303B' }}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Hiring process</h2>
          <button onClick={onClose}>
            <X size={18} style={{ color: '#8B92A0' }} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Название процесса">
            <input value={draft.title} onChange={(event) => set('title', event.target.value)} placeholder="Frontend Engineer — Fintech client" className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
          <Field label="Компания / клиент">
            <input value={draft.companyName} onChange={(event) => set('companyName', event.target.value)} placeholder="Company name" className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
          <Field label="Роль">
            <input value={draft.role} onChange={(event) => set('role', event.target.value)} placeholder="Senior Frontend Developer" className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
          <Field label="Рекрутер">
            <input value={draft.recruiterName} onChange={(event) => set('recruiterName', event.target.value)} placeholder="Name Surname" className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
          <Field label="LinkedIn рекрутера">
            <input value={draft.recruiterLinkedinUrl} onChange={(event) => set('recruiterLinkedinUrl', event.target.value)} placeholder="https://www.linkedin.com/in/..." className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
          <Field label="Email рекрутера">
            <input value={draft.recruiterEmail} onChange={(event) => set('recruiterEmail', event.target.value)} placeholder="name@company.com" className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
          <Field label="Локация">
            <input value={draft.location} onChange={(event) => set('location', event.target.value)} placeholder="Remote / EU / Kyiv" className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
          <Field label="Компенсация">
            <input value={draft.salary} onChange={(event) => set('salary', event.target.value)} placeholder="$5000/mo, B2B, gross..." className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
        </div>

        <Field label="Этап">
          <select value={draft.hiringStage} onChange={(event) => set('hiringStage', event.target.value)} className="w-full p-2 font-mono text-sm" style={inputStyle}>
            {Object.entries(HIRING_STAGES).map(([key, item]) => (
              <option key={key} value={key}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Состояние">
          <Segmented value={draft.workState} onChange={(value) => set('workState', value)} items={Object.entries(WORK_STATES).map(([key, item]) => [key, item.label])} />
        </Field>

        {(draft.workState === 'paused' || draft.workState === 'lost') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Причина">
              <select value={draft.statusReason} onChange={(event) => set('statusReason', event.target.value)} className="w-full p-2 font-mono text-sm" style={inputStyle}>
                <option value="">Не выбрано</option>
                {Object.entries(STATUS_REASONS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Комментарий к статусу">
              <input value={draft.statusNote} onChange={(event) => set('statusNote', event.target.value)} placeholder="например: проект перенесли на август" className="w-full p-2 font-mono text-sm" style={inputStyle} />
            </Field>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Next action type">
            <select value={draft.nextActionType} onChange={(event) => set('nextActionType', event.target.value)} className="w-full p-2 font-mono text-sm" style={inputStyle}>
              {Object.entries(NEXT_ACTION_TYPES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Дата">
            <input type="date" value={draft.nextActionDate || ''} onChange={(event) => set('nextActionDate', event.target.value)} className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
          <Field label="Время">
            <input type="time" value={draft.nextActionTime || ''} onChange={(event) => set('nextActionTime', event.target.value)} className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
        </div>

        <Field label="Что сделать дальше">
          <input value={draft.nextActionNote} onChange={(event) => set('nextActionNote', event.target.value)} placeholder="написать follow-up, подготовить вопросы, подтвердить слот..." className="w-full p-2 font-mono text-sm" style={inputStyle} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Тип источника">
            <select value={draft.sourceType} onChange={(event) => set('sourceType', event.target.value)} className="w-full p-2 font-mono text-sm" style={inputStyle}>
              {Object.entries(SOURCE_TYPES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="URL источника">
            <input value={draft.sourceUrl} onChange={(event) => set('sourceUrl', event.target.value)} placeholder="LinkedIn / Djinni / company URL" className="w-full p-2 font-mono text-sm" style={inputStyle} />
          </Field>
        </div>

        <Field label="Raw source text">
          <textarea value={draft.sourceRawText} onChange={(event) => set('sourceRawText', event.target.value)} rows={3} className="w-full p-2 font-mono text-sm" style={inputStyle} />
        </Field>

        <div className="mt-5 flex gap-2">
          <button onClick={onSave} disabled={saving} className="flex-1 py-2.5 font-mono text-xs" style={{ background: '#EDEEF0', color: '#16191F' }}>
            {saving ? 'Сохраняю...' : 'Сохранить'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 font-mono text-xs" style={secondaryButtonStyle}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

function EventItem({ event }) {
  const Icon = EVENT_TYPES[event.type]?.icon || FileText;
  const state = WORK_STATES[event.workState];
  return (
    <div className="mb-2 flex gap-3 p-3" style={{ background: '#1E222B', border: '1px solid #2B303B' }}>
      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center" style={{ background: '#23272F', color: '#4FB3BF', borderRadius: 4 }}>
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{EVENT_TYPES[event.type]?.label || event.type}</span>
          {state && (
            <span className="font-mono text-xs" style={{ color: state.color }}>
              {state.label}
            </span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-xs" style={{ color: '#8B92A0' }}>
          {fmtDateTime(event.occurredAt)} · {HIRING_STAGES[event.hiringStage]?.short || event.hiringStage}
        </div>
        {event.note && <p className="mt-2 font-mono text-xs" style={{ color: '#C8CDD6' }}>{event.note}</p>}
        {event.statusReason && <p className="mt-1 font-mono text-xs" style={{ color: '#C56B5D' }}>{STATUS_REASONS[event.statusReason]}</p>}
      </div>
    </div>
  );
}

function InfoLine({ icon: Icon, label, value }) {
  return (
    <div className="p-3" style={{ background: '#15181E', border: '1px solid #2B303B' }}>
      <div className="flex items-center gap-2 font-mono text-xs" style={{ color: '#8B92A0' }}>
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-sm">{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="mt-3 block">
      <span className="font-mono text-xs" style={{ color: '#8B92A0' }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Segmented({ value, onChange, items }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {items.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          type="button"
          className="px-2.5 py-1.5 font-mono text-xs"
          style={{
            background: value === key ? '#EDEEF0' : 'transparent',
            color: value === key ? '#16191F' : '#8B92A0',
            border: '1px solid ' + (value === key ? '#EDEEF0' : '#2B303B'),
            borderRadius: 4,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SectionTitle({ title, count, color }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between">
      <h2 className="font-display text-sm font-semibold" style={{ color }}>
        {title}
      </h2>
      <span className="font-mono text-xs" style={{ color: '#666D7A' }}>
        {count}
      </span>
    </div>
  );
}

function InlineEmpty({ text }) {
  return (
    <div className="p-4 text-center font-mono text-xs" style={{ border: '1px dashed #2B303B', color: '#666D7A' }}>
      {text}
    </div>
  );
}

function EmptyState({ icon: Icon, title, text, actionLabel, onAction, spin }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center">
      <Icon size={30} className={spin ? 'animate-spin' : ''} style={{ color: '#3D424D' }} />
      <h2 className="font-display mt-4 text-lg font-semibold">{title}</h2>
      <p className="font-mono mt-1 max-w-md text-xs" style={{ color: '#8B92A0' }}>
        {text}
      </p>
      {actionLabel && (
        <button onClick={onAction} className="mt-5 px-4 py-2 font-mono text-xs" style={{ background: '#EDEEF0', color: '#16191F' }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

const inputStyle = {
  background: '#15181E',
  border: '1px solid #2B303B',
  color: '#EDEEF0',
  borderRadius: 4,
};

const secondaryButtonStyle = {
  border: '1px solid #2B303B',
  color: '#AAB0BC',
  borderRadius: 4,
};
