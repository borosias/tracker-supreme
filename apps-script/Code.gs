const SHEETS = {
  processes: {
    name: 'Processes',
    headers: [
      'id',
      'title',
      'companyName',
      'role',
      'recruiterName',
      'recruiterTitle',
      'recruiterLinkedinUrl',
      'recruiterEmail',
      'sourceType',
      'sourceUrl',
      'sourceRawText',
      'hiringStage',
      'workState',
      'statusReason',
      'statusNote',
      'nextActionType',
      'nextActionDate',
      'nextActionTime',
      'nextActionNote',
      'salary',
      'location',
      'calendarEventId',
      'createdAt',
      'updatedAt',
      'lastEventAt',
    ],
  },
  events: {
    name: 'Events',
    headers: [
      'id',
      'processId',
      'type',
      'occurredAt',
      'title',
      'note',
      'hiringStage',
      'workState',
      'statusReason',
      'sourceType',
      'sourceUrl',
      'calendarEventId',
    ],
  },
  contacts: {
    name: 'Contacts',
    headers: ['id', 'processId', 'name', 'title', 'email', 'linkedinUrl', 'companyName', 'createdAt', 'updatedAt'],
  },
  sources: {
    name: 'Sources',
    headers: ['id', 'processId', 'sourceType', 'url', 'rawText', 'confidence', 'warnings', 'createdAt'],
  },
  settings: {
    name: 'Settings',
    headers: ['key', 'value'],
  },
};

const HIRING_STAGE_DEFAULT = 'application';
const WORK_STATE_DEFAULT = 'active';
const APIFY_ACTOR_ID = 'harvestapi~linkedin-profile-scraper';

function doGet() {
  ensureSchema_();
  return json_({
    ok: true,
    service: 'Recruiting Pipeline Apps Script API',
    actions: ['listProcesses', 'upsertProcess', 'appendEvent', 'importSource', 'syncCalendar'],
  });
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    assertSharedSecret_(payload.sharedSecret);
    ensureSchema_();

    switch (payload.action) {
      case 'listProcesses':
        return json_({
          ok: true,
          processes: readObjects_(SHEETS.processes.name),
          events: readObjects_(SHEETS.events.name),
          contacts: readObjects_(SHEETS.contacts.name),
          sources: readObjects_(SHEETS.sources.name),
          settings: readObjects_(SHEETS.settings.name),
        });
      case 'upsertProcess':
        return json_({ ok: true, process: upsertProcess_(payload.process || {}) });
      case 'appendEvent':
        return json_({ ok: true, event: appendEvent_(payload.processId, payload.event || {}) });
      case 'importSource':
        return json_(importSource_(payload));
      case 'syncCalendar':
        return json_(syncCalendar_(payload.processId, payload.process));
      default:
        throw new Error('Unknown action: ' + payload.action);
    }
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function assertSharedSecret_(supplied) {
  const expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (expected && supplied !== expected) {
    throw new Error('Invalid shared secret');
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSchema_() {
  const ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function (key) {
    const def = SHEETS[key];
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
    }
    const existing = sheet.getRange(1, 1, 1, Math.max(def.headers.length, sheet.getLastColumn() || 1)).getValues()[0];
    const same = def.headers.every(function (header, index) {
      return existing[index] === header;
    });
    if (!same) {
      sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
      sheet.setFrozenRows(1);
    }
  });
}

function readObjects_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return values
    .map(function (row) {
      const item = {};
      headers.forEach(function (header, index) {
        item[header] = row[index] === undefined ? '' : row[index];
      });
      return item;
    })
    .filter(function (item) {
      return item.id || item.key;
    });
}

function writeObject_(sheetName, object, keyField) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const key = object[keyField];
  const row = headers.map(function (header) {
    return object[header] === undefined || object[header] === null ? '' : object[header];
  });

  if (key) {
    const rows = readObjects_(sheetName);
    const index = rows.findIndex(function (item) {
      return item[keyField] === key;
    });
    if (index >= 0) {
      sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
      return object;
    }
  }

  sheet.appendRow(row);
  return object;
}

