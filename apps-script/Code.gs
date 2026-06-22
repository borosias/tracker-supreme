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
const DEFAULT_APIFY_ACTOR_ID = 'scrapers-hub~linkedin-profile-details-scraper-email-no-cookies-required';

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
          processes: readObjects_(SHEETS.processes.name).map(function (process) {
            return normalizeProcessForClient_(process);
          }),
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
    nextActionDate: normalizeDateOnly_(process.nextActionDate) || dateOnly_(now),
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

function parseLinkedinPublicMetadata_(html, linkedinUrl) {
  const source = String(html || '');
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptPattern.exec(source))) {
    try {
      const parsed = JSON.parse(match[1]);
      const candidates = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed && parsed['@graph'])
          ? parsed['@graph']
          : [parsed];
      const person = candidates.find(function (item) {
        const types = Array.isArray(item && item['@type']) ? item['@type'] : [item && item['@type']];
        return types.indexOf('Person') >= 0;
      });
      if (!person) continue;

      const worksFor = Array.isArray(person.worksFor) ? person.worksFor[0] : person.worksFor;
      const address = person.address && typeof person.address === 'object' ? person.address : {};
      const country = textValue_(address.addressCountry);
      const location = [textValue_(address.addressLocality), textValue_(address.addressRegion), country]
        .filter(Boolean)
        .filter(function (value, index, values) {
          return values.indexOf(value) === index;
        })
        .join(', ');
      const result = {
        name: textValue_(person.name),
        headline: textValue_(person.jobTitle) || textValue_(person.disambiguatingDescription),
        companyName: textValue_(worksFor),
        location: location,
        description: textValue_(person.description),
        profileUrl: textValue_(person.url) || textValue_(person.sameAs) || linkedinUrl || '',
      };

      if (result.name || result.headline || result.companyName) return result;
    } catch (error) {
      // Ignore unrelated or malformed JSON-LD blocks and continue looking for a Person.
    }
  }

  const openGraphTitle = extractMetaContent_(source, 'og:title');
  const openGraphDescription = extractMetaContent_(source, 'og:description');
  const openGraphUrl = extractMetaContent_(source, 'og:url');
  if (openGraphTitle) {
    const cleanTitle = openGraphTitle.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    const separatorIndex = cleanTitle.indexOf(' - ');
    const name = separatorIndex >= 0 ? cleanTitle.slice(0, separatorIndex).trim() : cleanTitle;
    const headline = separatorIndex >= 0 ? cleanTitle.slice(separatorIndex + 3).trim() : '';
    return {
      name: name,
      headline: headline,
      companyName: '',
      location: '',
      description: openGraphDescription,
      profileUrl: openGraphUrl || linkedinUrl || '',
    };
  }

  return null;
}

function extractMetaContent_(html, key) {
  const metaPattern = /<meta\b[^>]*>/gi;
  const source = String(html || '');
  let match;
  while ((match = metaPattern.exec(source))) {
    const tag = match[0];
    const keyMatch = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    if (!keyMatch || keyMatch[1].toLowerCase() !== String(key || '').toLowerCase()) continue;
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    return contentMatch ? decodeHtmlEntities_(contentMatch[1]).trim() : '';
  }
  return '';
}

function decodeHtmlEntities_(value) {
  let decoded = String(value || '');
  for (let pass = 0; pass < 3; pass += 1) {
    const previous = decoded;
    decoded = decoded
      .replace(/&#(\d+);/g, function (_, code) {
        return String.fromCharCode(Number(code));
      })
      .replace(/&#x([0-9a-f]+);/gi, function (_, code) {
        return String.fromCharCode(parseInt(code, 16));
      })
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
    if (decoded === previous) break;
  }
  return decoded;
}

function linkedinMetadataToProcessDraft_(metadata) {
  const profile = metadata || {};
  const companyName = textValue_(profile.companyName);
  const recruiterName = textValue_(profile.name);
  const recruiterTitle = textValue_(profile.headline);
  const profileUrl = textValue_(profile.profileUrl);
  return {
    title: companyName ? companyName + ' — recruiter contact' : recruiterName || 'LinkedIn contact',
    companyName: companyName,
    role: recruiterTitle,
    recruiterName: recruiterName,
    recruiterTitle: recruiterTitle,
    recruiterLinkedinUrl: profileUrl,
    sourceType: 'linkedin',
    sourceUrl: profileUrl,
    location: textValue_(profile.location),
    hiringStage: 'recruiter_talk',
    workState: 'action_required',
    nextActionType: 'follow_up',
    nextActionNote: 'Проверить профиль и зафиксировать следующий шаг',
  };
}

