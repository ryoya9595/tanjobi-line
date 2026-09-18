/**
 * LINEから顧客台帳を操作する Webhook（Vercel Serverless Function）
 *
 * 占い師がスマホのLINEに「山田花子 1990/06/23 転職相談」と送ると、
 * GitHub の private リポジトリにある data/customers.csv に1行足す。
 * 毎朝 GitHub Actions がそのCSVを読んで、誕生日の人をLINEに通知する。
 * ＝ 登録も通知も、同じトーク画面で完結する。
 *
 * ■ 安全設計（`line-webhook-receiver` と同じ思想）
 * - LINEの署名検証（HMAC-SHA256）を通ったものだけ処理する
 * - さらに ALLOWED_USER_ID と一致する送信者のみ。他人からのメッセージは黙って無視する
 * - メッセージ本文は「コマンド判定」と「台帳への記録」にしか使わない。
 *   AIにも外部コマンドにも渡さない（本文に指示文が書かれていても実行されない）
 * - CSVに書く値は、表計算ソフトで数式として動かないようにエスケープする
 *
 * ■ 環境変数（Vercel のプロジェクト設定で入れる）
 *   LINE_CHANNEL_SECRET        … 署名検証用
 *   LINE_CHANNEL_ACCESS_TOKEN  … 返信用
 *   ALLOWED_USER_ID            … 操作を受け付けるユーザーID（本人だけ）
 *   GITHUB_TOKEN               … Contents API 用 PAT（contents: read and write）
 *   GITHUB_REPO                … owner/repo
 *   GITHUB_BRANCH              … 既定 main
 *   CSV_PATH                   … 既定 data/customers.csv
 *   WORKFLOW_FILE              … 既定 birthday.yml（「今日」で即チェックするとき用）
 */

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const DEFAULTS = {
  branch: 'main',
  csvPath: 'data/customers.csv',
  workflow: 'birthday.yml',
};

const CSV_HEADER = ['name', 'birthday', 'last_visit', 'memo'];

// ---------------------------------------------------------------- entry

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.error('LINE_CHANNEL_SECRET not configured');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const rawBody = await getRawBody(req);
  const expected = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64');
  if (req.headers['x-line-signature'] !== expected) {
    console.error('Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  const results = [];

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    // 本人以外は黙って無視（存在を悟らせない）
    const allowed = process.env.ALLOWED_USER_ID;
    if (!allowed || event.source?.userId !== allowed) {
      console.warn('Message from non-allowed user, ignored');
      continue;
    }

    try {
      const reply = await handleText(String(event.message.text || ''));
      await replyLine(event.replyToken, reply);
      results.push({ ok: true });
    } catch (e) {
      console.error('Failed to handle event:', e);
      await replyLine(
        event.replyToken,
        `うまく処理できませんでした。\n\n${String(e).slice(0, 300)}`
      ).catch(() => {});
      results.push({ ok: false, error: String(e) });
    }
  }

  return res.status(200).json({ received: events.length, results });
}

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------- commands

const USAGE = [
  '【使い方】',
  '',
  '▼ 登録する',
  '　山田花子 1990/06/23 転職と人間関係',
  '　（名前・生年月日・メモ。メモは省略できます）',
  '',
  '▼ 鑑定のあとにメモを更新する',
  '　メモ 山田花子 恋愛の相談。年内に判断したいとのこと',
  '　→ 前回の鑑定日が今日になります',
  '',
  '▼ そのほか',
  '　一覧　　　… 直近の登録を10名まで表示',
  '　今日　　　… 今日が誕生日の人をすぐ確認',
  '　削除 山田花子',
  '　更新 山田花子 1990/06/23 …（登録済みの内容を上書き）',
].join('\n');

async function handleText(raw) {
  const text = raw.trim();
  if (!text) return USAGE;

  if (/^(使い方|ヘルプ|help|？|\?)$/i.test(text)) return USAGE;
  if (/^(一覧|リスト|list)$/i.test(text)) return await listCustomers();
  if (/^(今日|今日の誕生日|チェック|確認)$/.test(text)) return await runCheckNow();

  let m = text.match(/^メモ[\s　]+(.+)$/s);
  if (m) return await updateMemo(m[1].trim());

  m = text.match(/^削除[\s　]+(.+)$/s);
  if (m) return await deleteCustomer(m[1].trim());

  m = text.match(/^更新[\s　]+(.+)$/s);
  if (m) return await register(m[1].trim(), true);

  return await register(text, false);
}

