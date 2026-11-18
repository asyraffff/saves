// A tiny in-memory stand-in for the Google Apps Script services Code.js uses,
// so the script can be tested with Node.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const noop = () => chain;
const chain = new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : noop) });

function colToNum(s) {
  return s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

class FakeRange {
  constructor(sheet, row, col, nr, nc) {
    Object.assign(this, { sheet, row, col, nr, nc });
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : noop) });
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getValues() {
    return Array.from({ length: this.nr }, (_, i) =>
      Array.from({ length: this.nc }, (_, j) => this.sheet.cell(this.row + i, this.col + j)),
    );
  }
  getValue() { return this.sheet.cell(this.row, this.col); }
  setValues(v) {
    v.forEach((r, i) => r.forEach((x, j) => this.sheet.set(this.row + i, this.col + j, x)));
    return this;
  }
  setValue(x) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.row + i, this.col + j, x);
    return this;
  }
  setFormula(f) { this.sheet.formulas[`${this.row},${this.col}`] = f; return this; }
  setDataValidation(v) { this.sheet.validation[`${this.row},${this.col}`] = v; return this; }
}

export class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.formulas = {};
    this.validation = {};
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : noop) });
  }
  getName() { return this.name; }
  cell(r, c) { return (this.rows[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    // Like Sheets: a leading apostrophe forces text and isn't part of the value.
    row[c - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
  }
  getLastRow() {
    for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some((v) => v !== '' && v != null)) return i;
    return 0;
  }
  getMaxRows() { return 1000; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const [s, e] = a.split(':');
      const p = (x) => { const m = x.match(/^([A-Z]+)(\d*)$/); return [colToNum(m[1]), m[2] ? +m[2] : null]; };
      const [c1, r1] = p(s);
      const [c2, r2] = e ? p(e) : [c1, r1];
      const top = r1 ?? 1;
      const bottom = r2 ?? 1000;
      return new FakeRange(this, top, c1, bottom - top + 1, c2 - c1 + 1);
    }
    return new FakeRange(this, a, b, c ?? 1, d ?? 1);
  }
  appendRow(v) { this.getRange(this.getLastRow() + 1, 1, 1, v.length).setValues([v]); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  /** Rows as plain arrays (for assertions). */
  dump() { return this.rows.map((r) => [...r]); }
}

export function loadScript({ fetch: fetchImpl } = {}) {
  const sheets = new Map();
  const props = new Map();
  const ss = new Proxy(
    {
      getSheetByName: (n) => sheets.get(n) ?? null,
      insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
      getSheets: () => [...sheets.values()],
      deleteSheet: (s) => sheets.delete(s.getName()),
      getActiveRange: () => null,
    },
    { get: (t, k) => (k in t ? t[k] : noop) },
  );

  const fetchLog = [];
  const triggers = [];
  const context = {
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getUi: () => { throw new Error('no ui in tests'); },
      newDataValidation: () => {
        const rule = new Proxy({}, { get: () => () => rule });
        return rule;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => randomUUID() },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => ({ body: s, json: () => JSON.parse(s) }) }),
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getProjectTriggers: () => triggers.map((h) => ({ getHandlerFunction: () => h, handler: h })),
      newTrigger: (h) => {
        const b = { timeBased: () => b, after: () => b, everyDays: () => b, atHour: () => b, create: () => triggers.push(h) };
        return b;
      },
      deleteTrigger: (t) => {
        const i = triggers.indexOf(t.handler);
        if (i >= 0) triggers.splice(i, 1);
      },
    },
    HtmlService: {
      createHtmlOutput: (html) => {
        const out = { html, title: '', setTitle: (x) => { out.title = x; return out; }, addMetaTag: () => out, getContent: () => html };
        return out;
      },
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetchLog.push({ url, opts });
        const r = fetchImpl ? fetchImpl(url, opts) : { code: 404, body: '' };
        return {
          getResponseCode: () => r.code ?? 200,
          getContentText: () => r.body ?? '',
          getAllHeaders: () => r.headers ?? {},
        };
      },
    },
  };
  vm.createContext(context);
  const code = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');
  // Expose top-level declarations on the context, like Apps Script's global scope.
  // Skip template strings (the Review page HTML has its own functions).
  const names = [...code.replace(/`[\s\S]*?`/g, '').matchAll(/^(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  vm.runInContext(`${code}\n;globalThis.__exports = { ${names.join(', ')} };`, context);
  return { gas: context.__exports, ss, sheets, props, fetchLog, triggers };
}
