import {useCallback, useEffect, useMemo, useState} from 'react';
import {
    AlertTriangle,
    Activity,
    BarChart3,
    Briefcase,
    Building2,
    CalendarDays,
    Check,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    Clock,
    Copy,
    DollarSign,
    ExternalLink,
    FileText,
    Inbox,
    Link,
    Loader2,
    MapPin,
    MessageCircle,
    Plus,
    RefreshCw,
    Search,
    Settings,
    Sparkles,
    Trash2,
    UserRound,
    X,
} from 'lucide-react';
import {
    DIAGNOSTIC_STAGE_LABELS,
    DIAGNOSTIC_STATUS,
    filterDiagnostics,
    formatDiagnosticReport,
    maskDiagnosticUrl,
    normalizeDiagnostic,
} from './importDiagnostics.js';
import {
    BLOCKER_REASONS,
    LOST_REASONS,
    PAUSE_REASONS,
    buildResolveBlockerPatch,
    buildResumePatch,
    getBlockerReasonOptions,
    isProcessBlocked,
    partitionTodayItems,
    validateStateAction,
} from './processBlockers.js';
import { DEFAULT_TARGET_ROLE, cleanScraperText, normalizeTargetRole } from './processDefaults.js';
import './tracker.css';

const HIRING_STAGES = {
    application: {label: 'Заявка / контакт', short: 'Заявка', color: '#8B92A0'},
    recruiter_talk: {label: 'Общение с рекрутером', short: 'Рекрутер', color: '#4FB3BF'},
    hr_screen: {label: 'Первое интервью / HR screen', short: 'HR screen', color: '#6E88D8'},
    tech_interview: {label: 'Тех интервью', short: 'Тех', color: '#9D7CD8'},
    client_tech_or_final: {label: 'Клиентское тех / финальное', short: 'Клиент', color: '#D88B62'},
    pre_offer_final: {label: 'Финальное пред оффером', short: 'Пред оффер', color: '#E8A33D'},
    offer: {label: 'Оффер', short: 'Оффер', color: '#6FAE8A'},
};

const HIRING_STAGE_ORDER = Object.keys(HIRING_STAGES);

const WORK_STATES = {
    active: {label: 'Активно', color: '#6FAE8A'},
    waiting: {label: 'Ждём ответ', color: '#4FB3BF'},
    action_required: {label: 'Нужно действие', color: '#E8A33D'},
    paused: {label: 'Пауза', color: '#B6A06B'},
    lost: {label: 'Отвалилось', color: '#C56B5D'},
    offer_received: {label: 'Оффер получен', color: '#78C69A'},
    offer_accepted: {label: 'Оффер принят', color: '#6FAE8A'},
    offer_declined: {label: 'Оффер отклонён', color: '#B777E0'},
};

const ACTIVE_WORK_STATES = ['active', 'waiting', 'action_required', 'paused', 'offer_received'];

const STATUS_REASONS = {...PAUSE_REASONS, ...LOST_REASONS};

const STATUS_REASON_COLORS = {
    client_rejected: '#C56B5D',
    failed_interview: '#D88B62',
    position_closed: '#E8A33D',
    internal_hire: '#6E88D8',
    recruiter_ghosted: '#9D7CD8',
    no_response_after_followups: '#9D7CD8',
    project_postponed: '#B6A06B',
    candidate_withdrew: '#8B92A0',
    no_budget: '#B777E0',
    other: '#666D7A',
};

const EVENT_TYPES = {
    created: {label: 'Процесс создан', icon: Plus},
    source_imported: {label: 'Источник импортирован', icon: Link},
    stage_changed: {label: 'Этап изменён', icon: ChevronRight},
    message_sent: {label: 'Сообщение отправлено', icon: MessageCircle},
    reply_received: {label: 'Ответ получен', icon: MessageCircle},
    interview_scheduled: {label: 'Интервью назначено', icon: CalendarDays},
    interview_completed: {label: 'Интервью пройдено', icon: Check},
    feedback_received: {label: 'Фидбек получен', icon: FileText},
    paused: {label: 'Поставлено на паузу', icon: Clock},
    lost: {label: 'Процесс отвалился', icon: X},
    blocker_added: {label: 'Добавлен блокер', icon: AlertTriangle},
    blocker_resolved: {label: 'Блокер снят', icon: CircleCheck},
    resumed: {label: 'Процесс возобновлён', icon: RefreshCw},
    offer_received: {label: 'Оффер получен', icon: Briefcase},
    offer_decided: {label: 'Решение по офферу', icon: Check},
    note_added: {label: 'Заметка', icon: FileText},
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
    return d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'});
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
  role: normalizeTargetRole(textValue(process.role)),
    recruiterName: textValue(process.recruiterName),
  recruiterTitle: cleanScraperText(textValue(process.recruiterTitle)),
    recruiterLinkedinUrl: textValue(process.recruiterLinkedinUrl),
    recruiterEmail: textValue(process.recruiterEmail),
    sourceType: textValue(process.sourceType) || 'manual',
    sourceUrl: textValue(process.sourceUrl),
    sourceRawText: textValue(process.sourceRawText),
    hiringStage: process.hiringStage || 'application',
    workState: process.workState || 'active',
    statusReason: textValue(process.statusReason),
    statusNote: textValue(process.statusNote),
    blockerReason: textValue(process.blockerReason),
    blockerNote: textValue(process.blockerNote),
    blockedAt: textValue(process.blockedAt),
    blockerReviewDate: normalizeDateOnly(process.blockerReviewDate),
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
    blockerReason: patch.eventBlockerReason ?? patch.blockerReason ?? process.blockerReason ?? '',
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
        {key: 'all', label: 'Все', count: items.length},
        ...[...ordered, ...extras].map((state) => ({
            key: state,
            label: WORK_STATES[state]?.label || state,
            count: counts.get(state) || 0,
        })),
    ];
};

const isCoarsePointer = () =>
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;

const daysBetween = (fromIso, toIso = todayISO()) => {
    const from = safeDate(fromIso);
    const to = safeDate(toIso);
    if (!from || !to) return 0;
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
};

const getLastActivityDate = (process, eventsByProcess) => {
    const events = eventsByProcess.get(process.id) || [];
    return normalizeDateOnly(events[0]?.occurredAt || process.lastEventAt || process.updatedAt || process.createdAt);
};

const countBy = (items, getKey) =>
    items.reduce((map, item) => {
        const key = getKey(item) || 'other';
        map.set(key, (map.get(key) || 0) + 1);
        return map;
    }, new Map());

const getRecentActivityBuckets = (events, days = 14) => {
    const today = todayISO();
    const counts = countBy(events, (event) => normalizeDateOnly(event.occurredAt));
    return Array.from({length: days}, (_, index) => {
        const date = addDays(today, index - days + 1);
        return {date, count: counts.get(date) || 0};
    });
};