function buildLinkedinActorInput_(linkedinUrl) {
  return {
    profileUrls: [{ url: linkedinUrl }],
    includeEmail: false,
  };
}

function normalizeLinkedinActorMetadata_(item, linkedinUrl) {
  const source = item || {};
  const profile = source.basic_info || source.element || source.profile || source;
  const company = objectOrEmpty_(profile.company);
  const location = objectOrEmpty_(profile.location);
  const currentPosition = firstItem_(profile.currentPosition) || firstItem_(profile.current_position) || {};
  const experience = firstItem_(profile.experience) || {};
  const positionGroup = firstItem_(profile.position_groups) || {};
  const profilePosition = firstItem_(positionGroup.profile_positions) || {};
  return {
    name:
      textValue_(profile.fullname) ||
      textValue_(profile.full_name) ||
      textValue_(profile.fullName) ||
      textValue_(profile.name) ||
      [textValue_(profile.first_name || profile.firstName), textValue_(profile.last_name || profile.lastName)]
        .filter(Boolean)
        .join(' '),
    headline:
      textValue_(profile.headline) ||
      textValue_(profile.jobTitle) ||
      textValue_(profile.job_title) ||
      textValue_(profile.title) ||
      textValue_(currentPosition.title || currentPosition.position) ||
      textValue_(profilePosition.title || profilePosition.position),
    companyName:
      textValue_(profile.current_company) ||
      textValue_(profile.currentCompany) ||
      textValue_(profile.current_company_name) ||
      textValue_(company.name) ||
      textValue_(profile.companyName) ||
      textValue_(currentPosition.companyName) ||
      textValue_(currentPosition.company && currentPosition.company.name) ||
      textValue_(experience.companyName) ||
      textValue_(positionGroup.company && positionGroup.company.name),
    location: textValue_(location.full) || locationText_(profile.location),
    description: textValue_(profile.about) || textValue_(profile.description),
    profileUrl:
      textValue_(profile.profile_url) ||
      textValue_(profile.linkedinUrl) ||
      textValue_(profile.url) ||
      linkedinUrl ||
      '',
  };
}

function enrichLinkedinFromPublicPage_(linkedinUrl) {
  if (!/^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\//i.test(String(linkedinUrl || ''))) {
    return {
      confidence: 'low',
      warnings: ['LinkedIn URL must point to a public linkedin.com/in profile'],
      processDraft: null,
    };
  }

  try {
    const response = UrlFetchApp.fetch(linkedinUrl, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36',
      },
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      return {
        confidence: 'low',
        warnings: ['LinkedIn public page returned HTTP ' + code],
        processDraft: null,
      };
    }

    const metadata = parseLinkedinPublicMetadata_(response.getContentText(), linkedinUrl);
    if (!metadata) {
      return {
        confidence: 'low',
        warnings: ['LinkedIn public metadata is unavailable for this profile'],
        processDraft: null,
      };
    }

    return {
      confidence: 'medium',
      warnings: [],
      processDraft: linkedinMetadataToProcessDraft_(metadata),
    };
  } catch (error) {
    return {
      confidence: 'low',
      warnings: ['LinkedIn public page fetch failed: ' + error.message],
      processDraft: null,
    };
  }
}

function enrichLinkedin_(linkedinUrl) {
  if (!linkedinUrl) {
    return {
      confidence: 'low',
      warnings: ['LinkedIn URL is empty'],
      processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
    };
  }

  const publicResult = enrichLinkedinFromPublicPage_(linkedinUrl);
  if (publicResult.processDraft) return publicResult;

  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('APIFY_TOKEN');
  const actorId = properties.getProperty('APIFY_ACTOR_ID') || DEFAULT_APIFY_ACTOR_ID;
  if (!token) {
    return {
      confidence: 'low',
      warnings: publicResult.warnings.concat(['APIFY_TOKEN is not set in Script Properties']),
      processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
    };
  }

  try {
    const endpoint =
      'https://api.apify.com/v2/acts/' +
      encodeURIComponent(actorId) +
      '/run-sync-get-dataset-items?clean=true&maxItems=1';
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(buildLinkedinActorInput_(linkedinUrl)),
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      return {
        confidence: 'low',
        warnings: publicResult.warnings.concat(['Apify returned HTTP ' + code]),
        processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
      };
    }

    const items = JSON.parse(response.getContentText() || '[]');
    const item = items && items[0];
    if (!item || item.status === 'not_found') {
      return {
        confidence: 'low',
        warnings: publicResult.warnings.concat(['LinkedIn profile was not found by enrichment provider']),
        processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
      };
    }

    const metadata = normalizeLinkedinActorMetadata_(item, linkedinUrl);
    return {
      confidence: 'high',
      warnings: [],
      processDraft: linkedinMetadataToProcessDraft_(metadata),
    };
  } catch (error) {
    return {
      confidence: 'low',
      warnings: publicResult.warnings.concat(['LinkedIn enrichment failed: ' + error.message]),
      processDraft: parseGenericSource_('linkedin', linkedinUrl, ''),
    };
  }
}