// ---------------------------------------------------------------- 登録

/** 「山田花子 1990/06/23 転職相談」→ { name, birthday, memo } */
export function parseRegistration(text) {
  const tokens = text.split(/[\s　]+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const dateIndex = tokens.findIndex((t) => normalizeBirthday(t) !== null);
  if (dateIndex === -1) return null;

  const birthday = normalizeBirthday(tokens[dateIndex]);

  let name;
  let memo;
  if (dateIndex === 0) {
    // 日付が先頭「1990/06/23 山田花子 転職相談」
    name = tokens[1];
    memo = tokens.slice(2).join(' ');
  } else {
    // 日付より前は全部が名前（「山田 花子 1990/06/23 …」に対応）
    name = tokens.slice(0, dateIndex).join(' ');
    memo = tokens.slice(dateIndex + 1).join(' ');
  }

  if (!name) return null;
  return { name, birthday, memo };
}

async function register(text, force) {
  const parsed = parseRegistration(text);
  if (!parsed) {
    return [
      '生年月日が読み取れませんでした。',
      '',
      'こんな形で送ってください：',
      '　山田花子 1990/06/23 転職と人間関係',
      '',
      '（生まれ年が分からないときは「山田花子 6/23」でもOKです）',
    ].join('\n');
  }

  const { rows, sha } = await readCsv();
  const existing = rows.findIndex((r) => r.name === parsed.name);

  if (existing !== -1 && !force) {
    const old = rows[existing];
    if (old.birthday === parsed.birthday) {
      return `「${parsed.name}」さんは登録済みです（${formatBirthday(old.birthday)}）。\n\nメモを更新するなら：\n　メモ ${parsed.name} 内容`;
    }
    return [
      `「${parsed.name}」さんは別の生年月日で登録済みです。`,
      `　いま： ${formatBirthday(old.birthday)}`,
      `　今回： ${formatBirthday(parsed.birthday)}`,
      '',
      '上書きするなら、先頭に「更新」を付けて送ってください：',
      `　更新 ${text}`,
    ].join('\n');
  }

  const row = {
    name: parsed.name,
    birthday: parsed.birthday,
    last_visit: todayJst(),
    memo: parsed.memo || (existing !== -1 ? rows[existing].memo : ''),
  };

  if (existing !== -1) rows[existing] = row;
  else rows.push(row);

  await writeCsv(rows, sha, `${existing !== -1 ? '更新' : '登録'}: ${parsed.name}`);

  const lines = [
    `${existing !== -1 ? '✏️ 更新しました' : '✅ 登録しました'}`,
    '',
    `お名前　　： ${row.name}`,
    `生年月日　： ${formatBirthday(row.birthday)}${ageText(row.birthday)}`,
  ];
  if (row.memo) lines.push(`メモ　　　： ${row.memo}`);
  lines.push('', `台帳は ${rows.length}名になりました。`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- メモ更新

async function updateMemo(rest) {
  const { rows, sha } = await readCsv();
  const found = matchByName(rows, rest);

  if (found.error) return found.error;

  const row = rows[found.index];
  const memo = rest.slice(found.matchedLength).trim();
  if (!memo) {
    return `メモの内容も一緒に送ってください。\n　例： メモ ${row.name} 恋愛の相談`;
  }

  row.memo = memo;
  row.last_visit = todayJst();
  await writeCsv(rows, sha, `メモ更新: ${row.name}`);

  return [
    '📝 メモを更新しました',
    '',
    `お名前　　： ${row.name}`,
    `前回鑑定日： ${row.last_visit}`,
    `メモ　　　： ${row.memo}`,
    '',
    '次の誕生日のときに、この内容が一緒に届きます。',
  ].join('\n');
}

// ---------------------------------------------------------------- 削除

async function deleteCustomer(rest) {
  const { rows, sha } = await readCsv();
  const found = matchByName(rows, rest);
  if (found.error) return found.error;

  const [removed] = rows.splice(found.index, 1);
  await writeCsv(rows, sha, `削除: ${removed.name}`);

  const restore = [removed.name, removed.birthday, removed.memo]
    .filter(Boolean)
    .join(' ');
  return [
    `🗑 「${removed.name}」さんを台帳から外しました。`,
    `残り ${rows.length}名です。`,
    '',
    '戻したいときは、これをそのまま送ってください：',
    `　${restore}`,
  ].join('\n');
}

/** 台帳から名前で1件を特定する。前方一致 → 部分一致の順に見る。 */
function matchByName(rows, text) {
  if (rows.length === 0) return { error: '台帳がまだ空です。' };

  const exact = rows.findIndex((r) => text === r.name || text.startsWith(r.name + ' ') || text.startsWith(r.name + '　'));
  if (exact !== -1) return { index: exact, matchedLength: rows[exact].name.length };

  const noSpace = text.replace(/[\s　]/g, '');
  const hits = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => noSpace.startsWith(r.name.replace(/[\s　]/g, '')));
  if (hits.length === 1) {
    return { index: hits[0].i, matchedLength: hits[0].r.name.length };
  }
  if (hits.length > 1) {
    return {
      error:
        '同じ名前の方が複数います。フルネームで送ってください：\n' +
        hits.map(({ r }) => `　${r.name}（${formatBirthday(r.birthday)}）`).join('\n'),
    };
  }

  const partial = rows.filter((r) => noSpace.includes(r.name.replace(/[\s　]/g, '')));
  if (partial.length === 1) {
    return {
      index: rows.indexOf(partial[0]),
      matchedLength: partial[0].name.length,
    };
  }

  return {
    error: `「${text.split(/[\s　]/)[0]}」さんが台帳に見つかりません。\n\n「一覧」で登録済みの方を確認できます。`,
  };
}

// ---------------------------------------------------------------- 一覧・即チェック

async function listCustomers() {
  const { rows } = await readCsv();
  if (rows.length === 0) {
    return ['台帳はまだ空です。', '', 'こんな形で登録できます：', '　山田花子 1990/06/23 転職と人間関係'].join('\n');
  }

  const recent = rows.slice(-10).reverse();
  const lines = [`📒 台帳 ${rows.length}名（新しい順に10名まで）`, ''];
  for (const r of recent) {
    lines.push(`・${r.name}　${formatBirthday(r.birthday)}${ageText(r.birthday)}`);
    if (r.memo) lines.push(`　${r.memo.slice(0, 40)}`);
  }
  return lines.join('\n');
}

async function runCheckNow() {
  const repo = requireEnv('GITHUB_REPO');
  const token = requireEnv('GITHUB_TOKEN');
  const workflow = process.env.WORKFLOW_FILE || DEFAULTS.workflow;
  const branch = process.env.GITHUB_BRANCH || DEFAULTS.branch;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: githubHeaders(token),
      body: JSON.stringify({ ref: branch, inputs: {} }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) {
      throw new Error(
        'GitHubに拒否されました（403）。PATに Actions の書き込み権限が足りていません。'
      );
    }
    throw new Error(`GitHub dispatch ${res.status}: ${body.slice(0, 200)}`);
  }

  return '🔎 今日が誕生日の方を確認しています。\n該当する方がいれば、1分ほどで通知が届きます。\n（いなければ何も届きません）';
}

// ---------------------------------------------------------------- GitHub CSV

async function readCsv() {
  const repo = requireEnv('GITHUB_REPO');
  const token = requireEnv('GITHUB_TOKEN');
  const path = process.env.CSV_PATH || DEFAULTS.csvPath;
  const branch = process.env.GITHUB_BRANCH || DEFAULTS.branch;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
    { headers: githubHeaders(token) }
  );

  if (res.status === 404) return { rows: [], sha: null };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`台帳を読めませんでした（${res.status}）: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = Buffer.from(json.content, 'base64').toString('utf8');
  return { rows: parseCsv(text), sha: json.sha };
}

async function writeCsv(rows, sha, message) {
  const repo = requireEnv('GITHUB_REPO');
  const token = requireEnv('GITHUB_TOKEN');
  const path = process.env.CSV_PATH || DEFAULTS.csvPath;
  const branch = process.env.GITHUB_BRANCH || DEFAULTS.branch;

  const body = {
    message: `[LINE] ${message}`,
    content: Buffer.from(buildCsv(rows), 'utf8').toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: githubHeaders(token),
    body: JSON.stringify(body),
  });

  if (res.ok) return;

  const text = await res.text();
  if (res.status === 409) {
    throw new Error('台帳が同時に更新されました。もう一度送ってください。');
  }
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      `GitHubに書き込めませんでした（${res.status}）。PATの権限（Contents: Read and write）と、リポジトリ名を確認してください。`
    );
  }
  throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
}

function githubHeaders(token) {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'tanjobi-line-webhook',
  };
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} が設定されていません（Vercel の環境変数）`);
  return v;
}

