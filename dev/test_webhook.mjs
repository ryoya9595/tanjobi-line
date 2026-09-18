/**
 * Webhook のメッセージ解釈とCSV入出力の検証（納品物ではない）。
 *
 *   node dev/test_webhook.mjs
 *
 * LINEにもGitHubにも接続しない。webhook/api/webhook.js を直したら必ず実行する。
 * 最後に「JSが書いたCSVをPythonが読めるか」まで通しで確かめる（ここがズレると、
 * 登録はできるのに通知が飛ばない、という一番わかりにくい壊れ方をする）。
 */

import { writeFileSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

import { existsSync } from 'fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// Zipを解いた直後は kit/scripts/、リポジトリに配置したあとは scripts/ にある
const SCRIPTS = existsSync(path.join(ROOT, 'kit', 'scripts'))
  ? path.join(ROOT, 'kit', 'scripts')
  : path.join(ROOT, 'scripts');

const {
  parseRegistration, normalizeBirthday, parseCsv, buildCsv, formatBirthday,
} = await import(path.join(ROOT, 'webhook', 'api', 'webhook.js'));

let ng = 0;
function ok(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else { ng++; console.log(`  NG   ${label}\n       期待 ${e}\n       実際 ${a}`); }
}

console.log('\n■ 生年月日の正規化');
ok('1990/06/23', normalizeBirthday('1990/06/23'), '1990-06-23');
ok('1990-6-23', normalizeBirthday('1990-6-23'), '1990-06-23');
ok('1990年6月23日', normalizeBirthday('1990年6月23日'), '1990-06-23');
ok('19900623', normalizeBirthday('19900623'), '1990-06-23');
ok('全角', normalizeBirthday('１９９０／６／２３'), '1990-06-23');
ok('年なし 6/23', normalizeBirthday('6/23'), '--06-23');
ok('年なし 6月23日', normalizeBirthday('6月23日'), '--06-23');
ok('13月はnull', normalizeBirthday('1990/13/01'), null);
ok('32日はnull', normalizeBirthday('1990/12/32'), null);
ok('ただの名前はnull', normalizeBirthday('山田花子'), null);
ok('電話番号はnull', normalizeBirthday('09012345678'), null);

console.log('\n■ 登録メッセージの読み取り');
ok('名前 日付 メモ',
  parseRegistration('山田花子 1990/06/23 転職と人間関係'),
  { name: '山田花子', birthday: '1990-06-23', memo: '転職と人間関係' });
ok('姓名のあいだに空白',
  parseRegistration('山田 花子 1990/06/23 転職相談'),
  { name: '山田 花子', birthday: '1990-06-23', memo: '転職相談' });
ok('メモなし',
  parseRegistration('山田花子 1990/06/23'),
  { name: '山田花子', birthday: '1990-06-23', memo: '' });
ok('日付が先頭',
  parseRegistration('1990/06/23 山田花子 転職相談'),
  { name: '山田花子', birthday: '1990-06-23', memo: '転職相談' });
ok('年なし',
  parseRegistration('山田花子 6/23'),
  { name: '山田花子', birthday: '--06-23', memo: '' });
ok('メモが長文',
  parseRegistration('山田花子 1990/06/23 転職と人間関係。9月が動く時期と伝えた'),
  { name: '山田花子', birthday: '1990-06-23', memo: '転職と人間関係。9月が動く時期と伝えた' });
ok('全角スペース区切り',
  parseRegistration('山田花子　1990/06/23　転職相談'),
  { name: '山田花子', birthday: '1990-06-23', memo: '転職相談' });
ok('日付がなければnull', parseRegistration('山田花子 転職の相談'), null);
ok('1語だけならnull', parseRegistration('山田花子'), null);

console.log('\n■ 表示用の整形');
ok('年あり', formatBirthday('1990-06-23'), '1990年6月23日');
ok('年なし', formatBirthday('--06-23'), '6月23日');

console.log('\n■ CSVの読み書き');
const rows = [
  { name: '山田 花子', birthday: '1990-06-23', last_visit: '2026-07-12', memo: '転職と人間関係' },
  { name: '佐藤,あかり', birthday: '--02-29', last_visit: '', memo: 'カンマ,と"引用"入り' },
  { name: '危険 太郎', birthday: '1985-12-01', last_visit: '', memo: '=HYPERLINK("http://evil")' },
];
const csv = buildCsv(rows);
const back = parseCsv(csv);
ok('往復で件数が合う', back.length, 3);
ok('カンマ入りの名前', back[1].name, '佐藤,あかり');
ok('引用符とカンマ入りのメモ', back[1].memo, 'カンマ,と"引用"入り');
ok('年なしの誕生日が壊れない', back[1].birthday, '--02-29');
ok('数式はエスケープされる', back[2].memo, '\'=HYPERLINK("http://evil")');
ok('ヘッダーが正しい', csv.split('\n')[0], 'name,birthday,last_visit,memo');
ok('空のCSVは空配列', parseCsv('name,birthday,last_visit,memo\n'), []);
ok('末尾の空行を無視', parseCsv('name,birthday,last_visit,memo\n山田,1990-06-23,,\n\n').length, 1);

console.log('\n■ JSが書いたCSVを、Python側が同じように読めるか（通し）');
const tmp = path.join(HERE, '_tmp_bridge.csv');
writeFileSync(tmp, csv, 'utf8');
try {
  const out = execFileSync('python3', ['-c', `
import sys, json
sys.path.insert(0, ${JSON.stringify(SCRIPTS)})
import customers as db
rows = db.load(${JSON.stringify(tmp)})
print(json.dumps([
    {"name": r.name, "birthday": r.birthday, "memo": r.memo,
     "parsed": None if r.parsed_birthday() is None else
               [r.parsed_birthday().year, r.parsed_birthday().month, r.parsed_birthday().day]}
    for r in rows
], ensure_ascii=False))
`], { encoding: 'utf8' });
  const py = JSON.parse(out.trim().split('\n').pop());
  ok('Pythonも3名として読む', py.length, 3);
  ok('名前が一致', py.map((r) => r.name), rows.map((r) => r.name));
  ok('年ありの誕生日を解釈できる', py[0].parsed, [1990, 6, 23]);
  ok('年なしの誕生日を解釈できる', py[1].parsed, [null, 2, 29]);
  ok('メモが一致', py[1].memo, 'カンマ,と"引用"入り');
} catch (e) {
  ng++;
  console.log('  NG   Python側の読み取りに失敗\n', String(e.stderr || e).slice(0, 500));
} finally {
  try { unlinkSync(tmp); } catch {}
}

console.log(ng === 0 ? '\n✅ すべて通りました\n' : `\n❌ ${ng}件 失敗しています\n`);
process.exit(ng === 0 ? 0 : 1);