function objectOrEmpty_(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstItem_(value) {
  return Array.isArray(value) && value.length ? value[0] : null;
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
  const actionDate = normalizeDateOnly_(process.nextActionDate);
  if (!actionDate) throw new Error('Process has no valid nextActionDate');
  process.nextActionDate = actionDate;

  const calendar = CalendarApp.getDefaultCalendar();
  const title = calendarTitle_(process);
  const description = calendarDescription_(process);
  let calendarEvent = null;
  if (process.calendarEventId) {
    try {
      calendarEvent = calendar.getEventById(process.calendarEventId);
    } catch (error) {
      calendarEvent = null;
    }
  }

  if (process.nextActionType === 'interview' && process.nextActionTime) {
    const start = calendarDateTime_(actionDate, process.nextActionTime);
    if (!start) throw new Error('Process has no valid nextActionTime');
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    if (calendarEvent) {
      calendarEvent.setTitle(title);
      calendarEvent.setDescription(description);
      calendarEvent.setTime(start, end);
    } else {
      calendarEvent = calendar.createEvent(title, start, end, {
        description: description,
      });
    }
  } else {
    const day = calendarDate_(actionDate);
    if (!day) throw new Error('Process has no valid nextActionDate');
    if (calendarEvent) {
      calendarEvent.setTitle(title);
      calendarEvent.setDescription(description);
      calendarEvent.setAllDayDate(day);
    } else {
      calendarEvent = calendar.createAllDayEvent(title, day, {
        description: description,
      });
    }
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

function normalizeProcessForClient_(process) {
  const normalized = {};
  Object.keys(process || {}).forEach(function (key) {
    normalized[key] = process[key];
  });
  normalized.nextActionDate = normalizeDateOnly_(normalized.nextActionDate);
  return normalized;
}

function normalizeDateOnly_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return formatDateOnly_(value);
  }

  if (typeof value === 'number') {
    return formatDateOnly_(new Date(Math.round((value - 25569) * 86400 * 1000)));
  }

  const raw = String(value).trim();
  if (!raw) return '';

  const first = raw.split('T')[0].trim();
  const isoParts = first.split('-');
  if (isoParts.length >= 3 && String(isoParts[0]).length === 4) {
    return validDateOnly_(isoParts[0], isoParts[1], isoParts[2]);
  }

  const localParts = splitLocalDate_(first);
  if (localParts.length >= 3 && String(localParts[2]).length === 4) {
    return validDateOnly_(localParts[2], localParts[1], localParts[0]);
  }

  return formatDateOnly_(new Date(raw));
}

function splitLocalDate_(value) {
  const text = String(value || '');
  if (text.indexOf('.') >= 0) return text.split('.');
  if (text.indexOf('/') >= 0) return text.split('/');
  if (text.indexOf('-') >= 0) return text.split('-');
  return [];
}

function validDateOnly_(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';
  return formatDateOnly_(date);
}

function formatDateOnly_(date) {
  if (Object.prototype.toString.call(date) !== '[object Date]' || isNaN(date.getTime())) return '';
  return [date.getFullYear(), pad2_(date.getMonth() + 1), pad2_(date.getDate())].join('-');
}

function calendarDate_(dateOnly) {
  const parts = normalizeDateOnly_(dateOnly).split('-').map(Number);
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function calendarDateTime_(dateOnly, timeValue) {
  const date = calendarDate_(dateOnly);
  if (!date) return null;
  const timeParts = String(timeValue || '').split(':').map(Number);
  if (timeParts.length < 2 || isNaN(timeParts[0]) || isNaN(timeParts[1])) return null;
  date.setHours(timeParts[0], timeParts[1], 0, 0);
  return date;
}

function pad2_(value) {
  return String(value).padStart(2, '0');
}

function dateOnly_(iso) {
  return normalizeDateOnly_(iso) || formatDateOnly_(new Date());
}