// ---------------------------------------------------------------- CSV

export function parseCsv(text) {
  const lines = splitCsvLines(text);
  if (lines.length === 0) return [];

  const header = lines[0].map((h) => h.trim());
  const idx = {};
  CSV_HEADER.forEach((k) => { idx[k] = header.indexOf(k); });

  const rows = [];
  for (const cells of lines.slice(1)) {
    const get = (k) => (idx[k] >= 0 && idx[k] < cells.length ? cells[idx[k]].trim() : '');
    const name = get('name');
    if (!name) continue;
    rows.push({
      name,
      birthday: get('birthday'),
      last_visit: get('last_visit'),
      memo: get('memo'),
    });
  }
  return rows;
}

/** クォート（"" のエスケープ、改行を含むフィールド）に対応した最小限のCSVパーサ。 */
function splitCsvLines(text) {
  const out = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      if (row.some((v) => v !== '')) out.push(row);
      row = []; field = '';
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) out.push(row);

  return out;
}

export function buildCsv(rows) {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(CSV_HEADER.map((k) => csvCell(r[k])).join(','));
  }
  return lines.join('\n') + '\n';
}

// 正規化済みの日付（1990-06-23 / 年なしの --06-23）
const NORMALIZED_DATE = /^(?:\d{4}-|--)\d{1,2}-\d{1,2}$/;