function upsertProcess_(process) {
  const now = new Date().toISOString();
  const normalized = {
    id: process.id || makeId_('proc'),
    title: process.title || '',
    companyName: process.companyName || '',
    role: process.role || '',
    recruiterName: process.recruiterName || '',
    recruiterTitle: process.recruiterTitle || '',
    recruiterLinkedinUrl: process.recruiterLinkedinUrl || '',
    recruiterEmail: process.recruiterEmail || '',
    sourceType: process.sourceType || 'manual',
    sourceUrl: process.sourceUrl || '',
    sourceRawText: process.sourceRawText || '',
    hiringStage: process.hiringStage || HIRING_STAGE_DEFAULT,
    workState: process.workState || WORK_STATE_DEFAULT,
    statusReason: process.statusReason || '',
    statusNote: process.statusNote || '',
    nextActionType: process.nextActionType || 'follow_up',
    nextActionDate: process.nextActionDate || dateOnly_(now),
    nextActionTime: process.nextActionTime || '',
    nextActionNote: process.nextActionNote || '',
    salary: process.salary || '',
    location: process.location || '',
    calendarEventId: process.calendarEventId || '',
    createdAt: process.createdAt || now,
    updatedAt: now,
    lastEventAt: process.lastEventAt || '',
  };
  const saved = writeObject_(SHEETS.processes.name, normalized, 'id');
  upsertContactForProcess_(saved);
  upsertSourceForProcess_(saved);
  return saved;
}

