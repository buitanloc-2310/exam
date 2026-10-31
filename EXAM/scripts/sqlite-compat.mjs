import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { Worker } from 'node:worker_threads';

let NativeDatabaseSync = null;
try {
  const mod = await import('node:sqlite');
  NativeDatabaseSync = mod.DatabaseSync;
} catch {
  NativeDatabaseSync = null;
}

let sharedWorker = null;
let sab = null;
let i32 = null;
let u8 = null;
let nextDbId = 1;

function ensureWorker() {
  if (sharedWorker) return;
  const workerCode = `
    const { parentPort } = require('node:worker_threads');
    const { spawn } = require('node:child_process');
    const NL = String.fromCharCode(10);
    const pyScript = [
      'import os, sys, json, sqlite3',
      'try:',
      '    os.closerange(3, 256)',
      'except Exception:',
      '    pass',
      'dbs = {}',
      'for line in sys.stdin:',
      '    line = line.strip()',
      '    if not line: continue',
      '    req = json.loads(line)',
      '    db_id = req.get("db")',
      '    op = req.get("op")',
      '    sql = req.get("sql", "")',
      '    params = req.get("params", [])',
      '    try:',
      '        if op == "open":',
      '            conn = sqlite3.connect(req.get("filename", ":memory:"), isolation_level=None)',
      '            conn.row_factory = sqlite3.Row',
      '            dbs[db_id] = conn',
      '            resp = {"ok": True}',
      '        elif op == "close":',
      '            if db_id in dbs:',
      '                dbs[db_id].close()',
      '                del dbs[db_id]',
      '            sys.stdout.write(json.dumps({"ok": True}) + chr(10))',
      '            sys.stdout.flush()',
      '            if not dbs:',
      '                os._exit(0)',
      '            continue',
      '        elif op == "exec":',
      '            conn = dbs[db_id]',
      '            stripped = sql.strip()',
      '            upper = stripped.upper()',
      '            if upper in ("BEGIN", "BEGIN;", "COMMIT", "COMMIT;", "ROLLBACK", "ROLLBACK;") or upper.startswith("CREATE TRIGGER") or upper.startswith("DROP TRIGGER"):',
      '                conn.execute(stripped)',
      '            else:',
      '                conn.executescript(sql)',
      '            resp = {"ok": True}',
      '        elif op == "get":',
      '            cur = dbs[db_id].execute(sql, params)',
      '            row = cur.fetchone()',
      '            resp = {"ok": True, "row": dict(row) if row is not None else None}',
      '        elif op == "all":',
      '            cur = dbs[db_id].execute(sql, params)',
      '            resp = {"ok": True, "rows": [dict(r) for r in cur.fetchall()]}',
      '        elif op == "run":',
      '            conn = dbs[db_id]',
      '            before = conn.total_changes',
      '            cur = conn.execute(sql, params)',
      '            resp = {"ok": True, "changes": conn.total_changes - before, "lastInsertRowid": cur.lastrowid}',
      '        else:',
      '            resp = {"ok": False, "error": "Unknown op: " + str(op)}',
      '    except Exception as e:',
      '        resp = {"ok": False, "error": str(e)}',
      '    sys.stdout.write(json.dumps(resp) + chr(10))',
      '    sys.stdout.flush()'
    ].join(NL);

    const py = spawn('python3', ['-u', '-c', pyScript], { stdio: ['pipe', 'pipe', 'ignore'] });
    py.unref();
    let buf = '';
    let currentResolve = null;
    py.stdout.on('data', chunk => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf(NL)) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (currentResolve) {
          const r = currentResolve;
          currentResolve = null;
          r(line);
        }
      }
    });
    parentPort.on('message', async ({ sab, payload }) => {
      const i32 = new Int32Array(sab, 0, 2);
      const u8 = new Uint8Array(sab, 8);
      const line = await new Promise(resolve => {
        currentResolve = resolve;
        py.stdin.write(payload + NL);
      });
      const bytes = Buffer.from(line, 'utf8');
      u8.set(bytes.subarray(0, bytes.byteLength));
      i32[1] = bytes.byteLength;
      Atomics.store(i32, 0, 1);
      Atomics.notify(i32, 0, 1);
    });
  `;
  sharedWorker = new Worker(workerCode, { eval: true });
  sharedWorker.unref();
  sab = new SharedArrayBuffer(8 * 1024 * 1024);
  i32 = new Int32Array(sab, 0, 2);
  u8 = new Uint8Array(sab, 8);
}

export class DatabaseSync {
  constructor(filename = ':memory:') {
    if (NativeDatabaseSync) {
      this._native = new NativeDatabaseSync(filename);
      return;
    }
    ensureWorker();
    this._dbId = nextDbId++;
    this._rpc({ db: this._dbId, op: 'open', filename });
  }

  _rpc(payload) {
    Atomics.store(i32, 0, 0);
    sharedWorker.postMessage({ sab, payload: JSON.stringify(payload) });
    Atomics.wait(i32, 0, 0);
    const len = i32[1];
    const raw = Buffer.from(u8.buffer, 8, len).toString('utf8');
    const res = JSON.parse(raw);
    if (!res.ok) {
      throw new Error(res.error || 'SQLite error');
    }
    return res;
  }

  exec(sql) {
    if (this._native) return this._native.exec(sql);
    this._rpc({ db: this._dbId, op: 'exec', sql: String(sql) });
  }

  prepare(sql) {
    if (this._native) return this._native.prepare(sql);
    const self = this;
    const query = String(sql);
    const normalizeParams = args =>
      args.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
    return {
      get(...args) {
        return self._rpc({ db: self._dbId, op: 'get', sql: query, params: normalizeParams(args) }).row ?? undefined;
      },
      all(...args) {
        return self._rpc({ db: self._dbId, op: 'all', sql: query, params: normalizeParams(args) }).rows || [];
      },
      run(...args) {
        const r = self._rpc({ db: self._dbId, op: 'run', sql: query, params: normalizeParams(args) });
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      }
    };
  }

  close() {
    if (this._native) return this._native.close();
    try {
      this._rpc({ db: this._dbId, op: 'close' });
    } catch {}
  }
}