function callAppsScript(config, payload) {
    if (!config.apiUrl) {
        throw new Error('Добавь Apps Script Web App URL в настройках.');
    }

    return fetch(config.apiUrl, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({...payload, sharedSecret: config.sharedSecret || ''}),
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
    const [config, setConfig] = useState({apiUrl: '', sharedSecret: ''});
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
        diagnostic: null,
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
        const blocked = processes.filter((process) => ['active', 'waiting', 'action_required', 'offer_received'].includes(process.workState) && isProcessBlocked(process)).length;
        return {active, action, waiting, offers, blocked};
    }, [processes]);

    const todayWork = useMemo(() => partitionTodayItems(processes, todayISO()), [processes]);
    const todayItems = todayWork.due;
    const blockedItems = todayWork.blocked;

    const showToast = useCallback((message) => {
        setToast(message);
        window.setTimeout(() => setToast(''), 2600);
    }, []);

    const loadFromApi = useCallback(
        async (targetConfig) => {
            if (!targetConfig.apiUrl) return;
            setLoading(true);
            try {
                const data = await callAppsScript(targetConfig, {action: 'listProcesses'});
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
            const nextConfig = saved || {apiUrl: '', sharedSecret: ''};
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
            await callAppsScript(config, {action: 'upsertProcess', process: cleaned});
            if (event) {
                await callAppsScript(config, {action: 'appendEvent', processId: cleaned.id, event});
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
        if (draft.workState === 'paused' || draft.workState === 'lost') {
            const action = draft.workState === 'paused' ? 'pause' : 'lost';
            const errors = validateStateAction({action, reason: draft.statusReason, note: draft.statusNote});
            if (Object.keys(errors).length) {
                showToast(errors.reason || errors.note);
                return;
            }
        }
        const isNew = !processes.some((process) => process.id === draft.id);
        const process = cleanProcess(draft);
        const pendingEvent = draft.pendingEvent
            ? {
                ...draft.pendingEvent,
                processId: process.id,
                hiringStage: process.hiringStage,
                workState: process.workState
            }
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
        setImportState((state) => ({...state, loading: true, result: null, diagnostic: null, warnings: []}));
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
                result: {processDraft, eventDraft: data.eventDraft || null, confidence: data.confidence || 'low'},
                diagnostic: data.diagnosticSummary ? normalizeDiagnostic(data.diagnosticSummary) : null,
                warnings: data.warnings || [],
            }));
            setDraft({...processDraft, pendingEvent: data.eventDraft || null});
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
            const data = await callAppsScript(config, {
                action: 'syncCalendar',
                processId: process.id,
                process: cleanProcess(process)
            });
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
                <EmptyState icon={Loader2} title="Загрузка..." text="Поднимаю настройки треккера." spin/>
            </Shell>
        );
    }

    return (
        <Shell>
            <Header stats={stats} loading={loading} onReload={() => reload()}/>

            {!config.apiUrl && (
                <Notice
                    tone="warning"
                    title="Нужен Apps Script Web App URL"
                    text="Google Sheet будет базой данных. Добавь URL в настройках, после деплоя backend скрипта."
                    actionLabel="Открыть настройки"
                    onAction={() => setView('settings')}
                />
            )}

            <Nav view={view} setView={setView}/>

            <main className="app-main px-4 pb-28 sm:px-6">
                {view === 'today' && (
                    <TodayView
                        items={todayItems}
                        blockedItems={blockedItems}
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
                {view === 'stats' && (
                    <StatsView
                        processes={processes}
                        events={events}
                        eventsByProcess={eventsByProcess}
                        todayItems={todayItems}
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
                {view === 'settings' && (
                    <SettingsView
                        config={config}
                        onSave={saveConfig}
                        loading={loading}
                        onRetry={(diagnostic) => {
                            setImportState((current) => ({
                                ...current,
                                sourceType: diagnostic.sourceType || 'linkedin',
                                url: diagnostic.sourceUrl || '',
                                rawText: '',
                            }));
                            setView('import');
                        }}
                    />
                )}
            </main>

            {view !== 'settings' && (
                <button
                    onClick={() => setDraft(emptyProcess())}
                    className="fab fixed bottom-5 right-5 flex items-center justify-center shadow-lg"
                    style={{width: 52, height: 52, background: '#E8A33D', color: '#16191F', borderRadius: 6}}
                    title="Добавить hiring process"
                >
                    <Plus size={23}/>
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
                    style={{zIndex: 80, background: '#EDEEF0', color: '#16191F', borderRadius: 6}}
                >
                    {toast}
                </div>
            )}
        </Shell>
    );
}

function Shell({children}) {
    return (
        <div className="app-shell" style={{background: '#15181E', color: '#EDEEF0'}}>
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

function Header({stats, loading, onReload}) {
    return (
        <header className="app-header px-4 pt-5 pb-4 sm:px-6" style={{borderBottom: '1px solid #2B303B'}}>
            <div className="app-header-bar flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="app-title font-display text-2xl font-semibold">Recruiting Pipeline</h1>
                    <p className="font-mono mt-1 text-xs" style={{color: '#8B92A0'}}>
                        {stats.active} активных · {stats.blocked} блокеров · {stats.action} требуют действия
                        · {stats.waiting} ждут · {stats.offers} офферов
                    </p>
                </div>
                <button
                    onClick={onReload}
                    className="flex items-center gap-2 px-3 py-2 font-mono text-xs"
                    style={{border: '1px solid #2B303B', color: '#8B92A0', borderRadius: 5}}
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
                    Sync
                </button>
            </div>
        </header>
    );
}

function Nav({view, setView}) {
    const items = [
        ['today', 'Дела', Clock],
        ['funnel', 'Воронка', Briefcase],
        ['stats', 'Статистика', BarChart3],
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
                    <Icon size={14}/>
                    {label}
                </button>
            ))}
        </nav>
    );
}

function Notice({tone, title, text, actionLabel, onAction}) {
    const color = tone === 'warning' ? '#E8A33D' : '#4FB3BF';
    return (
        <div className="mx-4 mt-4 p-3 sm:mx-6" style={{border: `1px solid ${color}`, background: '#1E222B'}}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="font-mono text-xs font-semibold" style={{color}}>
                        {title}
                    </div>
                    <p className="font-mono mt-1 text-xs" style={{color: '#AAB0BC'}}>
                        {text}
                    </p>
                </div>
                {actionLabel && (
                    <button onClick={onAction} className="px-2 py-1 font-mono text-xs"
                            style={{color, border: `1px solid ${color}`}}>
                        {actionLabel}
                    </button>
                )}
            </div>
        </div>
    );
}

function TodayView({items, blockedItems, processes, eventsByProcess, onOpen, onAdd}) {
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
            <SectionTitle title="Блокеры" count={blockedItems.length} color="#E8A33D"/>
            {blockedItems.length === 0 ? (
                <InlineEmpty text="Нет препятствий, которые мешают следующему действию."/>
            ) : (
                <div className="blocker-list">
                    {blockedItems.map((process) => (
                        <BlockerRow key={process.id} process={process} onOpen={onOpen}/>
                    ))}
                </div>
            )}

            <SectionTitle title="Сегодня и просрочено" count={items.length} color="#E8A33D"/>
            {items.length === 0 ? (
                <InlineEmpty text="На сегодня нет обязательных действий."/>
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

            <SectionTitle title="Риски и паузы" count={riskItems.length} color="#C56B5D"/>
            {riskItems.length === 0 ? (
                <InlineEmpty text="Нет процессов на паузе или в отвале."/>
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

function StatsView({processes, events, eventsByProcess, todayItems, onOpen, onAdd}) {
    if (processes.length === 0) {
        return (
            <EmptyState
                icon={BarChart3}
                title="Статистика пустая"
                text="Добавь несколько процессов, и тут появятся срезы по воронке, состояниям и активности."
                actionLabel="Добавить процесс"
                onAction={onAdd}
            />
        );
    }

    const total = processes.length;
    const activeItems = processes.filter((process) => ACTIVE_WORK_STATES.includes(process.workState));
    const lostItems = processes.filter((process) => process.workState === 'lost');
    const pausedItems = processes.filter((process) => process.workState === 'paused');
    const blockedItems = processes.filter((process) => ['active', 'waiting', 'action_required', 'offer_received'].includes(process.workState) && isProcessBlocked(process));
    const offerItems = processes.filter((process) => process.workState.startsWith('offer'));
    const acceptedOffers = processes.filter((process) => process.workState === 'offer_accepted').length;
    const overdueItems = todayItems.filter((process) => normalizeDateOnly(process.nextActionDate) < todayISO());
    const recentActivity = getRecentActivityBuckets(events);
    const maxActivity = Math.max(1, ...recentActivity.map((item) => item.count));

    const stageRows = HIRING_STAGE_ORDER.map((stageKey) => {
        const count = processes.filter((process) => process.hiringStage === stageKey).length;
        const active = processes.filter(
            (process) => process.hiringStage === stageKey && ACTIVE_WORK_STATES.includes(process.workState)
        ).length;
        return {
            key: stageKey,
            label: HIRING_STAGES[stageKey].label,
            count,
            active,
            color: HIRING_STAGES[stageKey].color
        };
    });
    const agingRows = HIRING_STAGE_ORDER.map((stageKey) => {
        const stageItems = activeItems.filter((process) => process.hiringStage === stageKey);
        const idleDays = stageItems.map((process) => daysBetween(getLastActivityDate(process, eventsByProcess) || process.createdAt));
        const totalIdle = idleDays.reduce((sum, value) => sum + value, 0);
        const avgDays = idleDays.length ? Math.round(totalIdle / idleDays.length) : 0;
        const maxDays = idleDays.length ? Math.max(...idleDays) : 0;
        return {
            key: stageKey,
            label: HIRING_STAGES[stageKey].label,
            count: stageItems.length,
            avgDays,
            maxDays,
            color: HIRING_STAGES[stageKey].color,
        };
    });

    const stateCounts = countBy(processes, (process) => process.workState);
    const stateRows = WORK_STATE_FILTER_ORDER.filter((state) => stateCounts.has(state)).map((state) => ({
        key: state,
        label: WORK_STATES[state]?.label || state,
        count: stateCounts.get(state) || 0,
        color: WORK_STATES[state]?.color || '#8B92A0',
    }));

    const reasonCounts = countBy(lostItems, (process) => process.statusReason || 'other');
    const reasonRows = [...reasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({
            key: reason,
            label: STATUS_REASONS[reason] || reason,
            count,
            color: STATUS_REASON_COLORS[reason] || STATUS_REASON_COLORS.other,
        }));

    const sourceCounts = countBy(processes, (process) => process.sourceType || 'manual');
    const sourceRows = [...sourceCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([source, count]) => ({
            key: source,
            label: SOURCE_TYPES[source] || source,
            count,
            color: source === 'linkedin' ? '#4FB3BF' : source === 'djinni' ? '#6E88D8' : '#8B92A0',
        }));

    const staleItems = activeItems
        .map((process) => {
            const lastActivity = getLastActivityDate(process, eventsByProcess);
            const daysIdle = daysBetween(lastActivity || process.createdAt);
            const actionDate = normalizeDateOnly(process.nextActionDate);
            const overdue = actionDate && actionDate < todayISO();
            return {process, lastActivity, daysIdle, overdue};
        })
        .filter((item) => item.overdue || item.daysIdle >= 7)
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.daysIdle - a.daysIdle)
        .slice(0, 5);

    const agingMax = Math.max(1, ...agingRows.map((row) => row.avgDays));

    return (
        <div className="stats-view pt-4">
            <div className="stats-kpi-grid">
                <StatsKpi label="В работе" value={activeItems.length}
                          detail={`${Math.round((activeItems.length / total) * 100)}% пайплайна`} color="#4FB3BF"
                          icon={Activity}/>
                <StatsKpi label="Требуют внимания" value={todayItems.length + blockedItems.length}
                          detail={`${blockedItems.length} блокеров · ${overdueItems.length} просрочено`} color="#E8A33D"
                          icon={AlertTriangle}/>
                <StatsKpi label="Офферы" value={offerItems.length} detail={`${acceptedOffers} принято`} color="#6FAE8A"
                          icon={Briefcase}/>
                <StatsKpi label="Пауза / отвал" value={pausedItems.length + lostItems.length}
                          detail={`${lostItems.length} отвалилось`} color="#C56B5D" icon={Clock}/>
            </div>

            <div className="stats-layout">
                <section className="stats-panel stats-panel-wide stats-panel-focus">
                    <StatsPanelHeader title="Воронка по этапам" meta={`${total} процессов`}/>
                    <div className="stats-stage-list">
                        {stageRows.map((row) => (
                            <StatsSegmentedStageRow key={row.key} row={row}/>
                        ))}
                    </div>
                </section>

                <section className="stats-panel stats-panel-wide stats-panel-diagnostic">
                    <StatsPanelHeader title="Где застревает пайплайн" meta="средние дни без активности"/>
                    <div className="stats-bars">
                        {agingRows.map((row) => (
                            <StatsBarRow
                                key={row.key}
                                label={row.label}
                                count={row.avgDays}
                                max={agingMax}
                                color={row.color}
                                meta={row.count ? `${row.avgDays} дн. ср · ${row.maxDays} max` : 'нет активных'}
                                tone="quiet"
                            />
                        ))}
                    </div>
                </section>

                <section className="stats-panel stats-panel-composition">
                    <StatsPanelHeader title="Состояния" meta={`${activeItems.length} активных`}/>
                    <StatsCompositionChart rows={stateRows} total={total}/>
                </section>

                <section className="stats-panel">
                    <StatsPanelHeader title="Требуют внимания" meta={staleItems.length}/>
                    {staleItems.length === 0 ? (
                        <InlineEmpty text="Нет зависших или просроченных активных процессов."/>
                    ) : (
                        <div className="stats-watchlist">
                            {staleItems.map(({process, daysIdle, overdue}) => (
                                <button key={process.id} type="button" className="stats-watch-row"
                                        onClick={() => onOpen(process.id)}>
                                    <ProcessIdentity process={process}/>
                                    <span className="font-mono text-xs"
                                          style={{color: overdue ? '#C56B5D' : '#8B92A0'}}>
                    {overdue ? 'просрочено' : `${daysIdle} дн.`}
                  </span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <section className="stats-panel stats-panel-composition">
                    <StatsPanelHeader title="Причины отвалов" meta={lostItems.length}/>
                    {reasonRows.length === 0 ? (
                        <InlineEmpty text="Пока нет процессов в отвале."/>
                    ) : (
                        <StatsCompositionChart rows={reasonRows} total={lostItems.length}/>
                    )}
                </section>

                <section className="stats-panel stats-panel-composition">
                    <StatsPanelHeader title="Источники" meta={sourceRows.length}/>
                    <StatsCompositionChart rows={sourceRows} total={total}/>
                </section>

                <section className="stats-panel stats-panel-wide stats-panel-activity">
                    <StatsPanelHeader title="Активность за 14 дней" meta={`${events.length} событий`}/>
                    <div className="stats-activity-bars" aria-label="Активность за последние 14 дней">
                        {recentActivity.map((item) => (
                            <div key={item.date} className="stats-activity-day"
                                 title={`${fmtDate(item.date)}: ${item.count}`}>
                <span
                    style={{
                        height: item.count ? `${Math.max(8, (item.count / maxActivity) * 100)}%` : '0%',
                        minHeight: item.count ? 8 : 0,
                    }}
                />
                                <small>{fmtDate(item.date).replace('.', '')}</small>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}

function StatsKpi({label, value, detail, color, icon: Icon}) {
    return (
        <div className="stats-kpi" style={{'--stats-color': color}}>
            <div className="stats-kpi-top">
                <span className="font-mono text-xs">{label}</span>
                <Icon size={16}/>
            </div>
            <div className="font-display stats-kpi-value">{value}</div>
            <div className="font-mono stats-kpi-detail">{detail}</div>
        </div>
    );
}

function StatsPanelHeader({title, meta}) {
    return (
        <div className="stats-panel-head">
            <h2 className="font-display text-sm font-semibold">{title}</h2>
            <span className="font-mono text-xs">{meta}</span>
        </div>
    );
}

function StatsSegmentedStageRow({row}) {
    const inactive = Math.max(0, row.count - row.active);
    const hint = `${row.label}: всего ${row.count}, активных ${row.active}, неактивных ${inactive}`;
    const segments = Array.from({length: row.count});

    return (
        <div className="stats-stage-row" title={hint}>
            <div className="stats-stage-row-head">
                <span className="font-mono text-xs">{row.label}</span>
                <span className="font-mono text-xs">
          {row.active}/{row.count} активных
        </span>
            </div>
            <div className="stats-segmented-track" role="img" aria-label={hint}>
                {segments.length === 0 ? (
                    <span className="stats-segment-empty"/>
                ) : (
                    segments.map((_, index) => (
                        <span
                            key={index}
                            className={`stats-segment ${index < row.active ? 'is-active' : 'is-inactive'}`}
                            style={{'--segment-color': row.color}}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

function StatsCompositionChart({rows, total}) {
    const visibleRows = rows.filter((row) => row.count > 0);
    const safeTotal = Math.max(1, total || visibleRows.reduce((sum, row) => sum + row.count, 0));

    if (visibleRows.length === 0) {
        return <InlineEmpty text="Нет данных для среза."/>;
    }

    return (
        <div className="stats-composition">
            <div className="stats-composition-track" role="img" aria-label="Распределение процессов">
                {visibleRows.map((row) => {
                    const width = Math.max(4, (row.count / safeTotal) * 100);
                    return (
                        <span
                            key={row.key}
                            title={`${row.label}: ${row.count}`}
                            style={{width: `${width}%`, '--composition-color': row.color}}
                        />
                    );
                })}
            </div>
            <div className="stats-composition-legend">
                {visibleRows.map((row) => {
                    const percent = Math.round((row.count / safeTotal) * 100);
                    return (
                        <div key={row.key} className="stats-composition-item">
                            <span style={{'--composition-color': row.color}}/>
                            <strong className="font-mono text-xs">{row.label}</strong>
                            <em className="font-mono text-xs">
                                {row.count} · {percent}%
                            </em>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function StatsBarRow({label, count, max, color, meta, tone = 'default'}) {
    const width = count && max ? Math.max(4, Math.round((count / max) * 100)) : 0;
    return (
        <div className={`stats-bar-row ${tone === 'quiet' ? 'is-quiet' : ''}`}>
            <div className="stats-bar-label">
                <span className="font-mono text-xs">{label}</span>
                <span className="font-mono text-xs">{meta || count}</span>
            </div>
            <div className="stats-bar-track" aria-hidden="true">
                <span style={{width: `${width}%`, minWidth: count ? 4 : 0, background: color}}/>
            </div>
        </div>
    );
}

function FunnelView({processes, eventsByProcess, onOpen, onAdd}) {
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
            style={{'--stage-color': stage.color}}
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
                <InlineEmpty text="Нет процессов на этом этапе."/>
            ) : (
                <>
                    <div className="stage-folder-preview" aria-hidden={isOpen ? 'true' : undefined}>
                        <div className="stage-folder-card-stack">
                            {previewItems.map((process, index) => (
                                <div key={process.id} className="stage-folder-preview-item"
                                     style={{'--stack-index': index}}>
                                    <ProcessCard
                                        process={process}
                                        lastEvent={(eventsByProcess.get(process.id) || [])[0]}
                                        onOpen={onOpen}
                                    />
                                </div>
                            ))}
                        </div>
                        {hiddenCount > 0 && (
                            <button type="button" className="stage-folder-more font-mono text-xs" onClick={onToggle}
                                    tabIndex={isOpen ? -1 : 0}>
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
                                <InlineEmpty text="Нет процессов с этим состоянием."/>
                            ) : (
                                <div className="stage-folder-list scroll-thin" style={{overscrollBehavior: 'contain'}}>
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

function ImportView({state, setState, onImport, disabled}) {
    const set = (key, value) => setState((current) => ({...current, [key]: value}));
    return (
        <div className="pt-4">
            <div className="max-w-2xl p-4" style={{background: '#1E222B', border: '1px solid #2B303B'}}>
                <div className="flex items-center gap-2">
                    <Sparkles size={18} style={{color: '#E8A33D'}}/>
                    <h2 className="font-display text-lg font-semibold">Импорт источника</h2>
                </div>
                <p className="font-mono mt-1 text-xs" style={{color: '#8B92A0'}}>
                    LinkedIn уходит в Apps Script + Apify. Djinni разбирается из URL или вставленного текста без
                    логин-скрейпинга.
                </p>

                <label className="mt-4 block font-mono text-xs" style={{color: '#8B92A0'}}>
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
                    <div className="mt-3 p-3 font-mono text-xs" style={{border: '1px solid #C56B5D', color: '#E6A49B'}}>
                        {state.warnings.map((warning) => (
                            <div key={warning}>{warning}</div>
                        ))}
                    </div>
                )}

                {state.diagnostic && <ImportDiagnosticSummary diagnostic={state.diagnostic}/>}

                <button
                    onClick={onImport}
                    disabled={disabled || state.loading || (!state.url.trim() && !state.rawText.trim())}
                    className="mt-4 flex w-full items-center justify-center gap-2 py-2.5 font-mono text-xs"
                    style={{background: '#EDEEF0', color: '#16191F'}}
                >
                    {state.loading ? <Loader2 size={14} className="animate-spin"/> : <Search size={14}/>}
                    Создать черновик
                </button>
            </div>
        </div>
    );
}

function ImportDiagnosticSummary({diagnostic}) {
    const status = DIAGNOSTIC_STATUS[diagnostic.outcome] || DIAGNOSTIC_STATUS.failed;
    return (
        <div className="diagnostic-summary mt-3 p-3" style={{border: `1px solid ${status.color}`}}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    {diagnostic.outcome === 'success' ? <CircleCheck size={16} style={{color: status.color}}/> :
                        <CircleAlert size={16} style={{color: status.color}}/>}
                    <div>
                        <div className="font-mono text-xs font-semibold"
                             style={{color: status.color}}>{status.label}</div>
                        <p className="mt-1 font-mono text-xs" style={{color: '#AAB0BC'}}>{diagnostic.message}</p>
                    </div>
                </div>
                <span className="font-mono text-xs" style={{color: '#666D7A'}}>{diagnostic.durationMs} ms</span>
            </div>
            <div className="mt-2 font-mono text-xs" style={{color: '#666D7A'}}>
                {diagnostic.provider} · {diagnostic.reasonCode} · ID {diagnostic.shortRequestId}
            </div>
        </div>
    );
}

function SettingsView({config, onSave, loading, onRetry}) {
    const [local, setLocal] = useState(config);
    const [tab, setTab] = useState('connection');
    const [diagnostics, setDiagnostics] = useState([]);
    const [diagnosticFilter, setDiagnosticFilter] = useState('problems');
    const [expandedId, setExpandedId] = useState('');
    const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
    const [diagnosticsError, setDiagnosticsError] = useState('');

    const loadDiagnostics = useCallback(async () => {
        if (!config.apiUrl) return;
        setDiagnosticsLoading(true);
        setDiagnosticsError('');
        try {
            const data = await callAppsScript(config, {action: 'listDiagnostics', limit: 50});
            setDiagnostics((data.diagnostics || []).map(normalizeDiagnostic));
        } catch (error) {
            setDiagnosticsError(error.message);
        } finally {
            setDiagnosticsLoading(false);
        }
    }, [config]);

    const clearDiagnostics = async () => {
        if (!window.confirm('Удалить историю диагностики?')) return;
        setDiagnosticsLoading(true);
        try {
            await callAppsScript(config, {action: 'clearDiagnostics'});
            setDiagnostics([]);
            setExpandedId('');
        } catch (error) {
            setDiagnosticsError(error.message);
        } finally {
            setDiagnosticsLoading(false);
        }
    };

    const visibleDiagnostics = filterDiagnostics(diagnostics, diagnosticFilter);

    return (
        <div className="pt-4">
            <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Раздел API">
                <button type="button" role="tab" aria-selected={tab === 'connection'}
                        onClick={() => setTab('connection')} className="px-3 py-2 font-mono text-xs"
                        style={tab === 'connection' ? primaryButtonStyle : secondaryButtonStyle}>Подключение
                </button>
                <button type="button" role="tab" aria-selected={tab === 'diagnostics'} onClick={() => {
                    setTab('diagnostics');
                    loadDiagnostics();
                }} className="px-3 py-2 font-mono text-xs"
                        style={tab === 'diagnostics' ? primaryButtonStyle : secondaryButtonStyle}>Диагностика
                </button>
            </div>

            {tab === 'connection' ? (
                <div className="max-w-2xl p-4 mt-3" style={{background: '#1E222B', border: '1px solid #2B303B'}}>
                    <div className="flex items-center gap-2">
                        <Settings size={18} style={{color: '#4FB3BF'}}/>
                        <h2 className="font-display text-lg font-semibold">Apps Script API</h2>
                    </div>
                    <p className="font-mono mt-1 text-xs" style={{color: '#8B92A0'}}>
                        Вставь Web App URL деплоймента. Shared secret опционален, но лучше включить его в Script
                        Properties.
                    </p>

                    <Field label="Web App URL">
                        <input
                            value={local.apiUrl}
                            onChange={(event) => setLocal((current) => ({...current, apiUrl: event.target.value}))}
                            placeholder="https://script.google.com/macros/s/.../exec"
                            className="w-full p-2 font-mono text-sm"
                            style={inputStyle}
                        />
                    </Field>

                    <Field label="Shared secret">
                        <input
                            value={local.sharedSecret}
                            onChange={(event) => setLocal((current) => ({
                                ...current,
                                sharedSecret: event.target.value
                            }))}
                            placeholder="тот же SHARED_SECRET, если задан в Apps Script"
                            className="w-full p-2 font-mono text-sm"
                            style={inputStyle}
                        />
                    </Field>

                    <button
                        onClick={() => onSave(local)}
                        disabled={loading}
                        className="mt-4 flex w-full items-center justify-center gap-2 py-2.5 font-mono text-xs"
                        style={{background: '#EDEEF0', color: '#16191F'}}
                    >
                        {loading ? <Loader2 size={14} className="animate-spin"/> : <Check size={14}/>}
                        Сохранить и синхронизировать
                    </button>
                </div>
            ) : (
                <section className="diagnostics-panel max-w-3xl p-4 mt-3"
                         style={{background: '#1E222B', border: '1px solid #2B303B'}}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="flex items-center gap-2"><Activity size={18} style={{color: '#4FB3BF'}}/><h2
                                className="font-display text-lg font-semibold">Журнал импорта</h2></div>
                            <p className="mt-1 font-mono text-xs" style={{color: '#8B92A0'}}>Показывает точный этап,
                                провайдера и безопасные детали без токенов и raw HTML.</p>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={loadDiagnostics}
                                    disabled={diagnosticsLoading || !config.apiUrl} className="diagnostic-icon-button"
                                    title="Обновить"><RefreshCw size={15}
                                                                className={diagnosticsLoading ? 'animate-spin' : ''}/>
                            </button>
                            <button type="button" onClick={clearDiagnostics}
                                    disabled={diagnosticsLoading || diagnostics.length === 0}
                                    className="diagnostic-icon-button diagnostic-icon-danger" title="Очистить журнал">
                                <Trash2 size={15}/></button>
                        </div>
                    </div>

                    <Segmented value={diagnosticFilter} onChange={setDiagnosticFilter}
                               items={[["problems", "Проблемы"], ["all", "Все"], ["success", "Успешные"]]}/>
                    {diagnosticsError && <div className="mt-3 p-3 font-mono text-xs" role="status" style={{
                        border: '1px solid #C56B5D',
                        color: '#E6A49B'
                    }}>{diagnosticsError}</div>}
                    {!config.apiUrl ? <InlineEmpty
                        text="Сначала добавь Web App URL во вкладке «Подключение»."/> : diagnosticsLoading && diagnostics.length === 0 ?
                        <InlineEmpty text="Загружаю журнал…"/> : visibleDiagnostics.length === 0 ?
                            <InlineEmpty text="Для этого фильтра записей нет."/> : (
                                <div className="diagnostic-list mt-3">
                                    {visibleDiagnostics.map((diagnostic) => (
                                        <DiagnosticCard
                                            key={diagnostic.requestId}
                                            diagnostic={diagnostic}
                                            expanded={expandedId === diagnostic.requestId}
                                            onToggle={() => setExpandedId((current) => current === diagnostic.requestId ? '' : diagnostic.requestId)}
                                            onRetry={() => onRetry(diagnostic)}
                                        />
                                    ))}
                                </div>
                            )}
                </section>
            )}
        </div>
    );
}

function DiagnosticCard({diagnostic, expanded, onToggle, onRetry}) {
    const status = DIAGNOSTIC_STATUS[diagnostic.outcome] || DIAGNOSTIC_STATUS.failed;
    const copyReport = async () => {
        await navigator.clipboard.writeText(formatDiagnosticReport(diagnostic));
    };
    return (
        <article className="diagnostic-card" style={{'--diagnostic-color': status.color}}>
            <button type="button" className="diagnostic-card-summary" onClick={onToggle} aria-expanded={expanded}>
                <span className="diagnostic-status-dot" aria-hidden="true"/>
                <span className="min-w-0 text-left">
          <span className="block font-mono text-xs font-semibold"
                style={{color: status.color}}>{status.label} · {diagnostic.provider}</span>
          <span className="diagnostic-message mt-1 block truncate font-mono text-xs">{diagnostic.message}</span>
          <span className="mt-1 block font-mono text-xs"
                style={{color: '#666D7A'}}>{maskDiagnosticUrl(diagnostic.sourceUrl)} · {fmtDateTime(diagnostic.completedAt || diagnostic.startedAt)}</span>
        </span>
                <span className="text-right font-mono text-xs"
                      style={{color: '#666D7A'}}>{diagnostic.durationMs} ms<br/>{expanded ? <ChevronDown size={15}/> :
                    <ChevronRight size={15}/>}</span>
            </button>
            {expanded && (
                <div className="diagnostic-details">
                    <div className="diagnostic-facts font-mono text-xs">
                        <span><b>Код</b>{diagnostic.reasonCode}</span><span><b>Этап сбоя</b>{DIAGNOSTIC_STAGE_LABELS[diagnostic.failedStage] || diagnostic.failedStage || '—'}</span><span><b>Request ID</b>{diagnostic.requestId}</span>
                    </div>
                    {diagnostic.traceCorrupted &&
                        <div className="mt-3 font-mono text-xs" style={{color: '#E8A33D'}}>Trace повреждён, но итоговая
                            запись сохранена.</div>}
                    <ol className="diagnostic-trace mt-3">
                        {diagnostic.trace.map((entry, index) => (
                            <li key={`${entry.stage}-${entry.sequence || index}`}>
                                <span
                                    className={`diagnostic-trace-state diagnostic-trace-${entry.status || 'failed'}`}/>
                                <div>
                                    <div
                                        className="font-mono text-xs font-semibold">{DIAGNOSTIC_STAGE_LABELS[entry.stage] || entry.stage}</div>
                                    <div className="font-mono text-xs"
                                         style={{color: '#8B92A0'}}>{entry.message || entry.reasonCode}</div>
                                    {entry.details && Object.keys(entry.details).length > 0 &&
                                        <pre>{JSON.stringify(entry.details, null, 2)}</pre>}</div>
                            </li>
                        ))}
                    </ol>
                    <details className="diagnostic-json mt-3">
                        <summary className="font-mono text-xs">Безопасный JSON</summary>
                        <pre>{formatDiagnosticReport(diagnostic)}</pre>
                    </details>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={copyReport} className="px-3 py-2 font-mono text-xs"
                                style={secondaryButtonStyle}><span className="inline-flex items-center gap-1"><Copy
                            size={13}/> Копировать JSON</span></button>
                        {diagnostic.sourceUrl &&
                            <button type="button" onClick={onRetry} className="px-3 py-2 font-mono text-xs"
                                    style={secondaryButtonStyle}><span
                                className="inline-flex items-center gap-1"><RefreshCw
                                size={13}/> Повторить импорт</span></button>}
                    </div>
                </div>
            )}
        </article>
    );
}

function ProcessRow({process, lastEvent, onOpen}) {
    const actionDate = normalizeDateOnly(process.nextActionDate);
    const overdue = actionDate && actionDate < todayISO();
    return (
        <button
            onClick={() => onOpen(process.id)}
            className="process-row w-full py-3 text-left"
            style={{borderBottom: '1px solid #2B303B'}}
        >
            <div className="process-row-head flex items-center justify-between gap-3">
                <ProcessIdentity process={process}/>
                <div className="process-date flex-shrink-0 text-right font-mono text-xs"
                     style={{color: overdue ? '#C56B5D' : '#8B92A0'}}>
                    {fmtDate(process.nextActionDate)}
                    <div>{NEXT_ACTION_TYPES[process.nextActionType] || 'Действие'}</div>
                </div>
            </div>
            {lastEvent && (
                <div className="mt-1 truncate pl-4 font-mono text-xs" style={{color: '#666D7A'}}>
                    {EVENT_TYPES[lastEvent.type]?.label || lastEvent.type}: {lastEvent.note || 'без заметки'}
                </div>
            )}
        </button>
    );
}

function BlockerRow({process, onOpen}) {
    const reviewDate = normalizeDateOnly(process.blockerReviewDate);
    const overdue = reviewDate && reviewDate < todayISO();
    return (
        <button
            onClick={() => onOpen(process.id)}
            className="blocker-row w-full p-3 text-left"
            style={{border: '1px solid #6E5830', background: '#1E222B'}}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <ProcessIdentity process={process}/>
                    <div className="mt-2 flex items-center gap-2 pl-4 font-mono text-xs" style={{color: '#E8A33D'}}>
                        <AlertTriangle size={13}/>
                        <span>{BLOCKER_REASONS[process.blockerReason] || process.blockerReason}</span>
                    </div>
                    {process.blockerNote && <p className="mt-1 truncate pl-4 font-mono text-xs"
                                               style={{color: '#8B92A0'}}>{process.blockerNote}</p>}
                </div>
                <div className="flex-shrink-0 text-right font-mono text-xs"
                     style={{color: overdue ? '#C56B5D' : '#8B92A0'}}>
                    <div>{reviewDate ? fmtDate(reviewDate) : 'Без даты'}</div>
                    <div>{overdue ? 'проверить' : 'контроль'}</div>
                </div>
            </div>
        </button>
    );
}

function ProcessCard({process, lastEvent, onOpen}) {
    const vacancyRole = getVacancyRole(process);
    const hasVacancyMeta = vacancyRole || process.salary || process.location;

    return (
        <button
            onClick={() => onOpen(process.id)}
            className="process-card mb-2 w-full p-3 text-left"
            style={{background: '#1E222B', border: '1px solid #2B303B', borderRadius: 6}}
        >
            <div className="process-card-head flex items-start justify-between gap-3">
                <ProcessIdentity process={process}/>
                <div className="process-card-pills flex flex-wrap justify-end gap-1.5">
                    {isProcessBlocked(process) && <BlockerBadge process={process}/>}
                    <StatePill state={process.workState}/>
                </div>
            </div>
            {hasVacancyMeta && (
                <div className="process-vacancy-meta font-mono text-xs">
                    {vacancyRole && (
                        <span className="process-vacancy-meta-item process-vacancy-role">
              <Briefcase size={12}/>
                            {vacancyRole}
            </span>
                    )}
                    {process.salary && (
                        <span className="process-vacancy-meta-item process-vacancy-salary">
              <DollarSign size={12}/>
                            {process.salary}
            </span>
                    )}
                    {process.location && (
                        <span className="process-vacancy-meta-item">
              <MapPin size={12}/>
                            {process.location}
            </span>
                    )}
                </div>
            )}
            <div className="process-meta-row mt-3 flex items-center justify-between gap-3 font-mono text-xs"
                 style={{color: '#8B92A0'}}>
                <span
                    className="process-card-note">{process.nextActionNote || NEXT_ACTION_TYPES[process.nextActionType] || 'Нет действия'}</span>
                <span className="process-date">{fmtDate(process.nextActionDate)}</span>
            </div>
            {(process.statusReason || lastEvent) && (
                <div className="mt-2 truncate font-mono text-xs"
                     style={{color: process.workState === 'lost' ? '#C56B5D' : '#666D7A'}}>
                    {process.statusReason ? STATUS_REASONS[process.statusReason] : lastEvent?.note}
                </div>
            )}
        </button>
    );
}

function BlockerBadge({process, compact = false}) {
    return (
        <span className="blocker-badge inline-flex flex-shrink-0 items-center gap-1 px-2 py-1 font-mono text-xs"
              title={process.blockerNote || ''}>
      <AlertTriangle size={12}/>
            {compact ? 'Блокер' : BLOCKER_REASONS[process.blockerReason] || 'Блокер'}
    </span>
    );
}

function ProcessIdentity({process}) {
    const stage = HIRING_STAGES[process.hiringStage] || HIRING_STAGES.application;
    return (
        <div className="process-identity min-w-0">
            <div className="flex items-center gap-2">
                <span style={{width: 7, height: 7, background: stage.color, display: 'inline-block', flexShrink: 0}}/>
                <span
                    className="truncate font-mono text-sm">{process.title || process.role || process.companyName || 'Без названия'}</span>
            </div>
            <div className="process-identity-context mt-0.5 pl-4 font-mono text-xs" style={{color: '#8B92A0'}}>
                <span>{process.companyName || 'Компания не указана'}</span>
                <span aria-hidden="true">·</span>
                <span>{stage.short}</span>
            </div>
            {process.recruiterName && (
                <div className="process-identity-recruiter mt-1 pl-4 font-mono text-xs">
                    <UserRound size={12}/>
                    <span>{process.recruiterName}</span>
                </div>
            )}
        </div>
    );
}

function getVacancyRole(process) {
    const role = textValue(process.role).trim();
    const recruiterTitle = textValue(process.recruiterTitle).trim();
    return role && role.toLocaleLowerCase() !== recruiterTitle.toLocaleLowerCase() ? role : '';
}

function StatePill({state}) {
    const item = WORK_STATES[state] || WORK_STATES.active;
    return (
        <span className="state-pill flex-shrink-0 px-2 py-1 font-mono text-xs"
              style={{color: item.color, border: `1px solid ${item.color}`}}>
      {item.label}
    </span>
    );
}

function ProcessDrawer({process, events, saving, onClose, onEdit, onEvent, onSyncCalendar}) {
    const [eventDraft, setEventDraft] = useState({note: ''});
    const [stateAction, setStateAction] = useState('');
    const [stateDraft, setStateDraft] = useState({reason: '', note: '', reviewDate: addDays(todayISO(), 7)});
    const [stateErrors, setStateErrors] = useState({});
    const vacancyRole = getVacancyRole(process);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

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
            savedProcess = await onEvent(process, type, eventDraft.note || 'Получен ответ', {workState: 'active'});
        } else if (type === 'interview_scheduled') {
            savedProcess = await onEvent(process, type, eventDraft.note || 'Назначено интервью', {
                workState: 'active',
                nextActionType: 'interview',
                nextActionDate: process.nextActionDate || todayISO(),
                nextActionNote: process.nextActionNote || 'Подготовиться к интервью',
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
        setEventDraft({note: ''});
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
                ['offer_received', EVENT_TYPES.offer_received.label],
            ];

    const openStateAction = (action) => {
        setStateAction(action);
        setStateDraft({reason: '', note: '', reviewDate: addDays(todayISO(), 7)});
        setStateErrors({});
    };

    const submitStateAction = async () => {
        if (['blocker', 'pause', 'lost'].includes(stateAction)) {
            const errors = validateStateAction({action: stateAction, ...stateDraft});
            setStateErrors(errors);
            if (Object.keys(errors).length) return;
        }

        let savedProcess = null;
        if (stateAction === 'blocker') {
            savedProcess = await onEvent(process, 'blocker_added', stateDraft.note || BLOCKER_REASONS[stateDraft.reason], {
                blockerReason: stateDraft.reason,
                blockerNote: stateDraft.note,
                blockedAt: new Date().toISOString(),
                blockerReviewDate: stateDraft.reviewDate,
            });
        } else if (stateAction === 'resolve_blocker') {
            savedProcess = await onEvent(process, 'blocker_resolved', stateDraft.note || 'Блокер снят', {
                ...buildResolveBlockerPatch(process, todayISO()),
                eventBlockerReason: process.blockerReason,
            });
        } else if (stateAction === 'pause') {
            savedProcess = await onEvent(process, 'paused', stateDraft.note || PAUSE_REASONS[stateDraft.reason], {
                workState: 'paused',
                statusReason: stateDraft.reason,
                statusNote: stateDraft.note,
            });
        } else if (stateAction === 'lost') {
            savedProcess = await onEvent(process, 'lost', stateDraft.note || LOST_REASONS[stateDraft.reason], {
                workState: 'lost',
                statusReason: stateDraft.reason,
                statusNote: stateDraft.note,
                eventBlockerReason: process.blockerReason,
                blockerReason: '',
                blockerNote: '',
                blockedAt: '',
                blockerReviewDate: '',
            });
        } else if (stateAction === 'resume' || stateAction === 'reopen') {
            savedProcess = await onEvent(process, 'resumed', stateDraft.note || (stateAction === 'reopen' ? 'Процесс открыт снова' : 'Процесс возобновлён'), buildResumePatch(todayISO()));
        }
        if (savedProcess) {
            setStateAction('');
            setStateErrors({});
        }
    };

    const stateReasonOptions = stateAction === 'blocker'
        ? getBlockerReasonOptions(process.sourceType)
        : Object.entries(stateAction === 'pause' ? PAUSE_REASONS : LOST_REASONS).map(([key, label]) => ({key, label}));

    return (
        <div className="drawer-backdrop fixed inset-0 flex justify-end"
             style={{zIndex: 60, background: 'rgba(0,0,0,0.55)'}}>
            <aside className="drawer-panel scroll-thin h-full w-full  max-w-2xl overflow-y-auto p-5"
                   style={{background: '#1A1E26', overscrollBehavior: 'contain', borderLeft: '1px solid #2B303B'}}>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="font-display text-xl font-semibold">{process.title || process.companyName || 'Hiring process'}</h2>
                        <p className="font-mono mt-1 text-xs" style={{color: '#8B92A0'}}>
                            {process.companyName || 'Компания не указана'} · {HIRING_STAGES[process.hiringStage]?.label}
                        </p>
                    </div>
                    <button onClick={onClose} title="Закрыть">
                        <X size={20} style={{color: '#8B92A0'}}/>
                    </button>
                </div>

                <div className="drawer-info-grid mt-4 grid gap-2 sm:grid-cols-2">
                    <InfoLine icon={Briefcase} label="Вакансия / позиция" value={vacancyRole || 'Не указана'} wide/>
                    <InfoLine icon={Building2} label="Компания / клиент" value={process.companyName || 'Не указана'}/>
                    <InfoLine
                        icon={UserRound}
                        label="Рекрутер"
                        value={process.recruiterName || 'Не указан'}
                        secondary={process.recruiterTitle}
                    />
                    {process.salary && <InfoLine icon={DollarSign} label="Компенсация" value={process.salary} accent/>}
                    {process.location && <InfoLine icon={MapPin} label="Локация" value={process.location}/>}
                    <InfoLine icon={Clock} label="Следующее действие"
                              value={`${fmtDate(process.nextActionDate)} · ${process.nextActionNote || NEXT_ACTION_TYPES[process.nextActionType]}`}
                              wide/>
                    <InfoLine icon={AlertTriangle} label="Состояние"
                              value={WORK_STATES[process.workState]?.label || process.workState}/>
                    <InfoLine icon={CalendarDays} label="Calendar"
                              value={process.calendarEventId ? 'Синхронизирован' : 'Не синхронизирован'}/>
                </div>

                {process.sourceRawText && (
                    <section className="vacancy-details mt-4">
                        <div className="vacancy-details-head">
                            <FileText size={14}/>
                            <span>Описание / исходный текст вакансии</span>
                        </div>
                        <div
                            className="vacancy-details-text scroll-thin font-mono text-xs">{process.sourceRawText}</div>
                    </section>
                )}

                {process.sourceUrl && (
                    <a
                        href={process.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 flex items-center gap-2 font-mono text-xs"
                        style={{color: '#4FB3BF'}}
                    >
                        <ExternalLink size={14}/>
                        {SOURCE_TYPES[process.sourceType] || process.sourceType}: {process.sourceUrl}
                    </a>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                    <button onClick={onEdit} className="px-3 py-2 font-mono text-xs" style={secondaryButtonStyle}>
                        Редактировать
                    </button>
                    <button onClick={() => onSyncCalendar(process)} disabled={saving}
                            className="px-3 py-2 font-mono text-xs" style={secondaryButtonStyle}>
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14}/> {process.calendarEventId ? 'Update Calendar' : 'Sync Calendar'}
            </span>
                    </button>
                </div>

                {isProcessBlocked(process) && (
                    <section className="active-blocker mt-5 p-3" aria-label="Активный блокер">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 font-display text-sm font-semibold"
                                     style={{color: '#E8A33D'}}><AlertTriangle size={15}/>Активный блокер
                                </div>
                                <p className="mt-2 font-mono text-sm">{BLOCKER_REASONS[process.blockerReason] || process.blockerReason}</p>
                                {process.blockerNote && <p className="mt-1 font-mono text-xs"
                                                           style={{color: '#AAB0BC'}}>{process.blockerNote}</p>}
                                <p className="mt-2 font-mono text-xs"
                                   style={{color: '#666D7A'}}>Проверить: {process.blockerReviewDate ? fmtDate(process.blockerReviewDate) : 'дата не задана'}</p>
                            </div>
                            <button type="button" onClick={() => openStateAction('resolve_blocker')}
                                    className="px-3 py-2 font-mono text-xs" style={secondaryButtonStyle}>Снять блокер
                            </button>
                        </div>
                    </section>
                )}

                <div className="mt-5 p-3" style={{background: '#15181E', border: '1px solid #2B303B'}}>
                    <div className="font-display text-sm font-semibold">Коммуникация</div>
                    <p className="mt-1 font-mono text-xs" style={{color: '#666D7A'}}>Фиксирует уже случившееся действие
                        и автоматически назначает следующий шаг.</p>
                    <Field label="Заметка">
                        <input
                            value={eventDraft.note}
                            onChange={(event) => setEventDraft({note: event.target.value})}
                            placeholder="например: отправил follow-up в LinkedIn"
                            className="w-full p-2 font-mono text-sm"
                            style={inputStyle}
                        />
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

                <div className="mt-3 p-3" style={{background: '#15181E', border: '1px solid #2B303B'}}>
                    <div className="font-display text-sm font-semibold">Состояние процесса</div>
                    <p className="mt-1 font-mono text-xs" style={{color: '#666D7A'}}>Блокер не меняет этап; пауза
                        откладывает работу; завершение закрывает текущую возможность.</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {!isProcessBlocked(process) && !['lost', 'offer_accepted', 'offer_declined'].includes(process.workState) &&
                            <button type="button" onClick={() => openStateAction('blocker')}
                                    className="py-2 font-mono text-xs" style={secondaryButtonStyle}>Добавить
                                блокер</button>}
                        {process.workState === 'paused' ?
                            <button type="button" onClick={() => openStateAction('resume')}
                                    className="py-2 font-mono text-xs"
                                    style={secondaryButtonStyle}>Возобновить</button> : process.workState !== 'lost' &&
                            <button type="button" onClick={() => openStateAction('pause')}
                                    className="py-2 font-mono text-xs" style={secondaryButtonStyle}>Поставить на
                                паузу</button>}
                        {process.workState === 'lost' ? <button type="button" onClick={() => openStateAction('reopen')}
                                                                className="py-2 font-mono text-xs"
                                                                style={secondaryButtonStyle}>Открыть снова</button> :
                            <button type="button" onClick={() => openStateAction('lost')}
                                    className="py-2 font-mono text-xs" style={secondaryButtonStyle}>Завершить
                                процесс</button>}
                    </div>

                    {stateAction && (
                        <StateActionForm
                            action={stateAction}
                            draft={stateDraft}
                            setDraft={setStateDraft}
                            errors={stateErrors}
                            reasonOptions={stateReasonOptions}
                            saving={saving}
                            onCancel={() => {
                                setStateAction('');
                                setStateErrors({});
                            }}
                            onSubmit={submitStateAction}
                        />
                    )}
                </div>

                <div className="mt-5">
                    <SectionTitle title="История событий" count={events.length} color="#4FB3BF"/>
                    {events.length === 0 ? (
                        <InlineEmpty text="Пока нет событий."/>
                    ) : (
                        <div className="event-timeline" aria-label="История событий">
                            {events.map((event) => (
                                <EventItem key={event.id} event={event}/>
                            ))}
                        </div>
                    )}
                </div>
            </aside>
        </div>
    );
}

function StateActionForm({action, draft, setDraft, errors, reasonOptions, saving, onCancel, onSubmit}) {
    const requiresReason = ['blocker', 'pause', 'lost'].includes(action);
    const labels = {
        blocker: ['Новый блокер', 'Поставить блокер'],
        resolve_blocker: ['Снять блокер', 'Снять блокер'],
        pause: ['Пауза', 'Поставить на паузу'],
        lost: ['Завершение процесса', 'Завершить процесс'],
        resume: ['Возобновление', 'Возобновить'],
        reopen: ['Повторное открытие', 'Открыть снова'],
    };
    const [title, submitLabel] = labels[action] || [action, 'Сохранить'];
    const set = (key, value) => setDraft((current) => ({...current, [key]: value}));

    return (
        <div className="state-action-form mt-3 p-3">
            <div className="font-display text-sm font-semibold">{title}</div>
            {action === 'blocker' &&
                <p className="mt-1 font-mono text-xs" style={{color: '#8B92A0'}}>Этап и текущее состояние не изменятся.
                    Процесс появится в отдельном списке блокеров.</p>}
            {requiresReason && (
                <label className="mt-3 block" htmlFor={`state-reason-${action}`}>
                    <span className="font-mono text-xs" style={{color: '#8B92A0'}}>Причина *</span>
                    <select id={`state-reason-${action}`} value={draft.reason}
                            onChange={(event) => set('reason', event.target.value)}
                            aria-invalid={Boolean(errors.reason)}
                            aria-describedby={errors.reason ? `state-reason-error-${action}` : undefined}
                            className="mt-1 w-full p-2 font-mono text-sm" style={inputStyle}>
                        <option value="">Выберите причину</option>
                        {reasonOptions.map(({key, label}) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    {errors.reason && <span id={`state-reason-error-${action}`} className="mt-1 block font-mono text-xs"
                                            style={{color: '#E6A49B'}}>{errors.reason}</span>}
                </label>
            )}
            <label className="mt-3 block" htmlFor={`state-note-${action}`}>
                <span className="font-mono text-xs"
                      style={{color: '#8B92A0'}}>{action === 'resolve_blocker' ? 'Что изменилось' : 'Комментарий'}{draft.reason === 'other' ? ' *' : ''}</span>
                <textarea id={`state-note-${action}`} value={draft.note}
                          onChange={(event) => set('note', event.target.value)} rows={3}
                          aria-invalid={Boolean(errors.note)}
                          aria-describedby={errors.note ? `state-note-error-${action}` : undefined}
                          placeholder={action === 'blocker' ? 'Что именно мешает и что проверить позже' : 'Контекст для истории процесса'}
                          className="mt-1 w-full p-2 font-mono text-sm" style={inputStyle}/>
                {errors.note && <span id={`state-note-error-${action}`} className="mt-1 block font-mono text-xs"
                                      style={{color: '#E6A49B'}}>{errors.note}</span>}
            </label>
            {action === 'blocker' && (
                <label className="mt-3 block" htmlFor="blocker-review-date">
                    <span className="font-mono text-xs" style={{color: '#8B92A0'}}>Вернуть в внимание</span>
                    <input id="blocker-review-date" type="date" value={draft.reviewDate}
                           onChange={(event) => set('reviewDate', event.target.value)}
                           aria-invalid={Boolean(errors.reviewDate)} className="mt-1 w-full p-2 font-mono text-sm"
                           style={inputStyle}/>
                    {errors.reviewDate && <span className="mt-1 block font-mono text-xs"
                                                style={{color: '#E6A49B'}}>{errors.reviewDate}</span>}
                </label>
            )}
            <div className="mt-3 flex flex-wrap gap-2" role="status" aria-live="polite">
                <button type="button" onClick={onSubmit} disabled={saving} className="px-3 py-2 font-mono text-xs"
                        style={primaryButtonStyle}>{saving ? 'Сохраняю…' : submitLabel}</button>
                <button type="button" onClick={onCancel} disabled={saving} className="px-3 py-2 font-mono text-xs"
                        style={secondaryButtonStyle}>Отмена
                </button>
            </div>
        </div>
    );
}

function ProcessForm({draft, setDraft, saving, onClose, onSave}) {
    const set = (key, value) => setDraft((current) => ({...current, [key]: value}));

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="form-backdrop fixed inset-0 flex items-end justify-center sm:items-center"
             style={{zIndex: 70, background: 'rgba(0,0,0,0.58)'}}>
            <div className="form-panel scroll-thin max-h-[92vh] w-full max-w-2xl overflow-y-auto p-5"
                 style={{background: '#1E222B', overscrollBehavior: 'contain', border: '1px solid #2B303B'}}>
                <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-semibold">Hiring process</h2>
                    <button onClick={onClose}>
                        <X size={18} style={{color: '#8B92A0'}}/>
                    </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Field label="Название процесса">
                        <input value={draft.title} onChange={(event) => set('title', event.target.value)}
                               placeholder="Frontend Engineer — Fintech client" className="w-full p-2 font-mono text-sm"
                               style={inputStyle}/>
                    </Field>
                    <Field label="Компания / клиент">
                        <input value={draft.companyName} onChange={(event) => set('companyName', event.target.value)}
                               placeholder="Company name" className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                    </Field>
                    <Field label="Вакансия / позиция">
                        <input value={draft.role} onChange={(event) => set('role', event.target.value)}
                               placeholder={DEFAULT_TARGET_ROLE} className="w-full p-2 font-mono text-sm"
                               style={inputStyle}/>
                    </Field>
                    <Field label="Рекрутер">
                        <input value={draft.recruiterName}
                               onChange={(event) => set('recruiterName', event.target.value)} placeholder="Name Surname"
                               className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                    </Field>
                    <Field label="Должность рекрутера">
                        <input value={draft.recruiterTitle}
                               onChange={(event) => set('recruiterTitle', event.target.value)}
                               placeholder="Recruitment Specialist" className="w-full p-2 font-mono text-sm"
                               style={inputStyle}/>
                    </Field>
                    <Field label="LinkedIn рекрутера">
                        <input value={draft.recruiterLinkedinUrl}
                               onChange={(event) => set('recruiterLinkedinUrl', event.target.value)}
                               placeholder="https://www.linkedin.com/in/..." className="w-full p-2 font-mono text-sm"
                               style={inputStyle}/>
                    </Field>
                    <Field label="Email рекрутера">
                        <input value={draft.recruiterEmail}
                               onChange={(event) => set('recruiterEmail', event.target.value)}
                               placeholder="name@company.com" className="w-full p-2 font-mono text-sm"
                               style={inputStyle}/>
                    </Field>
                    <Field label="Локация">
                        <input value={draft.location} onChange={(event) => set('location', event.target.value)}
                               placeholder="Remote / EU / Kyiv" className="w-full p-2 font-mono text-sm"
                               style={inputStyle}/>
                    </Field>
                    <Field label="Компенсация">
                        <input value={draft.salary} onChange={(event) => set('salary', event.target.value)}
                               placeholder="$5000/mo, B2B, gross..." className="w-full p-2 font-mono text-sm"
                               style={inputStyle}/>
                    </Field>
                </div>

                <Field label="Этап">
                    <select value={draft.hiringStage} onChange={(event) => set('hiringStage', event.target.value)}
                            className="w-full p-2 font-mono text-sm" style={inputStyle}>
                        {Object.entries(HIRING_STAGES).map(([key, item]) => (
                            <option key={key} value={key}>
                                {item.label}
                            </option>
                        ))}
                    </select>
                </Field>

                <Field label="Состояние">
                    <Segmented value={draft.workState} onChange={(value) => set('workState', value)}
                               items={Object.entries(WORK_STATES).map(([key, item]) => [key, item.label])}/>
                </Field>

                {(draft.workState === 'paused' || draft.workState === 'lost') && (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Причина">
                            <select value={draft.statusReason}
                                    onChange={(event) => set('statusReason', event.target.value)}
                                    className="w-full p-2 font-mono text-sm" style={inputStyle}>
                                <option value="">Не выбрано</option>
                                {Object.entries(draft.workState === 'paused' ? PAUSE_REASONS : LOST_REASONS).map(([key, label]) => (
                                    <option key={key} value={key}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Комментарий к статусу">
                            <input value={draft.statusNote} onChange={(event) => set('statusNote', event.target.value)}
                                   placeholder="например: проект перенесли на август"
                                   className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                        </Field>
                    </div>
                )}

                {isProcessBlocked(draft) && (
                    <div className="active-blocker mt-3 grid gap-3 p-3 sm:grid-cols-2">
                        <Field label="Активный блокер">
                            <select value={draft.blockerReason}
                                    onChange={(event) => set('blockerReason', event.target.value)}
                                    className="w-full p-2 font-mono text-sm" style={inputStyle}>
                                {getBlockerReasonOptions(draft.sourceType).map(({key, label}) => <option key={key}
                                                                                                         value={key}>{label}</option>)}
                            </select>
                        </Field>
                        <Field label="Проверить блокер">
                            <input type="date" value={draft.blockerReviewDate || ''}
                                   onChange={(event) => set('blockerReviewDate', event.target.value)}
                                   className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                        </Field>
                        <div className="sm:col-span-2">
                            <Field label="Комментарий к блокеру">
                                <input value={draft.blockerNote}
                                       onChange={(event) => set('blockerNote', event.target.value)}
                                       className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                            </Field>
                        </div>
                    </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Next action type">
                        <select value={draft.nextActionType}
                                onChange={(event) => set('nextActionType', event.target.value)}
                                className="w-full p-2 font-mono text-sm" style={inputStyle}>
                            {Object.entries(NEXT_ACTION_TYPES).map(([key, label]) => (
                                <option key={key} value={key}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Дата">
                        <input type="date" value={draft.nextActionDate || ''}
                               onChange={(event) => set('nextActionDate', event.target.value)}
                               className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                    </Field>
                    <Field label="Время">
                        <input type="time" value={draft.nextActionTime || ''}
                               onChange={(event) => set('nextActionTime', event.target.value)}
                               className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                    </Field>
                </div>

                <Field label="Что сделать дальше">
                    <input value={draft.nextActionNote} onChange={(event) => set('nextActionNote', event.target.value)}
                           placeholder="написать follow-up, подготовить вопросы, подтвердить слот..."
                           className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Тип источника">
                        <select value={draft.sourceType} onChange={(event) => set('sourceType', event.target.value)}
                                className="w-full p-2 font-mono text-sm" style={inputStyle}>
                            {Object.entries(SOURCE_TYPES).map(([key, label]) => (
                                <option key={key} value={key}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="URL источника">
                        <input value={draft.sourceUrl} onChange={(event) => set('sourceUrl', event.target.value)}
                               placeholder="LinkedIn / Djinni / company URL" className="w-full p-2 font-mono text-sm"
                               style={inputStyle}/>
                    </Field>
                </div>

                <Field label="Описание / исходный текст вакансии">
                    <textarea value={draft.sourceRawText} onChange={(event) => set('sourceRawText', event.target.value)}
                              rows={3} className="w-full p-2 font-mono text-sm" style={inputStyle}/>
                </Field>

                <div className="mt-5 flex gap-2">
                    <button onClick={onSave} disabled={saving} className="flex-1 py-2.5 font-mono text-xs"
                            style={{background: '#EDEEF0', color: '#16191F'}}>
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

function EventItem({event}) {
    const Icon = EVENT_TYPES[event.type]?.icon || FileText;
    const state = WORK_STATES[event.workState];
    const stage = HIRING_STAGES[event.hiringStage];
    const accentColor = event.blockerReason
        ? '#E8A33D'
        : event.statusReason
            ? STATUS_REASON_COLORS[event.statusReason] || STATUS_REASON_COLORS.other
            : state?.color || stage?.color || '#4FB3BF';

    return (
        <div className="event-timeline-item" style={{'--event-color': accentColor}}>
            <div className="event-timeline-rail" aria-hidden="true">
                <span/>
            </div>
            <div className="event-timeline-node" aria-hidden="true">
                <Icon size={15}/>
            </div>
            <article className="event-timeline-card">
                <div className="event-timeline-head">
                    <div className="min-w-0">
                        <h3 className="event-timeline-title font-mono text-sm">{EVENT_TYPES[event.type]?.label || event.type}</h3>
                        <div className="event-timeline-meta font-mono text-xs">
                            {fmtDateTime(event.occurredAt)} · {stage?.short || event.hiringStage}
                        </div>
                    </div>
                    {state && <span className="event-timeline-state font-mono text-xs">{state.label}</span>}
                </div>

                {event.note && <p className="event-timeline-note font-mono text-xs">{event.note}</p>}
                {event.blockerReason &&
                    <p className="event-timeline-reason font-mono text-xs">{BLOCKER_REASONS[event.blockerReason] || event.blockerReason}</p>}
                {event.statusReason &&
                    <p className="event-timeline-reason font-mono text-xs">{STATUS_REASONS[event.statusReason]}</p>}
            </article>
        </div>
    );
}

function InfoLine({icon: Icon, label, value, secondary = '', wide = false, accent = false}) {
    return (
        <div className={`info-line p-3${wide ? ' info-line-wide' : ''}${accent ? ' info-line-accent' : ''}`}
             style={{background: '#15181E', border: '1px solid #2B303B'}}>
            <div className="flex items-center gap-2 font-mono text-xs" style={{color: '#8B92A0'}}>
                <Icon size={14}/>
                {label}
            </div>
            <div className="info-line-value mt-1 font-mono text-sm">{value}</div>
            {secondary && <div className="info-line-secondary mt-1 font-mono text-xs">{secondary}</div>}
        </div>
    );
}

function Field({label, children}) {
    return (
        <label className="mt-3 block">
      <span className="font-mono text-xs" style={{color: '#8B92A0'}}>
        {label}
      </span>
            <div className="mt-1">{children}</div>
        </label>
    );
}

function Segmented({value, onChange, items}) {
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

function SectionTitle({title, count, color}) {
    return (
        <div className="mb-2 mt-5 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold" style={{color}}>
                {title}
            </h2>
            <span className="font-mono text-xs" style={{color: '#666D7A'}}>
        {count}
      </span>
        </div>
    );
}

function InlineEmpty({text}) {
    return (
        <div className="mt-3 p-4 text-center font-mono text-xs"
             style={{border: '1px dashed #2B303B', color: '#666D7A'}}>
            {text}
        </div>
    );
}

function EmptyState({icon: Icon, title, text, actionLabel, onAction, spin}) {
    return (
        <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center">
            <Icon size={30} className={spin ? 'animate-spin' : ''} style={{color: '#3D424D'}}/>
            <h2 className="font-display mt-4 text-lg font-semibold">{title}</h2>
            <p className="font-mono mt-1 max-w-md text-xs" style={{color: '#8B92A0'}}>
                {text}
            </p>
            {actionLabel && (
                <button onClick={onAction} className="mt-5 px-4 py-2 font-mono text-xs"
                        style={{background: '#EDEEF0', color: '#16191F'}}>
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

const primaryButtonStyle = {
    background: '#EDEEF0',
    border: '1px solid #EDEEF0',
    color: '#16191F',
    borderRadius: 4,
};

const secondaryButtonStyle = {
    border: '1px solid #2B303B',
    color: '#AAB0BC',
    borderRadius: 4,
};