function upsertContactForProcess_(process) {
  if (!process.recruiterName && !process.recruiterEmail && !process.recruiterLinkedinUrl) return;
  writeObject_(SHEETS.contacts.name, {
    id: 'contact_' + process.id,
    processId: process.id,
    name: process.recruiterName || '',
    title: process.recruiterTitle || '',
    email: process.recruiterEmail || '',
    linkedinUrl: process.recruiterLinkedinUrl || '',
    companyName: process.companyName || '',
    createdAt: process.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, 'id');
}

function upsertSourceForProcess_(process) {
  if (!process.sourceUrl && !process.sourceRawText) return;
  writeObject_(SHEETS.sources.name, {
    id: 'source_' + process.id,
    processId: process.id,
    sourceType: process.sourceType || 'manual',
    url: process.sourceUrl || '',
    rawText: process.sourceRawText || '',
    confidence: 'confirmed',
    warnings: '',
    createdAt: process.createdAt || new Date().toISOString(),
  }, 'id');
}

function appendEvent_(processId, event) {
  const now = new Date().toISOString();
  const normalized = {
    id: event.id || makeId_('evt'),
    processId: processId || event.processId,
    type: event.type || 'note_added',
    occurredAt: event.occurredAt || now,
    title: event.title || event.type || 'note_added',
    note: event.note || '',
    hiringStage: event.hiringStage || HIRING_STAGE_DEFAULT,
    workState: event.workState || WORK_STATE_DEFAULT,
    statusReason: event.statusReason || '',
    sourceType: event.sourceType || '',
    sourceUrl: event.sourceUrl || '',
    calendarEventId: event.calendarEventId || '',
  };
  if (!normalized.processId) throw new Error('appendEvent requires processId');
  writeObject_(SHEETS.events.name, normalized, 'id');
  touchProcessLastEvent_(normalized.processId, normalized.occurredAt);
  return normalized;
}

function touchProcessLastEvent_(processId, occurredAt) {
  const processes = readObjects_(SHEETS.processes.name);
  const process = processes.find(function (item) {
    return item.id === processId;
  });
  if (!process) return;
  process.lastEventAt = occurredAt;
  process.updatedAt = new Date().toISOString();
  writeObject_(SHEETS.processes.name, process, 'id');
}

function importSource_(payload) {
  const sourceType = payload.sourceType || detectSourceType_(payload.url || payload.rawText || '');
  const url = payload.url || '';
  const rawText = payload.rawText || '';
  const warnings = [];
  let processDraft;
  let confidence = 'low';

  if (sourceType === 'linkedin') {
    const result = enrichLinkedin_(url);
    warnings.push.apply(warnings, result.warnings);
    processDraft = result.processDraft;
    confidence = result.confidence;
  } else if (sourceType === 'djinni') {
    processDraft = parseDjinni_(url, rawText);
    confidence = rawText ? 'medium' : 'low';
  } else {
    processDraft = parseGenericSource_(sourceType, url, rawText);
  }

  processDraft.id = processDraft.id || makeId_('proc');
  processDraft.sourceType = sourceType;
  processDraft.sourceUrl = url;
  processDraft.sourceRawText = rawText;
  processDraft.hiringStage = processDraft.hiringStage || HIRING_STAGE_DEFAULT;
  processDraft.workState = processDraft.workState || 'action_required';
  processDraft.nextActionType = processDraft.nextActionType || 'follow_up';
  processDraft.nextActionDate = processDraft.nextActionDate || dateOnly_(new Date().toISOString());
  processDraft.nextActionNote = processDraft.nextActionNote || 'Проверить импорт и определить следующий шаг';
  processDraft.createdAt = processDraft.createdAt || new Date().toISOString();

  const eventDraft = {
    id: makeId_('evt'),
    processId: processDraft.id,
    type: 'source_imported',
    occurredAt: new Date().toISOString(),
    title: 'Источник импортирован',
    note: sourceType + ': ' + (url || firstLine_(rawText) || 'raw text'),
    hiringStage: processDraft.hiringStage,
    workState: processDraft.workState,
    statusReason: '',
    sourceType: sourceType,
    sourceUrl: url,
    calendarEventId: '',
  };

  return {
    ok: true,
    processDraft: processDraft,
    eventDraft: eventDraft,
    confidence: confidence,
    warnings: warnings,
  };
}

function enrichLinkedin_(linkedinUrl) {
  if (!linkedinUrl) {
    return {
      confidence: 'low',
      warnings: ['LinkedIn URL is empty'],
      processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
    };
  }

  const token = PropertiesService.getScriptProperties().getProperty('APIFY_TOKEN');
  if (!token) {
    return {
      confidence: 'low',
      warnings: ['APIFY_TOKEN is not set in Script Properties'],
      processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
    };
  }

  try {
    const endpoint =
      'https://api.apify.com/v2/acts/' +
      encodeURIComponent(APIFY_ACTOR_ID) +
      '/run-sync-get-dataset-items?clean=true&maxItems=1';
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify({
        urls: [linkedinUrl],
        profileScraperMode: 'Profile details no email ($4 per 1k)',
      }),
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      return {
        confidence: 'low',
        warnings: ['Apify returned HTTP ' + code],
        processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
      };
    }

    const items = JSON.parse(response.getContentText() || '[]');
    const item = items && items[0];
    if (!item || item.status === 'not_found') {
      return {
        confidence: 'low',
        warnings: ['LinkedIn profile was not found by enrichment provider'],
        processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
      };
    }

    const profile = item.profile || item;
    const currentPosition = firstItem_(profile.currentPosition) || firstItem_(profile.current_position);
    const experience = firstItem_(profile.experience) || {};
    const positionGroup = firstItem_(profile.position_groups) || {};
    const profilePosition = firstItem_(positionGroup.profile_positions) || {};
    const company = objectOrEmpty_(profile.company);
    const companyName =
      textValue_(company.name) ||
      textValue_(profile.company) ||
      textValue_(profile.current_company) ||
      textValue_(currentPosition.companyName) ||
      textValue_(currentPosition.company && currentPosition.company.name) ||
      textValue_(experience.companyName) ||
      textValue_(positionGroup.company && positionGroup.company.name) ||
      '';
    const fullName =
      textValue_(profile.full_name) ||
      textValue_(profile.fullName) ||
      textValue_(profile.name) ||
      [textValue_(profile.first_name || profile.firstName), textValue_(profile.last_name || profile.lastName)]
        .filter(Boolean)
        .join(' ');
    const title =
      textValue_(profile.title) ||
      textValue_(profile.headline) ||
      textValue_(profile.job_title) ||
      textValue_(currentPosition.title || currentPosition.position) ||
      textValue_(profilePosition.title || profilePosition.position) ||
      '';
    return {
      confidence: 'high',
      warnings: [],
      processDraft: {
        title: companyName ? companyName + ' — recruiter contact' : fullName || 'LinkedIn contact',
        companyName: companyName,
        role: title,
        recruiterName: fullName,
        recruiterTitle: title,
        recruiterLinkedinUrl: linkedinUrl,
        sourceType: 'linkedin',
        sourceUrl: linkedinUrl,
        location: locationText_(profile.location),
        hiringStage: 'recruiter_talk',
        workState: 'action_required',
        nextActionNote: 'Проверить профиль и зафиксировать следующий шаг',
      },
    };
  } catch (error) {
    return {
      confidence: 'low',
      warnings: ['LinkedIn enrichment failed: ' + error.message],
      processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
    };
  }
}

