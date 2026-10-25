import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let NativeDatabaseSync = null;
try {
  const mod = await import('node:sqlite');
  NativeDatabaseSync = mod.DatabaseSync;
} catch {
  NativeDatabaseSync = null;
}

export class DatabaseSync {
  constructor(filename = ':memory:') {
    if (NativeDatabaseSync) {
      this._native = new NativeDatabaseSync(filename);
      return;
    }
    const id = crypto.randomUUID();
    this._dir = fs.mkdtempSync(path.join(os.tmpdir(), `exam-sqlite-${id}-`));
    this._reqPipe = path.join(this._dir, 'req.fifo');
    this._resPipe = path.join(this._dir, 'res.fifo');
    this._scriptPath = path.join(this._dir, 'daemon.py');

    fs.writeFileSync(
      this._scriptPath,
      `import os, sys, sqlite3, json

req_pipe = sys.argv[1]
res_pipe = sys.argv[2]
db_target = sys.argv[3]

os.mkfifo(req_pipe)
os.mkfifo(res_pipe)

with open(res_pipe, 'w') as fw:
    fw.write('{"ready":true}\\n')

conn = sqlite3.connect(db_target, isolation_level=None)
conn.row_factory = sqlite3.Row

while True:
    with open(req_pipe, 'r') as fr:
        data = fr.read()
    if not data:
        continue
    req = json.loads(data)
    op = req.get("op")
    sql = req.get("sql", "")
    params = req.get("params", [])
    try:
        if op == "exec":
            stripped = sql.strip()
            upper = stripped.upper()
            if upper in ("BEGIN", "BEGIN;", "COMMIT", "COMMIT;", "ROLLBACK", "ROLLBACK;") or upper.startswith("CREATE TRIGGER") or upper.startswith("DROP TRIGGER"):
                conn.execute(stripped)
            else:
                conn.executescript(sql)
            resp = {"ok": True}
        elif op == "get":
            cur = conn.execute(sql, params)
            row = cur.fetchone()
            resp = {"ok": True, "row": dict(row) if row is not None else None}
        elif op == "all":
            cur = conn.execute(sql, params)
            rows = [dict(r) for r in cur.fetchall()]
            resp = {"ok": True, "rows": rows}
        elif op == "run":
            before = conn.total_changes
            cur = conn.execute(sql, params)
            changes = conn.total_changes - before
            resp = {"ok": True, "changes": changes, "lastInsertRowid": cur.lastrowid}
        elif op == "close":
            conn.close()
            with open(res_pipe, 'w') as fw:
                fw.write(json.dumps({"ok": True}) + "\\n")
            break
        else:
            resp = {"ok": False, "error": f"Unknown op: {op}"}
    except Exception as e:
        resp = {"ok": False, "error": str(e)}
    with open(res_pipe, 'w') as fw:
        fw.write(json.dumps(resp) + "\\n")
`,
      'utf8'
    );

    this._proc = spawn('python3', ['-u', this._scriptPath, this._reqPipe, this._resPipe, filename], {
      stdio: 'ignore'
    });

    while (!fs.existsSync(this._resPipe)) {}
    const readyRaw = fs.readFileSync(this._resPipe, 'utf8');
    const ready = JSON.parse(readyRaw.trim());
    if (!ready.ready) {
      throw new Error('Failed to start Python SQLite bridge');
    }
  }

  _rpc(payload) {
    fs.writeFileSync(this._reqPipe, JSON.stringify(payload), 'utf8');
    const raw = fs.readFileSync(this._resPipe, 'utf8');
    const res = JSON.parse(raw.trim());
    if (!res.ok) {
      throw new Error(res.error || 'SQLite error');
    }
    return res;
  }

  exec(sql) {
    if (this._native) return this._native.exec(sql);
    this._rpc({ op: 'exec', sql });
  }

  prepare(sql) {
    if (this._native) return this._native.prepare(sql);
    const self = this;
    return {
      get(...params) {
        const res = self._rpc({ op: 'get', sql, params });
        return res.row ?? undefined;
      },
      all(...params) {
        const res = self._rpc({ op: 'all', sql, params });
        return res.rows || [];
      },
      run(...params) {
        const res = self._rpc({ op: 'run', sql, params });
        return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
      }
    };
  }

  close() {
    if (this._native) return this._native.close();
    try { this._rpc({ op: 'close' }); } catch {}
    try { this._proc.kill(); } catch {}
    try { fs.rmSync(this._dir, { recursive: true, force: true }); } catch {}
  }
}