function csvCell(value) {
  let s = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  // 表計算ソフトで数式として実行されないようにする。
  // ただし年なしの誕生日 `--06-23` は `-` 始まりなので素通しする（`'--06-23` に化けるため）
  if (!NORMALIZED_DATE.test(s) && /^[=+\-@\t]/.test(s)) s = "'" + s;
  if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---------------------------------------------------------------- 日付

/** 生年月日らしき文字列を `YYYY-MM-DD` / `--MM-DD`（年なし）に正規化する。 */
export function normalizeBirthday(value) {
  if (!value) return null;

  let s = String(value).trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/／/g, '/').replace(/[－ー−]/g, '-').replace(/．/g, '.')
    .replace(/[　 ]/g, ' ')
    .trim();

  let m = s.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
  if (m) return fmt(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return fmt(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[/\-.月](\d{1,2})日?$/);
  if (m) return fmt(null, +m[1], +m[2]);

  return null;
}

function fmt(year, month, day) {
  if (!(month >= 1 && month <= 12)) return null;
  if (!(day >= 1 && day <= 31)) return null;
  if (year !== null && !(year >= 1900 && year <= 2100)) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return year === null ? `--${mm}-${dd}` : `${year}-${mm}-${dd}`;
}

export function formatBirthday(value) {
  const m = String(value || '').match(/^(?:(\d{4})-|--)(\d{2})-(\d{2})$/);
  if (!m) return String(value || '');
  return m[1] ? `${m[1]}年${+m[2]}月${+m[3]}日` : `${+m[2]}月${+m[3]}日`;
}

function ageText(birthday) {
  const m = String(birthday || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const today = new Date(Date.now() + 9 * 3600 * 1000);
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)) age--;
  return `（${age}歳）`;
}

function todayJst() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- LINE返信

const QUICK_REPLY = {
  items: [
    { type: 'action', action: { type: 'message', label: '📒 一覧', text: '一覧' } },
    { type: 'action', action: { type: 'message', label: '🎂 今日', text: '今日' } },
    { type: 'action', action: { type: 'message', label: '❓ 使い方', text: '使い方' } },
  ],
};

async function replyLine(replyToken, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !replyToken) return;

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: text.slice(0, 4900), quickReply: QUICK_REPLY }],
    }),
  });

  if (!res.ok) {
    console.error('LINE reply failed:', res.status, await res.text());
  }
}