function firstItem_(value) {
  return Array.isArray(value) && value.length ? value[0] : null;
}

function objectOrEmpty_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textValue_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(textValue_).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return (
      textValue_(value.default) ||
      textValue_(value.short) ||
      textValue_(value.linkedinText) ||
      textValue_(value.text) ||
      textValue_(value.name) ||
      textValue_(value.title) ||
      textValue_(value.companyName) ||
      ''
    );
  }
  return '';
}

function locationText_(location) {
  if (!location) return '';
  if (typeof location === 'string') return location;
  const parsed = objectOrEmpty_(location.parsed);
  return (
    textValue_(location.default) ||
    textValue_(location.short) ||
    textValue_(location.linkedinText) ||
    textValue_(parsed.text) ||
    [parsed.city || location.city, parsed.state || location.state, parsed.country || location.country]
      .filter(Boolean)
      .join(', ')
  );
}

function parseDjinni_(url, rawText) {
  const text = String(rawText || '');
  const lines = text
    .split(String.fromCharCode(13))
    .join('')
    .split(String.fromCharCode(10))
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);
  const title = firstNonMetaLine_(lines) || titleFromUrl_(url) || 'Djinni opportunity';
  const companyName = extractLabeledValue_(lines, ['Company', 'Компания', 'Компанія']);
  const recruiterName = extractLabeledValue_(lines, ['Recruiter', 'HR', 'Рекрутер']);
  return {
    title: title,
    companyName: companyName,
    role: title,
    recruiterName: recruiterName,
    sourceType: 'djinni',
    sourceUrl: url || '',
    sourceRawText: rawText || '',
    hiringStage: 'application',
    workState: 'action_required',
    salary: extractSalary_(lines),
    nextActionType: 'follow_up',
    nextActionNote: 'Разобрать Djinni источник и написать/ответить',
  };
}

function extractLabeledValue_(lines, labels) {
  const normalizedLabels = labels.map(function (label) {
    return String(label).toLowerCase();
  });
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '');
    const separator = firstSeparatorIndex_(line);
    if (separator < 0) continue;
    const label = line.slice(0, separator).trim().toLowerCase();
    if (normalizedLabels.indexOf(label) >= 0) {
      return line.slice(separator + 1).trim();
    }
  }
  return '';
}

function firstSeparatorIndex_(line) {
  const candidates = [line.indexOf(':'), line.indexOf('-'), line.indexOf('–'), line.indexOf('—')].filter(function (index) {
    return index >= 0;
  });
  if (!candidates.length) return -1;
  return Math.min.apply(null, candidates);
}

