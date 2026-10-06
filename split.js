// 旅行费用分摊规则（纯函数，浏览器与 Node 共用；不读文件、不碰界面）。
// 规则：外币按行程固定汇率换成人民币 → 每笔按「平均分」或「按人日」分到人
//      → 零头用最大余数法补齐、分摊之和等于原金额 → 每人净额 = 已付 − 应付
//      → 用最少的转账笔数结清。

const CNY = "CNY";

function round2(x) { return Math.round(x * 100) / 100; }
function toCents(x) { return Math.round(x * 100); }

// 规则 2：外币换算。rates 形如 { JPY: 0.048 }，表示 1 日元 = 0.048 元；人民币不换。
function convert(amount, currency, rates) {
  if (!(Number.isFinite(amount) && amount > 0)) throw new Error(`金额必须是大于 0 的数：${amount}`);
  if (currency === CNY) return round2(amount);
  const rate = rates && rates[currency];
  if (!(Number.isFinite(rate) && rate > 0)) throw new Error(`没有 ${currency} 的汇率，或汇率不是大于 0 的数`);
  return round2(amount * rate);
}

// 规则 3：按权重分钱，分到「分」；余数按最大余数法补给小数部分最大的人（相同时按名单顺序）。
function splitByWeights(amountCny, names, weights) {
  if (!names || names.length === 0) throw new Error("参与人不能为空");
  const totalW = weights.reduce((s, w) => s + w, 0);
  if (!(totalW > 0)) throw new Error("参与人的权重（人数或人日）之和必须大于 0");
  const cents = toCents(amountCny);
  const raw = weights.map(w => cents * w / totalW);
  const floors = raw.map(Math.floor);
  let left = cents - floors.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) floors[order[k].i] += 1;
  const out = {};
  names.forEach((n, i) => { out[n] = floors[i] / 100; });
  return out;
}

// 规则 1（平均分）：参与人每人一份。
function splitEqual(amountCny, names) {
  return splitByWeights(amountCny, names, names.map(() => 1));
}

// 规则 1（按人日）：days 形如 { 阿明: 4, 丹丹: 2 }，谁住几晚就按几晚算。
function splitByDays(amountCny, days) {
  const names = Object.keys(days);
  const weights = names.map(n => days[n]);
  if (weights.some(d => !(Number.isFinite(d) && d > 0))) throw new Error("每个人的人日必须大于 0");
  return splitByWeights(amountCny, names, weights);
}

// 规则 4：算每个人的应付、已付与净额。expense: { title, amount, currency, payer, participants?, days? }
function computeBalances(trip) {
  const { members, rates = {}, expenses = [] } = trip;
  if (!members || members.length === 0) throw new Error("同行名单不能为空");
  const owed = {}, paid = {};
  members.forEach(m => { owed[m] = 0; paid[m] = 0; });
  const detail = [];
  for (const e of expenses) {
    if (!members.includes(e.payer)) throw new Error(`付款人 ${e.payer} 不在同行名单里`);
    const cny = convert(e.amount, e.currency || CNY, rates);
    let shares;
    if (e.days) {
      for (const n of Object.keys(e.days)) if (!members.includes(n)) throw new Error(`参与人 ${n} 不在同行名单里`);
      shares = splitByDays(cny, e.days);
    } else {
      const ps = e.participants && e.participants.length ? e.participants : members;
      for (const n of ps) if (!members.includes(n)) throw new Error(`参与人 ${n} 不在同行名单里`);
      shares = splitEqual(cny, ps);
    }
    paid[e.payer] = round2(paid[e.payer] + cny);
    for (const n of Object.keys(shares)) owed[n] = round2(owed[n] + shares[n]);
    detail.push({ title: e.title, cny, payer: e.payer, shares });
  }
  const net = {};
  members.forEach(m => { net[m] = round2(paid[m] - owed[m]); });
  return { owed, paid, net, detail, total: round2(detail.reduce((s, d) => s + d.cny, 0)) };
}

// 规则 5：最少转账笔数——每次让欠得最多的人付给该收最多的人，最多 n−1 笔。
function settle(net) {
  const creditors = Object.entries(net).filter(([, v]) => v > 0).map(([n, v]) => ({ n, c: toCents(v) }));
  const debtors = Object.entries(net).filter(([, v]) => v < 0).map(([n, v]) => ({ n, c: -toCents(v) }));
  const sum = creditors.reduce((s, x) => s + x.c, 0) - debtors.reduce((s, x) => s + x.c, 0);
  if (sum !== 0) throw new Error(`净额加起来不为 0（差 ${sum / 100} 元），先检查每笔费用`);
  const transfers = [];
  creditors.sort((a, b) => b.c - a.c); debtors.sort((a, b) => b.c - a.c);
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const c = Math.min(debtors[i].c, creditors[j].c);
    if (c > 0) transfers.push({ from: debtors[i].n, to: creditors[j].n, amount: c / 100 });
    debtors[i].c -= c; creditors[j].c -= c;
    if (debtors[i].c === 0) i++;
    if (creditors[j].c === 0) j++;
  }
  return transfers;
}

function summarize(trip) {
  const b = computeBalances(trip);
  return { ...b, transfers: settle(b.net) };
}

if (typeof module !== "undefined")
  module.exports = { convert, splitEqual, splitByDays, computeBalances, settle, summarize, round2 };