function extractSalary_(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').trim();
    if (line.indexOf('$') >= 0 || line.indexOf('€') >= 0 || line.toLowerCase().indexOf('usd') >= 0) {
      return line.slice(0, 140);
    }
  }
  return '';
}

function parseGenericSource_(sourceType, url, rawText) {
  const title = firstLine_(rawText) || titleFromUrl_(url) || 'New recruiting process';
  return {
    title: title,
    companyName: '',
    role: title,
    sourceType: sourceType || 'other',
    sourceUrl: url || '',
    sourceRawText: rawText || '',
    hiringStage: HIRING_STAGE_DEFAULT,
    workState: 'action_required',
    nextActionType: 'follow_up',
    nextActionNote: 'Заполнить карточку и определить следующий шаг',
  };
}

function syncCalendar_(processId, processPayload) {
  const process = processPayload || readObjects_(SHEETS.processes.name).find(function (item) {
    return item.id === processId;
  });
  if (!process) throw new Error('Process not found: ' + processId);
  if (!process.nextActionDate) throw new Error('Process has no nextActionDate');

  const calendar = CalendarApp.getDefaultCalendar();
  const title = calendarTitle_(process);
  let calendarEvent;

  if (process.nextActionType === 'interview' && process.nextActionTime) {
    const start = new Date(process.nextActionDate + 'T' + process.nextActionTime + ':00');
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    calendarEvent = calendar.createEvent(title, start, end, {
      description: calendarDescription_(process),
    });
  } else {
    const dateParts = process.nextActionDate.split('-').map(Number);
    const day = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
    calendarEvent = calendar.createAllDayEvent(title, day, {
      description: calendarDescription_(process),
    });
  }

  process.calendarEventId = calendarEvent.getId();
  process.updatedAt = new Date().toISOString();
  const savedProcess = upsertProcess_(process);
  const event = appendEvent_(savedProcess.id, {
    type: process.nextActionType === 'interview' ? 'interview_scheduled' : 'note_added',
    title: process.nextActionType === 'interview' ? 'Интервью добавлено в Calendar' : 'Follow-up добавлен в Calendar',
    note: title,
    occurredAt: new Date().toISOString(),
    hiringStage: savedProcess.hiringStage,
    workState: savedProcess.workState,
    sourceType: savedProcess.sourceType,
    sourceUrl: savedProcess.sourceUrl,
    calendarEventId: savedProcess.calendarEventId,
  });

  return { ok: true, process: savedProcess, event: event };
}

function calendarTitle_(process) {
  const prefix = process.nextActionType === 'interview' ? 'Interview' : 'Follow-up';
  const name = process.title || process.role || process.companyName || 'Recruiting process';
  return prefix + ': ' + name;
}

function calendarDescription_(process) {
  return [
    process.companyName ? 'Company: ' + process.companyName : '',
    process.recruiterName ? 'Recruiter: ' + process.recruiterName : '',
    process.sourceUrl ? 'Source: ' + process.sourceUrl : '',
    process.nextActionNote ? 'Next action: ' + process.nextActionNote : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function detectSourceType_(value) {
  const text = String(value || '').toLowerCase();
  if (text.indexOf('linkedin.com') >= 0) return 'linkedin';
  if (text.indexOf('djinni.co') >= 0) return 'djinni';
  return 'other';
}

function firstLine_(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)[0] || '';
}

function firstNonMetaLine_(lines) {
  const blocked = /^(apply|відгукнутися|откликнуться|published|views|remote|office|hybrid|зарплата|salary)$/i;
  return (
    lines.find(function (line) {
      return line.length > 4 && !blocked.test(line);
    }) || ''
  );
}

function titleFromUrl_(url) {
  if (!url) return '';
  const clean = String(url).split('?')[0].replace(/\/$/, '');
  const slug = clean.split('/').filter(Boolean).pop() || '';
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, function (char) {
    return char.toUpperCase();
  });
}

function makeId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function dateOnly_(iso) {
  return String(iso || new Date().toISOString()).slice(0, 10);
}
