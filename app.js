
const $=id=>document.getElementById(id);
const KEY="stockDashboardV3";
const THEME_KEY="alphaPilotTheme";
const DEFAULT={holdings:[],pledges:[],cashPositions:[],cashTwd:0,cashUsd:0,fxRate:32.5,fxRates:{TWD:1,USD:32.5},finnhubKey:"",history:[],targetWeights:{},allocationGroups:[],targetBeta:1.20,fixedExpenses:[]};
let state=(()=>{try{return {...DEFAULT,...JSON.parse(localStorage.getItem(KEY)||"{}")}}catch{return {...DEFAULT}}})();
state.holdings=(state.holdings||[]).map(h=>({...h,betaManual:Boolean(h.betaManual),stalePrice:Boolean(h.stalePrice)}));
state.allocationGroups=Array.isArray(state.allocationGroups)?state.allocationGroups:[];
state.allocationGroups=state.allocationGroups.map((g,i)=>({id:String(g.id||`group-${Date.now()}-${i}`),name:String(g.name||`群組 ${i+1}`).trim(),target:Math.max(0,Math.min(100,Number(g.target)||0)),members:[...new Set((Array.isArray(g.members)?g.members:[]).map(x=>String(x||"").toUpperCase()).filter(Boolean))]}));
state.cashPositions=Array.isArray(state.cashPositions)?state.cashPositions:[];
if(!state.cashPositions.length){
  if(Number(state.cashTwd)>0)state.cashPositions.push({currency:"TWD",amount:Number(state.cashTwd)});
  if(Number(state.cashUsd)>0)state.cashPositions.push({currency:"USD",amount:Number(state.cashUsd)});
}
state.cashPositions=state.cashPositions.map(x=>({currency:String(x.currency||"").toUpperCase(),amount:Math.max(0,Number(x.amount)||0)})).filter(x=>x.currency&&x.amount>0);
state.fxRates={TWD:1,USD:Number(state.fxRate)||32.5,...(state.fxRates||{})};
state.pledges=Array.isArray(state.pledges)?state.pledges:[];
state.fixedExpenses=Array.isArray(state.fixedExpenses)?state.fixedExpenses:[];
state.fixedExpenses=state.fixedExpenses.map((x,i)=>({
  id:String(x.id||`expense-${Date.now()}-${i}`),
  name:String(x.name||"").trim(),
  startDate:String(x.startDate||""),
  principal:Math.max(0,Number(x.principal)||0),
  // V10.0.1 uses months. Legacy year-based records are converted automatically.
  termMonths:Math.max(0,Math.round(Number(x.termMonths ?? (Number(x.termYears)||0)*12)||0)),
  graceMonths:Math.max(0,Math.round(Number(x.graceMonths ?? (Number(x.graceYears)||0)*12)||0)),
  annualRate:Math.max(0,Number(x.annualRate)||0),
  sharePercent:Math.max(0,Math.min(100,Number(x.sharePercent ?? 100)||0))
})).filter(x=>x.name&&x.startDate&&x.principal>0&&x.termMonths>0);

// Migrate V8.7 per-holding pledge values into the new independent pledge list once.
if(!state.pledges.length){
  state.pledges=state.holdings.filter(h=>Number(h.pledgeAmount)>0).map((h,i)=>({
    id:`migrated-${Date.now()}-${i}`,
    symbol:String(h.symbol||"").toUpperCase(),
    amount:Number(h.pledgeAmount)||0,
    rate:Number(h.pledgeRate)||0
  }));
}
state.pledges=state.pledges.map((x,i)=>({id:x.id||`pledge-${Date.now()}-${i}`,symbol:String(x.symbol||"").trim().toUpperCase(),amount:Math.max(0,Number(x.amount)||0),rate:Math.max(0,Number(x.rate)||0)})).filter(x=>x.symbol&&x.amount>0);
const n=v=>Number.isFinite(Number(v))?Number(v):0;
state.targetBeta=Math.max(0.1,Math.min(3,n(state.targetBeta||1.20)));
const money=(v,c="TWD")=>new Intl.NumberFormat("zh-TW",{style:"currency",currency:c,minimumFractionDigits:2,maximumFractionDigits:2}).format(n(v));
const round2=v=>Math.round((n(v)+Number.EPSILON)*100)/100;
const holdingUnitPrice=h=>round2(h.price);
const fmt=(v,d=2)=>n(v).toLocaleString("zh-TW",{maximumFractionDigits:d});
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const toast=m=>{const e=$("toast");e.textContent=m;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2200)};
const now=()=>new Date().toLocaleString("zh-TW",{hour12:false});
const valueTwd=h=>holdingUnitPrice(h)*n(h.shares)*(h.market==="US"?n(state.fxRate):1);
const prevTwd=h=>round2(h.previousClose)*n(h.shares)*(h.market==="US"?n(state.fxRate):1);
const CASH_CURRENCIES=["TWD","USD","EUR","JPY","GBP","CNY","HKD","AUD","CAD","SGD"];
const cashRate=currency=>currency==="TWD"?1:n(state.fxRates?.[currency]);
const cashValueTwd=position=>n(position.amount)*cashRate(position.currency);
const totalCashTwd=()=>state.cashPositions.reduce((sum,x)=>sum+cashValueTwd(x),0);

function totals(){
  let tw=0,us=0,daily=0,base=0;
  state.holdings.forEach(h=>{
    const local=holdingUnitPrice(h)*n(h.shares);
    h.market==="TW"?tw+=local:us+=local;
    if(n(h.previousClose)>0){daily+=valueTwd(h)-prevTwd(h);base+=prevTwd(h)}
  });
  const cash=totalCashTwd();
  const total=tw+us*n(state.fxRate)+cash;
  let betaWeighted=0,betaValue=0;
  state.holdings.forEach(h=>{
    if(h.beta!==undefined&&h.beta!==null&&h.beta!==""&&n(h.beta)>=0){
      const v=valueTwd(h);
      betaWeighted+=v*n(h.beta);
      betaValue+=v;
    }
  });
  const portfolioBeta=total>0?betaWeighted/total:null;
  const betaCoverage=total>0?betaValue/total*100:0;
  return {tw,us,daily,base,cash,total,portfolioBeta,betaCoverage};
}


function validBeta(h){return h.beta!==undefined&&h.beta!==null&&h.beta!==""&&Number.isFinite(Number(h.beta))}
function targetBeta(){return Math.max(0.1,Math.min(3,n(state.targetBeta||1.20)))}
function betaAdvisor(){
  const t=totals(), target=targetBeta();
  if(t.portfolioBeta===null||t.betaCoverage<=0||t.total<=0)return {text:"按「更新全部」後即可產生建議。",ready:false};
  const diff=target-t.portfolioBeta;
  if(Math.abs(diff)<=0.03)return {text:`目前 Beta ${fmt(t.portfolioBeta,2)}，已接近目標 ${fmt(target,2)}，維持配置即可。`,ready:true};
  const assets=state.holdings.filter(validBeta).map(h=>({symbol:h.symbol,beta:n(h.beta),value:valueTwd(h)})).filter(x=>x.value>0).sort((a,b)=>a.beta-b.beta);
  if(!assets.length)return {text:"目前沒有可用的 Beta 資料。",ready:false};
  const low=assets[0], high=assets[assets.length-1];
  if(diff>0){
    const source=t.cash>0?{symbol:"現金",beta:0,value:t.cash}:low;
    const gap=high.beta-source.beta;
    if(gap<=0.001)return {text:`目前持股的 Beta 無法把組合提高到 ${fmt(target,2)}。`,ready:true};
    const amount=Math.abs(diff)*t.total/gap;
    const capped=Math.min(amount,source.value||amount);
    return {text:`要接近目標 ${fmt(target,2)}：將約 ${money(capped)} 從「${source.symbol}」調整到「${high.symbol}」。`,ready:true};
  }
  const gap=high.beta-low.beta;
  if(gap<=0.001)return {text:`目前持股的 Beta 無法把組合降低到 ${fmt(target,2)}。`,ready:true};
  const amount=Math.abs(diff)*t.total/gap;
  const capped=Math.min(amount,high.value);
  return {text:`要接近目標 ${fmt(target,2)}：將約 ${money(capped)} 從「${high.symbol}」調整到「${low.symbol}」。`,ready:true};
}
function allocationScore(){
  const t=totals(); if(t.total<=0)return {score:null,label:"等待持股資料"};
  const values=state.holdings.map(h=>({symbol:h.symbol,value:valueTwd(h)}));
  const investTotal=values.reduce((s,x)=>s+x.value,0);
  const weights=state.targetWeights||{};
  const groups=(state.allocationGroups||[]).filter(g=>(g.members||[]).length);
  const grouped=new Set(groups.flatMap(g=>g.members));
  const sumTargets=groups.reduce((s,g)=>s+n(g.target),0)+values.filter(x=>!grouped.has(x.symbol)).reduce((s,x)=>s+n(weights[x.symbol]),0);
  let alloc=20;
  if(investTotal>0&&Math.abs(sumTargets-100)<0.05){
    let distance=0;
    groups.forEach(g=>{const current=values.filter(x=>g.members.includes(x.symbol)).reduce((s,x)=>s+x.value,0)/investTotal*100;distance+=Math.abs(current-n(g.target));});
    values.filter(x=>!grouped.has(x.symbol)).forEach(x=>{distance+=Math.abs(x.value/investTotal*100-n(weights[x.symbol]));});
    alloc=Math.max(0,40-distance*0.8);
  }
  const beta=t.portfolioBeta===null?0:Math.max(0,30-Math.abs(t.portfolioBeta-targetBeta())*75);
  const maxWeight=values.length&&t.total>0?Math.max(...values.map(x=>x.value/t.total)):0;
  const concentration=Math.max(0,20-Math.max(0,maxWeight-0.35)*60);
  const cashRatio=t.cash/t.total;
  const cash=Math.max(0,10-Math.abs(cashRatio-0.15)*35);
  const score=Math.round(Math.max(0,Math.min(100,alloc+beta+concentration+cash)));
  return {score,label:score>=90?"配置健康":score>=75?"大致穩定":"建議重新平衡"};
}
function renderBetaCenter(){
  const t=totals(), target=targetBeta(), adv=betaAdvisor();
  if($("betaTargetDisplay"))$("betaTargetDisplay").textContent=fmt(target,2);
  if($("betaAdvisorResult"))$("betaAdvisorResult").textContent=adv.text;
  if($("betaDescription"))$("betaDescription").textContent=t.portfolioBeta===null?"尚未完成 Beta 計算。":`目前與目標相差 ${t.portfolioBeta-target>=0?"+":""}${fmt(t.portfolioBeta-target,2)}。`;
  renderBetaScenario();
}
function renderBetaScenario(){
  const t=totals(), market=n($("marketScenario")?.value), ready=t.portfolioBeta!==null&&t.betaCoverage>0;
  const change=ready?market*t.portfolioBeta:null;
  if($("marketScenarioText"))$("marketScenarioText").textContent=`${market>0?"+":""}${fmt(market,0)}%`;
  if($("portfolioScenario")){$("portfolioScenario").textContent=change===null?"--":`${change>0?"+":""}${fmt(change,2)}%`;$("portfolioScenario").className=change===null?"":change>=0?"positive":"negative"}
  if($("scenarioMoney")){$("scenarioMoney").textContent=change===null?"--":money(t.total*change/100);$("scenarioMoney").className=change===null?"":change>=0?"positive":"negative"}
}

function pledgeRiskSummary(){
  const rows=state.pledges.map(record=>{
    const holding=holdingForPledge(record.symbol);
    const amount=n(record.amount),marketValue=holding?valueTwd(holding):0;
    const ratio=amount>0&&marketValue>0?marketValue/amount*100:null;
    return {symbol:record.symbol,ratio};
  }).filter(x=>x.ratio!==null&&Number.isFinite(x.ratio));
  if(!rows.length)return null;
  rows.sort((a,b)=>a.ratio-b.ratio);
  return rows[0];
}
function renderPledgeRiskCard(){
  const card=$("pledgeRiskCard");
  if(!card)return;
  const risk=pledgeRiskSummary();
  if(!risk){card.hidden=true;return;}
  card.hidden=false;
  const ratioEl=$("lowestPledgeRatio"),symbolEl=$("lowestPledgeSymbol");
  ratioEl.textContent=`${fmt(risk.ratio,1)}%`;
  ratioEl.className=risk.ratio<140?"negative":risk.ratio<166?"warning-text":"positive";
  symbolEl.textContent=`${risk.symbol} 目前最低`;
  card.classList.toggle("pledge-critical",risk.ratio<140);
  card.classList.toggle("pledge-warning",risk.ratio>=140&&risk.ratio<166);
}

function render(){
  const t=totals();
  $("totalTwd").textContent=money(t.total);$("twTotal").textContent=money(t.tw);$("usTotal").textContent=money(t.us,"USD");
  $("cashTotal").textContent=money(t.cash);
  const betaReady=t.portfolioBeta!==null&&t.betaCoverage>0;
  $("portfolioBeta").textContent=betaReady?fmt(t.portfolioBeta,2):"--";
  if($("betaGoalSummary"))$("betaGoalSummary").textContent=betaReady?`目標 ${fmt(targetBeta(),2)}｜差距 ${t.portfolioBeta-targetBeta()>=0?"+":""}${fmt(t.portfolioBeta-targetBeta(),2)}`:`目標 ${fmt(targetBeta(),2)}`;
  $("betaDetail").textContent=betaReady?fmt(t.portfolioBeta,2):"--";
  const score=allocationScore();
  if($("investmentScore"))$("investmentScore").textContent=score.score===null?"--":`${score.score}/100`;
  if($("scoreSummary"))$("scoreSummary").textContent=score.label;
  renderPledgeRiskCard();
  renderBetaCenter();
  renderPledgeRows();
  $("dailyPnl").textContent=money(t.daily);$("dailyPnlPct").textContent=t.base?`${t.daily>=0?"+":""}${fmt(t.daily/t.base*100,2)}%`:"0.00%";
  $("twCount").textContent=`${state.holdings.filter(h=>h.market==="TW").length} 檔`;$("fxText").textContent=`USD/TWD ${fmt(state.fxRate,4)}`;
  $("lastUpdated").textContent=state.holdings.map(h=>h.updatedAt).filter(Boolean).sort().at(-1)||"尚未更新";
  renderHoldings();renderMarketPie();renderPie();renderHistory();renderAllocationGroups();renderTargetWeightList();
  renderCashPositions();renderFixedExpenses();
  $("finnhubKey").value=state.finnhubKey;$("fxRate").value=state.fxRate;if($("targetBeta"))$("targetBeta").value=targetBeta();
}


function renderCashPositions(){
  const list=$("cashPositionList");if(!list)return;
  if(!state.cashPositions.length){list.innerHTML='<div class="empty-holdings">尚未新增現金部位</div>';return;}
  list.innerHTML=state.cashPositions.slice().sort((a,b)=>CASH_CURRENCIES.indexOf(a.currency)-CASH_CURRENCIES.indexOf(b.currency)).map(x=>{
    const originalIndex=state.cashPositions.findIndex(p=>p.currency===x.currency);
    const rate=cashRate(x.currency),converted=rate>0?cashValueTwd(x):null;
    return `<div class="cash-position-row">
      <div class="cash-position-main">
        <strong>${x.currency}</strong>
        <span>${money(x.amount,x.currency)}</span>
        <small>${converted===null?"匯率尚未取得":`≈ ${money(converted)}｜1 ${x.currency} = ${fmt(rate,4)} TWD`}</small>
      </div>
      <div class="cash-position-actions">
        <button class="holding-icon-btn edit-icon" onclick="editCashPosition(${originalIndex})" aria-label="修改" title="修改"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-2.4 2.4-2.1-2.1a4 4 0 0 0 5 5l7.4 7.4a2 2 0 0 1-2.8 2.8l-7.4-7.4a4 4 0 0 0-5-5l2.1 2.1-2.4 2.4-2.1-2.1a4 4 0 0 0 5 5"/></svg></button>
        <button class="holding-icon-btn delete-icon" onclick="removeCashPosition(${originalIndex})" aria-label="刪除" title="刪除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg></button>
      </div>
    </div>`;
  }).join("");
}
function addCashPosition(){
  const currency=$("cashCurrency").value,amount=n($("cashAmount").value);
  if(!CASH_CURRENCIES.includes(currency))return toast("請選擇支援的幣別");
  if(amount<=0)return toast("請輸入大於 0 的金額");
  const existing=state.cashPositions.find(x=>x.currency===currency);
  if(existing){const before=existing.amount;existing.amount=before+amount;toast(`${currency} 已累加：${fmt(before,2)} + ${fmt(amount,2)}`);}
  else{state.cashPositions.push({currency,amount});toast(`${currency} 現金部位已新增`);}
  $("cashAmount").value="";save();render();
}
window.editCashPosition=i=>{const item=state.cashPositions[i];if(!item)return;const value=prompt(`${item.currency} 金額`,item.amount);if(value===null)return;const amount=n(value);if(amount<=0)return toast("金額必須大於 0");item.amount=amount;save();render();toast(`${item.currency} 已修改`)};
window.removeCashPosition=i=>{const item=state.cashPositions[i];if(!item)return;if(confirm(`確定刪除 ${item.currency} 現金部位？`)){state.cashPositions.splice(i,1);save();render();toast("現金部位已刪除")}};

function holdingForPledge(symbol){
  return state.holdings.find(h=>String(h.symbol||"").toUpperCase()===String(symbol||"").toUpperCase())||null;
}
function renderPledgeRows(){
  const list=$("pledgeHoldingList");
  if(!list)return;
  const datalist=$("pledgeSymbolOptions");
  if(datalist)datalist.innerHTML=state.holdings.map(h=>`<option value="${h.symbol}">${h.name||h.symbol}</option>`).join("");
  if(!state.pledges.length){
    list.innerHTML='<div class="empty-holdings">尚未新增質押紀錄</div>';
    $("pledgeDebtTotal").textContent=money(0);
    $("pledgeInterestTotal").textContent=money(0);
    return;
  }
  let debtTotal=0,interestTotal=0;
  list.innerHTML=state.pledges.map((record,i)=>{
    const amount=n(record.amount),rate=n(record.rate),holding=holdingForPledge(record.symbol);
    const marketValue=holding?valueTwd(holding):0;
    const ratio=amount>0&&marketValue>0?marketValue/amount*100:null;
    const invalid=marketValue>0&&amount>marketValue;
    debtTotal+=amount;interestTotal+=amount*rate/100;
    return `<div class="pledge-record-card${invalid?" pledge-invalid":""}">
      <div class="pledge-record-head">
        <div><strong>${record.symbol}</strong><small>${holding?`目前市值 ${money(marketValue)}`:"持股清單查無此股票"}</small>${invalid?`<small class="pledge-error">質押金額超過目前市值，請更新或刪除此紀錄</small>`:""}</div>
        <button class="holding-icon-btn delete-icon pledge-delete-icon" type="button" onclick="removePledge(${i})" aria-label="刪除" title="刪除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg></button>
      </div>
      <div class="pledge-record-grid">
        <div><span>質押金額</span><strong>${money(amount)}</strong></div>
        <div><span>年利率</span><strong>${fmt(rate,2)}%</strong></div>
        <div><span>目前維持率</span><strong class="${ratio!==null&&ratio<166?"negative":ratio!==null&&ratio>=200?"positive":""}">${ratio===null?"--":`${fmt(ratio,1)}%`}</strong></div>
        <div><span>估計年利息</span><strong>${money(amount*rate/100)}</strong></div>
      </div>
    </div>`;
  }).join("");
  $("pledgeDebtTotal").textContent=money(debtTotal);
  $("pledgeInterestTotal").textContent=money(interestTotal);
}
function addOrUpdatePledge(){
  const symbol=String($("pledgeSymbol")?.value||"").trim().toUpperCase();
  const amount=Math.max(0,n($("pledgeAmount")?.value));
  const rate=Math.max(0,n($("pledgeRate")?.value));
  if(!symbol)return toast("請輸入股票代號");
  const holding=holdingForPledge(symbol);
  if(!holding)return toast("請先在持股頁加入這檔股票");
  const marketValue=valueTwd(holding);
  if(amount<=0)return toast("質押金額必須大於 0");
  if(marketValue<=0)return toast("目前無法取得這檔股票的市值，請先更新報價");
  if(amount>marketValue)return toast(`質押金額不可超過目前市值 ${money(marketValue)}`);
  if(rate<=0)return toast("請填入質押年利率");
  const existing=state.pledges.find(x=>x.symbol===symbol);
  if(existing){existing.amount=amount;existing.rate=rate;toast(`${symbol} 質押資料已更新`);}
  else{state.pledges.push({id:`pledge-${Date.now()}`,symbol,amount,rate});toast(`${symbol} 質押紀錄已新增`);}
  state.pledges.sort((a,b)=>a.symbol.localeCompare(b.symbol,undefined,{numeric:true,sensitivity:"base"}));
  save();render();
  $("pledgeSymbol").value="";$("pledgeAmount").value="";$("pledgeRate").value="";
}
window.removePledge=i=>{
  const record=state.pledges[i];if(!record)return;
  if(confirm(`確定刪除 ${record.symbol} 的質押紀錄？`)){
    state.pledges.splice(i,1);save();render();toast("質押紀錄已刪除");
  }
};

function renderHoldings(){
  const list=$("holdingsList");
  if(!state.holdings.length){
    list.innerHTML='<div class="empty-holdings">尚未加入持股</div>';
    return;
  }
  list.innerHTML=state.holdings.map((h,i)=>{
    const c=h.market==="TW"?"TWD":"USD";
    const change=n(h.previousClose)>0?(n(h.price)-n(h.previousClose))/n(h.previousClose)*100:null;
    return `<details class="holding-compact">
      <summary>
        <div class="holding-summary-main">
          <span class="holding-symbol">${h.symbol}</span>
          <span class="pill">${h.market==="TW"?"台股":"美股"}</span>
        </div>
        <div class="holding-summary-value">${money(holdingUnitPrice(h)*n(h.shares),c)}</div>
        <span class="holding-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="holding-detail">
        <div class="holding-meta">
          ${h.name||h.symbol}<br>
          股數 ${fmt(h.shares,4)}｜價格 ${money(holdingUnitPrice(h),c)}${h.stalePrice?` <span class="stale-price-warning" title="目前沿用上次成功取得的價格" aria-label="價格不是最新">⚠</span>`:""}
          ${change===null?"":`｜<span class="${change>=0?"positive":"negative"}">${change>=0?"+":""}${fmt(change,2)}%</span>`}
          ${h.beta!==undefined&&h.beta!==null&&h.beta!==""?`<br>Beta ${fmt(h.beta,2)} <span class="beta-source-pill ${h.betaManual?"manual":"auto"}">${h.betaManual?"手動":"自動"}</span>`:"<br>Beta 尚未計算"}
          <br>${h.updatedAt?``:"尚未取得報價"}
          ${h.error?`<br><span class="holding-error">${h.error}</span>`:""}
        </div>
        <div class="holding-actions holding-icon-actions">
          <button class="holding-icon-btn edit-icon" onclick="editHolding(${i})" aria-label="修改" title="修改"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-2.4 2.4-2.1-2.1a4 4 0 0 0 5 5l7.4 7.4a2 2 0 0 1-2.8 2.8l-7.4-7.4a4 4 0 0 0-5-5l2.1 2.1-2.4 2.4-2.1-2.1a4 4 0 0 0 5 5"/></svg></button>
          <button class="holding-icon-btn delete-icon" onclick="removeHolding(${i})" aria-label="刪除" title="刪除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg></button>
        </div>
      </div>
    </details>`;
  }).join("");
}


const STOCK_SEARCH_CATALOG=[
  {symbol:"0050",name:"元大台灣50",market:"台股"},{symbol:"0056",name:"元大高股息",market:"台股"},{symbol:"00631L",name:"元大台灣50正2",market:"台股"},{symbol:"00662",name:"富邦NASDAQ",market:"台股"},{symbol:"006208",name:"富邦台50",market:"台股"},{symbol:"00865B",name:"國泰US短期公債",market:"台股"},{symbol:"009862",name:"富邦全球入息不動產與基建",market:"台股"},{symbol:"2330",name:"台積電",market:"台股"},{symbol:"2317",name:"鴻海",market:"台股"},{symbol:"2454",name:"聯發科",market:"台股"},{symbol:"AU9901",name:"臺灣銀行黃金現貨",market:"黃金"},{symbol:"AU9902",name:"第一銀行黃金現貨",market:"黃金"},
  {symbol:"QQQ",name:"Invesco QQQ Trust",market:"美股"},{symbol:"QQQM",name:"Invesco NASDAQ 100 ETF",market:"美股"},{symbol:"VT",name:"Vanguard Total World Stock ETF",market:"美股"},{symbol:"VOO",name:"Vanguard S&P 500 ETF",market:"美股"},{symbol:"VXUS",name:"Vanguard Total International Stock ETF",market:"美股"},{symbol:"QLD",name:"ProShares Ultra QQQ",market:"美股"},{symbol:"AAPL",name:"Apple",market:"美股"},{symbol:"MSFT",name:"Microsoft",market:"美股"},{symbol:"NVDA",name:"NVIDIA",market:"美股"}
];
function normalizedSearchText(value){return String(value||"").trim().toUpperCase().replace(/\s+/g,"")}
function stockSearchResults(query){
  const q=normalizedSearchText(query);if(!q)return [];
  const holdings=state.holdings.map(h=>({symbol:h.symbol,name:h.name||h.symbol,market:h.market==="TW"?"台股":"美股"}));
  const map=new Map([...holdings,...STOCK_SEARCH_CATALOG].map(x=>[x.symbol,x]));
  return [...map.values()].map(item=>{
    const symbol=item.symbol.toUpperCase(),name=String(item.name||"").toUpperCase();
    let score=99;
    if(symbol===q)score=0;else if(symbol.startsWith(q))score=1;else if(name.startsWith(q))score=2;else if(symbol.includes(q))score=3;else if(name.includes(q))score=4;
    return {...item,score};
  }).filter(x=>x.score<99).sort((a,b)=>a.score-b.score||a.symbol.localeCompare(b.symbol,undefined,{numeric:true})).slice(0,8);
}
function closeStockSuggestions(){const box=$("stockSuggestions"),input=$("symbol");if(box){box.hidden=true;box.innerHTML=""}if(input)input.setAttribute("aria-expanded","false")}
function chooseStockSuggestion(symbol){$("symbol").value=symbol;closeStockSuggestions();$("shares")?.focus()}
function renderStockSuggestions(query){
  const box=$("stockSuggestions"),input=$("symbol");if(!box||!input)return;
  const q=String(query||"").trim();if(!q){closeStockSuggestions();return}
  const results=stockSearchResults(q);
  box.innerHTML=results.length?results.map((item,index)=>`<button type="button" class="stock-suggestion${index===0?" active":""}" role="option" data-symbol="${item.symbol}" aria-selected="${index===0}"><span class="stock-suggestion-badge">${item.symbol.slice(0,2)}</span><span class="stock-suggestion-copy"><strong>${item.symbol}</strong><small>${item.name}</small></span><span class="stock-suggestion-market">${item.market}</span></button>`).join(""):`<div class="stock-suggestion-empty">找不到內建建議，仍可直接輸入代號查詢</div>`;
  box.hidden=false;input.setAttribute("aria-expanded","true");
  box.querySelectorAll("[data-symbol]").forEach(button=>button.addEventListener("pointerdown",event=>{event.preventDefault();chooseStockSuggestion(button.dataset.symbol)}));
}
function installStockSearch(){
  const input=$("symbol"),box=$("stockSuggestions");if(!input||!box)return;
  let timer=null;
  input.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>renderStockSuggestions(input.value),90)});
  input.addEventListener("focus",()=>{if(input.value.trim())renderStockSuggestions(input.value)});
  input.addEventListener("keydown",event=>{
    if(box.hidden)return;
    const items=[...box.querySelectorAll(".stock-suggestion")];if(!items.length)return;
    let idx=items.findIndex(x=>x.classList.contains("active"));
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();items[idx]?.classList.remove("active");idx=event.key==="ArrowDown"?(idx+1)%items.length:(idx-1+items.length)%items.length;items[idx].classList.add("active");items[idx].scrollIntoView({block:"nearest"});
    }else if(event.key==="Enter"&&idx>=0){event.preventDefault();chooseStockSuggestion(items[idx].dataset.symbol)}else if(event.key==="Escape")closeStockSuggestions();
  });
  document.addEventListener("pointerdown",event=>{if(!event.target.closest(".stock-search-wrap"))closeStockSuggestions()});
}
function setQuoteLoading(loading){
  const skeleton=$("quoteSkeleton"),card=$("symbol")?.closest(".card"),button=$("addHolding");
  if(skeleton)skeleton.hidden=!loading;if(card)card.classList.toggle("is-quote-loading",loading);
  if(button)button.setAttribute("aria-busy",loading?"true":"false");
}
document.addEventListener("DOMContentLoaded",installStockSearch);

async function fetchTw(symbol){
  const r=await fetch(`/api/tw?symbol=${encodeURIComponent(symbol)}`,{cache:"no-store"});
  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return {price:n(d.price),previousClose:n(d.previousClose),name:d.name||symbol,assetType:d.assetType||"stock",quoteType:d.quoteType||"",quoteField:d.quoteField||"",source:d.source||""};
}
async function fetchUs(symbol){
  if(!state.finnhubKey)throw new Error("請先設定 Finnhub API Key");
  const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(state.finnhubKey)}`,{cache:"no-store"});
  const d=await r.json();if(!r.ok||!n(d.c))throw new Error("查無美股報價");
  return {price:n(d.c),previousClose:n(d.pc),name:symbol};
}

async function fetchBeta(symbol,market){
  const r=await fetch(`/api/beta?market=${encodeURIComponent(market)}&symbol=${encodeURIComponent(symbol)}`,{cache:"no-store"});
  const d=await r.json();
  if(!r.ok||!d.ok||!Number.isFinite(Number(d.beta)))throw new Error(d.error||"Beta 計算失敗");
  return {
    beta:n(d.beta),
    betaBenchmark:d.benchmark||"",
    betaObservations:n(d.observations),
    betaSource:d.source||"historical",
    betaSourceLabel:d.sourceLabel||"近兩年每週報酬",
    betaUpdatedAt:d.fetchedAt||now()
  };
}

const looksLikeTw=symbol=>/^\d{4,6}$/.test(symbol)||/^AU99\d{2}$/.test(symbol);

async function detectStock(symbol){
  if(symbol==="AU9901"||symbol==="AU9902"){
    try{const quote=await fetchTw(symbol);return {market:"TW",symbol,...quote,manualOnly:false,assetType:"gold",quoteType:"last-close"};}
    catch(e){return {market:"TW",symbol,name:symbol==="AU9902"?"第一銀行黃金現貨 AU9902":"臺灣銀行黃金現貨 AU9901",price:0,previousClose:0,manualOnly:true,assetType:"gold",quoteType:"last-close"};}
  }
  const order=looksLikeTw(symbol)?["TW","US"]:["US","TW"];
  let usKeyMissing=false,lastError=null;

  for(const market of order){
    try{
      if(market==="US"&&!state.finnhubKey){
        usKeyMissing=true;
        continue;
      }
      const quote=market==="TW"?await fetchTw(symbol):await fetchUs(symbol);
      if(n(quote.price)>0)return {market,...quote};
    }catch(e){
      lastError=e;
    }
  }

  if(!looksLikeTw(symbol)&&usKeyMissing){
    throw new Error("請先設定 Finnhub API Key，才能驗證美股代號");
  }
  throw new Error("沒有此股票，請重新輸入");
}
window.refreshHolding=async i=>{
  const h=state.holdings[i];h.error="更新報價與 Beta 中";renderHoldings();const errors=[];
  try{
    const q=h.market==="TW"?await fetchTw(h.symbol):await fetchUs(h.symbol);
    Object.assign(h,q,{manualOnly:false,stalePrice:false,updatedAt:h.symbol==="AU9901"?`最近收盤價 ${now()}`:now()});
    if(h.symbol==="AU9901"){h.assetType="gold";h.quoteType="last-close";}
  }catch(e){
    h.stalePrice=true;
    errors.push(n(h.price)>0?"報價暫時無法更新，沿用舊價格":`報價：${e.message}`);
  }
  // Beta 更新策略：
  // 1) 自動 Beta：照常更新。
  // 2) 手動 Beta：背景嘗試回測；只有真的取得足夠歷史資料（historical + >=30 筆週報酬）才自動取代。
  //    若仍資料不足、只有模型值或 API 失敗，繼續保留使用者手動 Beta。
  if(h.betaManual){
    try{
      const autoBeta=await fetchBeta(h.symbol,h.market);
      if(autoBeta.betaSource==="historical"&&n(autoBeta.betaObservations)>=30){
        Object.assign(h,autoBeta,{betaManual:false});
      }
    }catch(e){
      // 手動 Beta 是有效備援；歷史資料尚不足時不顯示錯誤，也不覆蓋。
    }
  }else{
    try{Object.assign(h,await fetchBeta(h.symbol,h.market));}catch(e){errors.push(`Beta：${e.message}`)}
  }
  h.error=errors.join("｜");save();render();
};
window.removeHolding=i=>{const symbol=state.holdings[i]?.symbol;state.holdings.splice(i,1);if(symbol)state.allocationGroups=(state.allocationGroups||[]).map(g=>({...g,members:g.members.filter(s=>s!==symbol)}));save();render()};
window.editHolding=async i=>{
  const h=state.holdings[i];
  const s=prompt(`${h.symbol} 股數`,h.shares);if(s===null)return;
  const shares=n(s);if(shares<=0)return toast("股數必須大於 0");
  const betaInput=prompt(`${h.symbol} 手動 Beta（留空＝恢復系統自動計算）`,h.betaManual?String(h.beta??""):"");
  if(betaInput===null)return;
  h.shares=shares;
  if(String(betaInput).trim()!==""){
    const manual=Number(betaInput);
    if(!Number.isFinite(manual)||manual<0||manual>10)return toast("Beta 請輸入 0～10 的數值");
    h.beta=manual;h.betaManual=true;h.betaSource="manual";h.betaSourceLabel="使用者手動輸入";h.betaBenchmark="";h.betaObservations=0;h.betaUpdatedAt=now();h.error="";
  }else{
    h.betaManual=false;
    try{Object.assign(h,await fetchBeta(h.symbol,h.market));h.error=""}catch(e){h.beta=null;h.error=`Beta：${e.message}`}
  }
  save();render();toast(`${h.symbol} 已修改`);
};


function chartIsLight(){return document.body.classList.contains("light-mode")}
function lightChartColor(hex){
  const value=String(hex||"").replace("#","");
  if(!/^[0-9a-f]{6}$/i.test(value))return "#31527d";
  let r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);
  const luminance=(0.2126*r+0.7152*g+0.0722*b)/255;
  const factor=luminance>.72?.52:luminance>.55?.64:.76;
  r=Math.round(r*factor);g=Math.round(g*factor);b=Math.round(b*factor);
  return `rgb(${r},${g},${b})`;
}

function drawNeonDonut(canvas,data,{centerTitle,centerValue,legendId,market=false}){
  const ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
  const total=data.reduce((s,x)=>s+x.value,0);
  ctx.clearRect(0,0,w,h);
  const light=chartIsLight();
  if(!total){
    ctx.fillStyle=light?"#66758d":"#98a8c1";ctx.font="26px sans-serif";ctx.textAlign="center";
    ctx.fillText("尚無資料",w/2,h/2);$(legendId).innerHTML="";return;
  }

  const cx=w/2,cy=market?h*.53:h*.52;
  const labelGutter=market?128:142;
  const r=Math.min((w-labelGutter*2)/2,h*(market?.30:.285));
  const inner=r*(market?.58:.53);
  let angle=-Math.PI/2;
  const slices=[];

  data.forEach((item)=>{
    const end=angle+item.value/total*Math.PI*2;
    const slice={...item,start:angle,end,mid:(angle+end)/2,pct:item.value/total*100};
    slices.push(slice);
    ctx.save();
    ctx.shadowColor=item.color;ctx.shadowBlur=market?22:18;
    ctx.beginPath();ctx.arc(cx,cy,r,angle,end);ctx.arc(cx,cy,inner,end,angle,true);ctx.closePath();
    const grad=ctx.createRadialGradient(cx,cy,inner,cx,cy,r);
    grad.addColorStop(0,item.color+"a0");grad.addColorStop(1,item.color);
    ctx.fillStyle=grad;ctx.fill();
    ctx.shadowBlur=0;ctx.strokeStyle=light?"rgba(255,255,255,.96)":"rgba(238,249,255,.84)";ctx.lineWidth=2.2;ctx.stroke();
    ctx.restore();
    angle=end;
  });

  ctx.save();ctx.shadowColor="#67d7ff";ctx.shadowBlur=18;
  ctx.beginPath();ctx.arc(cx,cy,inner,0,Math.PI*2);ctx.fillStyle=light?"#f7faff":"#0b172a";ctx.fill();
  ctx.strokeStyle=light?"rgba(74,111,171,.28)":"rgba(126,221,255,.52)";ctx.lineWidth=2;ctx.stroke();ctx.restore();
  ctx.fillStyle=light?"#17243a":"#fff";ctx.textAlign="center";
  ctx.font=`700 ${market?27:25}px -apple-system,BlinkMacSystemFont,sans-serif`;
  ctx.fillText(centerTitle,cx,cy-5);
  ctx.font=`${market?20:18}px -apple-system,BlinkMacSystemFont,sans-serif`;
  ctx.fillStyle=light?"#66758d":"#c7d8ef";ctx.fillText(centerValue,cx,cy+26);

  const left=slices.filter(s=>Math.cos(s.mid)<0).sort((a,b)=>Math.sin(a.mid)-Math.sin(b.mid));
  const right=slices.filter(s=>Math.cos(s.mid)>=0).sort((a,b)=>Math.sin(a.mid)-Math.sin(b.mid));
  const fontName=market?22:(slices.length>=10?16:slices.length>=8?17:19);
  const fontPct=market?22:(slices.length>=10?16:slices.length>=8?17:19);
  const top=market?62:54,bottom=h-(market?54:48);

  const drawSide=(items,side)=>{
    const step=items.length>1?(bottom-top)/(items.length-1):0;
    items.forEach((s,index)=>{
      const sx=cx+Math.cos(s.mid)*(r-7),sy=cy+Math.sin(s.mid)*(r-7);
      const radialX=cx+Math.cos(s.mid)*(r+24),radialY=cy+Math.sin(s.mid)*(r+24);
      const targetY=items.length>1?top+index*step:Math.max(top,Math.min(bottom,radialY));
      const lineEndX=side<0?labelGutter-12:w-labelGutter+12;
      const textX=side<0?18:w-18;

      ctx.save();ctx.strokeStyle=light?"rgba(126,145,171,.62)":"rgba(243,249,255,.94)";ctx.lineWidth=1.75;
      ctx.lineCap="round";ctx.lineJoin="round";
      ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(radialX,radialY);ctx.lineTo(lineEndX,targetY);ctx.stroke();
      ctx.fillStyle=light?"#ffffff":"#fff";ctx.shadowColor=s.color;ctx.shadowBlur=light?4:10;
      ctx.beginPath();ctx.arc(sx,sy,4,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;

      ctx.textAlign=side<0?"left":"right";
      ctx.fillStyle=light?"#24324a":"#f8fbff";ctx.font=`650 ${fontName}px -apple-system,BlinkMacSystemFont,sans-serif`;
      ctx.fillText(s.name,textX,targetY-7);
      ctx.fillStyle=light?lightChartColor(s.color):s.color;ctx.font=`750 ${fontPct}px -apple-system,BlinkMacSystemFont,sans-serif`;
      ctx.fillText(`${fmt(s.pct,1)}%`,textX,targetY+13);

      ctx.restore();
    });
  };
  drawSide(left,-1);drawSide(right,1);

  $(legendId).innerHTML=data.map(x=>`<div class="legend-row ${market?'cute-legend':'allocation-legend-row'}"><span><i style="background:${x.color};box-shadow:0 0 12px ${x.color}"></i>${x.emoji||''} ${x.name}</span><strong>${fmt(x.value/total*100,1)}%</strong></div>`).join("");
}

function renderMarketPie(){
  const t=totals();
  const data=[
    {name:"台股",value:t.tw,color:"#2f8cff",emoji:"🐳"},
    {name:"美股",value:t.us*n(state.fxRate),color:"#9b63ff",emoji:"🦄"},
    {name:"現金",value:t.cash,color:"#27d7c1",emoji:"🐣"}
  ].filter(x=>x.value>0);
  drawNeonDonut($("marketChart"),data,{centerTitle:"資產配比",centerValue:"100%",legendId:"marketLegend",market:true});
}

function renderPie(){
  const map=new Map();
  state.holdings.forEach(x=>map.set(x.symbol,(map.get(x.symbol)||0)+valueTwd(x)));
  const cash=totalCashTwd();if(cash>0)map.set("現金",cash);
  const entries=[...map.entries()].filter(([,v])=>v>0);
  const palette=["#2f8cff","#ffd21f","#29d45b","#9b45ff","#00d5c8","#ff8a00","#f12d91","#6746e8","#ff4f5e","#65d5ff","#f1b84b","#61e6a8"];
  const data=entries.map(([name,value],i)=>({name,value,color:palette[i%palette.length]}));
  drawNeonDonut($("allocationChart"),data,{centerTitle:"總資產",centerValue:money(data.reduce((s,x)=>s+x.value,0)),legendId:"allocationLegend"});
}

function renderHistory(){
  const allHistory=[...state.history].sort((a,b)=>String(a.date).localeCompare(String(b.date))); const sel=$("historyMonthFilter"); if(sel){const months=[...new Set(allHistory.map(x=>String(x.date||"").slice(0,7)).filter(Boolean))].sort().reverse(); sel.innerHTML=`<option value="all">全部紀錄</option>`+months.map(m=>`<option value="${m}">${m}</option>`).join(""); if(!window.__historyMonthFilter)window.__historyMonthFilter="all"; if(window.__historyMonthFilter!=="all"&&months.includes(window.__historyMonthFilter))sel.value=window.__historyMonthFilter; else {window.__historyMonthFilter="all";sel.value="all";}} const d=(window.__historyMonthFilter&&window.__historyMonthFilter!=="all")?allHistory.filter(x=>String(x.date||"").startsWith(window.__historyMonthFilter)):allHistory; const c=$("historyChart"),ctx=c.getContext("2d"),w=c.width,h=c.height,p=45;ctx.clearRect(0,0,w,h);
  if(d.length<2){ctx.fillStyle="#98a8c1";ctx.font="22px sans-serif";ctx.textAlign="center";ctx.fillText("至少記錄兩次後顯示曲線",w/2,h/2)}else{const vals=d.map(x=>n(x.total)),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;ctx.strokeStyle="#2f64e9";ctx.lineWidth=5;ctx.beginPath();d.forEach((x,i)=>{const px=p+i*(w-2*p)/(d.length-1),py=h-p-(n(x.total)-min)/range*(h-2*p);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke()}
  $("historyList").innerHTML=d.length?d.slice().reverse().map(x=>`<div class="history-item"><span>${x.date}</span><strong>${money(x.total)}</strong></div>`).join(""):`<div class="history-empty">本月尚無資產紀錄</div>`;
}

$("addHolding").onclick=async()=>{
  const symbol=$("symbol").value.trim().toUpperCase().replace(/\s+/g,"");
  const shares=n($("shares").value),manualPrice=n($("manualPrice").value);
  const manualBetaRaw=String($("manualBeta")?.value??"").trim();
  const hasManualBeta=manualBetaRaw!=="";
  const manualBeta=hasManualBeta?Number(manualBetaRaw):null;
  if(hasManualBeta&&(!Number.isFinite(manualBeta)||manualBeta<0||manualBeta>10))return toast("手動 Beta 請輸入 0～10 的數值");
  if(!symbol||shares<=0)return toast("請輸入股票代號與持有股數");

  const existingIndex=state.holdings.findIndex(h=>(h.symbol||"").toUpperCase()===symbol);
  if(existingIndex>=0){
    const holding=state.holdings[existingIndex];
    const oldShares=n(holding.shares);
    holding.shares=oldShares+shares;
    if(manualPrice>0&&n(holding.price)<=0){holding.price=manualPrice;holding.updatedAt=`手動 ${now()}`;holding.stalePrice=true;}
    if(hasManualBeta){holding.beta=manualBeta;holding.betaManual=true;holding.betaSource="manual";holding.betaSourceLabel="使用者手動輸入";holding.betaBenchmark="";holding.betaObservations=0;holding.betaUpdatedAt=now();holding.error="";}
    state.holdings.sort((a,b)=>(a.symbol||"").localeCompare(b.symbol||"",undefined,{numeric:true,sensitivity:"base"}));
    save();
    render();
    $("symbol").value="";
    $("shares").value="";
    $("manualPrice").value="";if($("manualBeta"))$("manualBeta").value="";
    $("symbolStatus").textContent=`已合併 ${symbol}：${oldShares} + ${shares} = ${holding.shares}`;
    $("symbolStatus").className="field-status success";
    toast(`已將 ${symbol} 從 ${oldShares} 股增加為 ${holding.shares} 股`);
    return;
  }

  const button=$("addHolding");
  const label=button.querySelector(".button-label");
  const originalText=label?label.textContent:button.textContent;
  button.disabled=true;
  if(label)label.textContent="正在辨識股票…";else button.textContent="正在辨識股票…";
  setQuoteLoading(true);
  closeStockSuggestions();
  $("symbolStatus").textContent="正在自動判斷台股或美股";
  $("symbolStatus").className="field-status";

  try{
    const detected=await detectStock(symbol);
    if(detected.manualOnly&&!(manualPrice>0)){
      throw new Error("AU9901 最近收盤價暫時無法取得；請稍後再試，或先輸入每台錢的手動價格");
    }
    const price=manualPrice>0?manualPrice:detected.price;
    state.holdings.push({
      market:detected.market,
      symbol,
      manualOnly:Boolean(detected.manualOnly),
      assetType:detected.assetType||"stock",
      shares,
      price,
      previousClose:detected.previousClose,
      pledgeAmount:0,
      pledgeRate:0,
      beta:hasManualBeta?manualBeta:null,
      betaManual:hasManualBeta,
      betaSource:hasManualBeta?"manual":"",
      betaSourceLabel:hasManualBeta?"使用者手動輸入":"",
      betaBenchmark:"",
      betaObservations:0,
      name:detected.name||symbol,
      updatedAt:manualPrice>0?`手動 ${now()}`:(symbol==="AU9901"?`最近收盤價 ${now()}`:now()),
      stalePrice:manualPrice>0,
      error:""
    });
    const newIndex=state.holdings.length-1;
    if(!hasManualBeta){
      try{
        Object.assign(state.holdings[newIndex],await fetchBeta(symbol,detected.market));
      }catch(e){
        state.holdings[newIndex].error=`Beta：${e.message}`;
      }
    }
    state.holdings.sort((a,b)=>(a.symbol||"").localeCompare(b.symbol||"",undefined,{numeric:true,sensitivity:"base"}));
    save();
    render();
    $("symbol").value="";
    $("shares").value="";
    $("manualPrice").value="";if($("manualBeta"))$("manualBeta").value="";
    $("symbolStatus").textContent=`已辨識為${detected.market==="TW"?"台股":"美股"}：${detected.name||symbol}${hasManualBeta?"｜使用手動 Beta":""}`;
    $("symbolStatus").className="field-status success";
    button.classList.add("is-success");
    setTimeout(()=>button.classList.remove("is-success"),650);
    toast(`已加入${detected.market==="TW"?"台股":"美股"} ${symbol}`);
  }catch(e){
    $("symbolStatus").textContent=e.message;
    $("symbolStatus").className="field-status error";
    toast(e.message);
  }finally{
    setQuoteLoading(false);
    button.disabled=false;
    const currentLabel=button.querySelector(".button-label");
    if(currentLabel)currentLabel.textContent=originalText;else button.textContent=originalText;
  }
};
$("refreshAll").onclick=async()=>{
  try{const r=await fetch("/api/fx",{cache:"no-store"}),d=await r.json();if(d.ok){state.fxRate=n(d.rate)||state.fxRate;if(d.rates)state.fxRates={...state.fxRates,...d.rates,TWD:1,USD:n(d.rate)||state.fxRate};}}catch{}
  for(let i=0;i<state.holdings.length;i++)await refreshHolding(i);
  save();render();toast("更新完成");
};
$("clearHoldings").onclick=()=>{if(confirm("確定刪除全部持股？")){state.holdings=[];save();render()}};
$("addCash").onclick=addCashPosition;
$("addPledge").onclick=addOrUpdatePledge;
$("saveSettings").onclick=()=>{state.finnhubKey=$("finnhubKey").value.trim();state.fxRate=n($("fxRate").value)||state.fxRate;state.targetBeta=Math.max(0.1,Math.min(3,n($("targetBeta")?.value)||1.20));save();render();toast("設定已儲存")};
$("testWorker").onclick=async()=>{try{const r=await fetch("/api/status",{cache:"no-store"}),d=await r.json();$("settingsStatus").textContent=d.ok?`系統連線正常｜V${d.version}`:`失敗：${d.error}`}catch(e){$("settingsStatus").textContent=`連線失敗：${e.message}`}};
$("historyMonthFilter")?.addEventListener("change",e=>{window.__historyMonthFilter=e.target.value||"all";renderHistory();});
$("saveSnapshot").onclick=()=>{const date=new Date().toISOString().slice(0,10),total=totals().total,old=state.history.find(x=>x.date===date);old?old.total=total:state.history.push({date,total});save();render();toast("今天資產已記錄")};

function escapeExpenseHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
}
function expenseMonthsBetween(startDate,currentDate=new Date()){
  const start=new Date(`${startDate}T00:00:00`);
  if(Number.isNaN(start.getTime()))return 0;
  let months=(currentDate.getFullYear()-start.getFullYear())*12+(currentDate.getMonth()-start.getMonth());
  if(currentDate.getDate()<start.getDate())months-=1;
  return months;
}
function calculateExpense(expense,asOf=new Date()){
  const principal=Math.max(0,n(expense.principal));
  const totalMonths=Math.max(1,Math.round(n(expense.termMonths)));
  const graceMonths=Math.min(totalMonths,Math.max(0,Math.round(n(expense.graceMonths))));
  const monthlyRate=Math.max(0,n(expense.annualRate))/100/12;
  const share=Math.max(0,Math.min(100,n(expense.sharePercent)))/100;
  const elapsed=expenseMonthsBetween(expense.startDate,asOf);
  let fullMonthly=0,status="進行中",phase="本息攤還";
  if(elapsed<0){status="尚未開始";phase="尚未開始";}
  else if(elapsed>=totalMonths){status="已結束";phase="合約已結束";}
  else if(elapsed<graceMonths){
    fullMonthly=principal*monthlyRate;
    phase="寬限期・只繳利息";
  }else{
    const repaymentMonths=Math.max(1,totalMonths-graceMonths);
    fullMonthly=monthlyRate>0
      ?principal*monthlyRate*Math.pow(1+monthlyRate,repaymentMonths)/(Math.pow(1+monthlyRate,repaymentMonths)-1)
      :principal/repaymentMonths;
  }
  const completedMonths=status==="尚未開始"?0:Math.min(totalMonths,Math.max(0,elapsed));
  const currentMonth=status==="尚未開始"?0:status==="已結束"?totalMonths:Math.min(totalMonths,completedMonths+1);
  const repaymentMonths=Math.max(1,totalMonths-graceMonths);
  const repaymentMonthly=monthlyRate>0
    ?principal*monthlyRate*Math.pow(1+monthlyRate,repaymentMonths)/(Math.pow(1+monthlyRate,repaymentMonths)-1)
    :principal/repaymentMonths;
  const paidGraceMonths=Math.min(completedMonths,graceMonths);
  const paidRepaymentMonths=Math.max(0,completedMonths-graceMonths);
  const cumulativeFull=paidGraceMonths*(principal*monthlyRate)+paidRepaymentMonths*repaymentMonthly;
  const completionDate=new Date(`${expense.startDate}T00:00:00`);
  completionDate.setMonth(completionDate.getMonth()+totalMonths);
  return {
    fullMonthly,
    userMonthly:fullMonthly*share,
    status,
    phase,
    elapsed,
    completedMonths,
    currentMonth,
    cumulativeFull,
    cumulativeUser:cumulativeFull*share,
    completionYearMonth:Number.isNaN(completionDate.getTime())?"--":`${completionDate.getFullYear()}/${String(completionDate.getMonth()+1).padStart(2,"0")}`,
    totalMonths,
    graceMonths,
    remainingMonths:Math.max(0,totalMonths-completedMonths),
    share
  };
}
function fixedExpenseTotals(){
  return state.fixedExpenses.reduce((sum,x)=>{
    const calc=calculateExpense(x);
    sum.user+=calc.userMonthly;sum.full+=calc.fullMonthly;
    if(calc.status==="進行中")sum.active+=1;
    if(calc.phase.startsWith("寬限期"))sum.grace+=1;
    return sum;
  },{user:0,full:0,active:0,grace:0});
}
function resetExpenseForm(){
  ["expenseEditId","expenseName","expensePrincipal","expenseTermMonths","expenseRate"].forEach(id=>{if($(id))$(id).value=""});
  if($("expenseStartDate"))$("expenseStartDate").value=new Date().toISOString().slice(0,10);
  if($("expenseGraceMonths"))$("expenseGraceMonths").value="0";
  if($("expenseShare"))$("expenseShare").value="100";
  if($("expenseFormTitle"))$("expenseFormTitle").textContent="新增固定支出";
  if($("saveExpense"))$("saveExpense").textContent="新增固定支出";
  if($("cancelExpenseEdit"))$("cancelExpenseEdit").hidden=true;
  updateExpensePreview();
}
function readExpenseForm(){
  return {
    id:$("expenseEditId")?.value||`expense-${Date.now()}`,
    name:$("expenseName")?.value.trim()||"",
    startDate:$("expenseStartDate")?.value||"",
    principal:Math.max(0,n($("expensePrincipal")?.value)),
    termMonths:Math.max(0,Math.round(n($("expenseTermMonths")?.value))),
    graceMonths:Math.max(0,Math.round(n($("expenseGraceMonths")?.value))),
    annualRate:Math.max(0,n($("expenseRate")?.value)),
    sharePercent:Math.max(0,Math.min(100,n($("expenseShare")?.value)))
  };
}
function updateExpensePreview(){
  const box=$("expensePreview");if(!box)return;
  const item=readExpenseForm();
  if(!item.name||!item.startDate||item.principal<=0||item.termMonths<=0){
    box.innerHTML="<span>預估目前月付</span><strong>請填入合約資料</strong>";
    return;
  }
  const calc=calculateExpense(item);
  box.innerHTML=`<span>${escapeExpenseHtml(calc.phase)}｜你的負擔 ${fmt(item.sharePercent,1)}%</span>
    <strong>${money(calc.userMonthly)}</strong>
    <small>合約完整月付 ${money(calc.fullMonthly)}</small>`;
}
function saveFixedExpense(){
  const item=readExpenseForm();
  if(!item.name)return toast("請填寫繳款名稱");
  if(!item.startDate)return toast("請選擇合約開始日");
  if(item.principal<=0)return toast("請填寫合約總額");
  if(item.termMonths<=0)return toast("請填寫合約總期數（月）");
  if(item.graceMonths>=item.termMonths)return toast("寬限期月數必須小於合約總期數");
  if(item.sharePercent<=0)return toast("負擔比例必須大於 0%");
  const index=state.fixedExpenses.findIndex(x=>x.id===item.id);
  if(index>=0)state.fixedExpenses[index]=item;else state.fixedExpenses.push(item);
  state.fixedExpenses.sort((a,b)=>a.startDate.localeCompare(b.startDate));
  save();resetExpenseForm();renderFixedExpenses();toast(index>=0?"固定支出已更新":"固定支出已新增");
}
function editFixedExpense(id){
  const item=state.fixedExpenses.find(x=>x.id===id);if(!item)return;
  $("expenseEditId").value=item.id;$("expenseName").value=item.name;$("expenseStartDate").value=item.startDate;
  $("expensePrincipal").value=item.principal;$("expenseTermMonths").value=item.termMonths;$("expenseGraceMonths").value=item.graceMonths;
  $("expenseRate").value=item.annualRate;$("expenseShare").value=item.sharePercent;
  $("expenseFormTitle").textContent="修改固定支出";$("saveExpense").textContent="儲存修改";$("cancelExpenseEdit").hidden=false;
  updateExpensePreview();$("expenses").scrollIntoView({behavior:"smooth",block:"start"});
}
function deleteFixedExpense(id){
  const item=state.fixedExpenses.find(x=>x.id===id);if(!item)return;
  if(!confirm(`確定刪除「${item.name}」？`))return;
  state.fixedExpenses=state.fixedExpenses.filter(x=>x.id!==id);save();renderFixedExpenses();toast("固定支出已刪除");
}
function renderFixedExpenses(){
  const total=fixedExpenseTotals();
  if($("expenseMonthlyTotal"))$("expenseMonthlyTotal").textContent=money(total.user);
  if($("expenseFullTotal"))$("expenseFullTotal").textContent=money(total.full);
  if($("expenseActiveCount"))$("expenseActiveCount").textContent=`${total.active} 筆`;
  if($("expenseStatusText"))$("expenseStatusText").textContent=state.fixedExpenses.length?`${state.fixedExpenses.length} 筆合約${total.grace?`｜${total.grace} 筆寬限期`:""}`:"尚未新增資料";
  const list=$("expenseList");if(!list)return;
  if(!state.fixedExpenses.length){list.innerHTML='<div class="empty-holdings">尚未新增固定支出</div>';return}
  list.innerHTML=state.fixedExpenses.map(item=>{
    const calc=calculateExpense(item);
    const progress=calc.status==="已結束"?100:calc.status==="尚未開始"?0:Math.min(100,Math.max(0,(calc.elapsed/calc.totalMonths)*100));
    return `<article class="expense-record-card">
      <div class="expense-record-head">
        <div><span class="expense-status ${calc.status==="進行中"?"active":calc.status==="尚未開始"?"future":"ended"}">${escapeExpenseHtml(calc.phase)}</span>
          <h3>${escapeExpenseHtml(item.name)}</h3></div>
        <strong>${money(calc.userMonthly)}<small>／月</small></strong>
      </div>
      <div class="expense-record-meta">
        <div><span>合約月付</span><strong>${money(calc.fullMonthly)}</strong></div>
        <div><span>我的負擔</span><strong>${fmt(item.sharePercent,1)}%</strong></div>
        <div><span>利率</span><strong>${fmt(item.annualRate,3)}%</strong></div>
        <div><span>寬限期</span><strong>${item.graceMonths} 個月</strong></div>
      </div>
      <div class="expense-progress-info">
        <div><span>目前進度</span><strong>${calc.status==="尚未開始"?"尚未開始":`第 ${calc.currentMonth} / ${calc.totalMonths} 個月`}</strong></div>
        <div><span>累積已還（我的負擔）</span><strong>${money(calc.cumulativeUser)}</strong></div>
        <div><span>剩餘期數</span><strong>${calc.remainingMonths} 個月</strong></div>
        <div><span>預計完成</span><strong>${calc.completionYearMonth}</strong></div>
      </div>
      <div class="expense-progress" role="progressbar" aria-label="還款進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div>
      <div class="expense-progress-caption"><span>已完成 ${fmt(progress,1)}%</span><span>累積合約還款 ${money(calc.cumulativeFull)}</span></div>
      <div class="expense-record-foot">
        <small>${item.startDate} 開始｜總期數 ${item.termMonths} 個月｜合約額 ${money(item.principal)}</small>
        <div class="expense-icon-actions">
          <button class="holding-icon-btn edit-icon" onclick="editFixedExpense('${item.id}')" aria-label="修改" title="修改"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-2.4 2.4-2.1-2.1a4 4 0 0 0 5 5l7.4 7.4a2 2 0 0 1-2.8 2.8l-7.4-7.4a4 4 0 0 0-5-5l2.1 2.1-2.4 2.4-2.1-2.1a4 4 0 0 0 5 5"/></svg></button>
          <button class="holding-icon-btn delete-icon" onclick="deleteFixedExpense('${item.id}')" aria-label="刪除" title="刪除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg></button>
        </div>
      </div>
    </article>`;
  }).join("");
}
window.editFixedExpense=editFixedExpense;
window.deleteFixedExpense=deleteFixedExpense;

const PAGE_META={
  dashboard:{label:"首頁",icon:"nav-dashboard.png"},
  portfolio:{label:"持股",icon:"nav-portfolio.png"},
  allocation:{label:"資產配置",icon:"nav-allocation.png"},
  rebalance:{label:"聰明再平衡",icon:"nav-rebalance.png"},
  risk:{label:"風險模擬",icon:"nav-risk.png"},
  history:{label:"資產歷史",icon:"nav-history.png"},
  expenses:{label:"固定支出",icon:"nav-expenses.png"},
  settings:{label:"設定",icon:"nav-settings.png"}
};

function openMenu(){
  $("sideMenu").classList.add("open");
  $("menuOverlay").classList.add("show");
  $("sideMenu").setAttribute("aria-hidden","false");
  $("menuButton").setAttribute("aria-expanded","true");
  document.body.classList.add("menu-open");
}

function closeMenu(){
  $("sideMenu").classList.remove("open");
  $("menuOverlay").classList.remove("show");
  $("sideMenu").setAttribute("aria-hidden","true");
  $("menuButton").setAttribute("aria-expanded","false");
  document.body.classList.remove("menu-open");
}

function switchPage(tab){
  const selected=PAGE_META[tab]?tab:"dashboard";
  const meta=PAGE_META[selected];
  document.querySelectorAll(".side-menu-nav button").forEach(x=>x.classList.toggle("active",x.dataset.tab===selected));
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.toggle("active",p.id===selected));
  document.body.dataset.activeTab=selected;
  $("currentPageTitle").textContent=meta.label;
  $("currentPageLabel").textContent=meta.label;
  $("currentPageIcon").src=meta.icon;
  $("pageHeader").hidden=selected==="dashboard";
  closeMenu();
  window.scrollTo({top:0,behavior:"smooth"});
  render();
  if(selected==="allocation")requestAnimationFrame(()=>{renderMarketPie();renderPie()});
}

$("menuButton").onclick=openMenu;
$("closeMenu").onclick=closeMenu;
$("menuOverlay").onclick=closeMenu;
document.querySelectorAll(".side-menu-nav button").forEach(b=>b.onclick=()=>switchPage(b.dataset.tab));
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});

switchPage("dashboard");if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js?v=12.3.3").catch(()=>{});


function getCurrentHoldingValues(){
  return state.holdings.map((h,index)=>({
    index,
    symbol:h.symbol,
    name:h.name||h.symbol,
    value:valueTwd(h),
    shares:n(h.shares),
    unitPriceTwd:holdingUnitPrice(h)*(h.market==="US"?n(state.fxRate):1),
    market:h.market
  }));
}
function groupedSymbols(){
  const set=new Set();
  (state.allocationGroups||[]).forEach(g=>(g.members||[]).forEach(symbol=>set.add(symbol)));
  return set;
}
function renderAllocationGroups(){
  const box=$("allocationGroupList");if(!box)return;
  const holdings=state.holdings||[];
  if(!(state.allocationGroups||[]).length){
    box.innerHTML='<div class="empty-target">尚未建立同性質群組。例：00662 + QQQM 可設為同一群，群組目標 20%。</div>';
    return;
  }
  box.innerHTML=state.allocationGroups.map((g,idx)=>{
    const members=new Set(g.members||[]);
    return `<div class="allocation-group-card" data-group-id="${g.id}">
      <div class="allocation-group-head">
        <input class="group-name-input" data-group-name="${g.id}" value="${escapeExpenseHtml(g.name)}" aria-label="群組名稱">
        <div class="percent-input group-target-input"><input data-group-target="${g.id}" type="number" min="0" max="100" step="0.1" inputmode="decimal" value="${n(g.target)}"><span>%</span></div>
        <button type="button" class="group-delete-button" data-group-delete="${g.id}" aria-label="刪除群組">×</button>
      </div>
      <div class="group-member-title">選擇視為同性質的持股</div>
      <div class="group-member-grid">${holdings.length?holdings.map(h=>`<label class="group-member-chip ${members.has(h.symbol)?"selected":""}"><input type="checkbox" data-group-member="${g.id}" value="${h.symbol}" ${members.has(h.symbol)?"checked":""}><span>${h.symbol}</span><small>${h.market==="TW"?"台股":"美股"}</small></label>`).join(""):'<span class="muted-copy">請先加入持股</span>'}</div>
      <small class="group-rule-note">此比例套用到整個群組，不限制群組內單一標的比例；系統會優先用同市場資金調整，減少換匯。</small>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-group-name]").forEach(input=>input.addEventListener("change",()=>{const g=state.allocationGroups.find(x=>x.id===input.dataset.groupName);if(g){g.name=input.value.trim()||"未命名群組";save();}}));
  box.querySelectorAll("[data-group-target]").forEach(input=>input.addEventListener("input",()=>{const g=state.allocationGroups.find(x=>x.id===input.dataset.groupTarget);if(g){g.target=Math.max(0,Math.min(100,n(input.value)));save();updateTargetWeightTotal();}}));
  box.querySelectorAll("[data-group-member]").forEach(input=>input.addEventListener("change",()=>{
    const group=state.allocationGroups.find(x=>x.id===input.dataset.groupMember);if(!group)return;
    const symbol=input.value;
    if(input.checked){
      state.allocationGroups.forEach(g=>{if(g.id!==group.id)g.members=(g.members||[]).filter(s=>s!==symbol)});
      if(!group.members.includes(symbol))group.members.push(symbol);
    }else group.members=group.members.filter(s=>s!==symbol);
    save();renderAllocationGroups();renderTargetWeightList();updateTargetWeightTotal();
  }));
  box.querySelectorAll("[data-group-delete]").forEach(button=>button.addEventListener("click",()=>{state.allocationGroups=state.allocationGroups.filter(g=>g.id!==button.dataset.groupDelete);save();renderAllocationGroups();renderTargetWeightList();updateTargetWeightTotal();}));
}
function addAllocationGroup(){
  const name=prompt("群組名稱（例如 NASDAQ 100）","同性質資產");if(name===null)return;
  state.allocationGroups=state.allocationGroups||[];
  state.allocationGroups.push({id:`group-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:name.trim()||"同性質資產",target:0,members:[]});
  save();renderAllocationGroups();renderTargetWeightList();updateTargetWeightTotal();
}
function renderTargetWeightList(){
  const box=$("targetWeightList");if(!box)return;
  const saved=state.targetWeights||{};
  const grouped=groupedSymbols();
  const holdings=state.holdings.filter(h=>!grouped.has(h.symbol));
  if(!state.holdings.length){
    box.innerHTML='<div class="empty-target">請先在「持股」頁加入股票。</div>';
    if($("targetWeightTotal"))$("targetWeightTotal").textContent="0%";
    return;
  }
  if(!holdings.length){box.innerHTML='<div class="empty-target">所有持股都已由同性質群組管理。</div>';updateTargetWeightTotal();return;}
  box.innerHTML=holdings.map((h,i)=>`
    <label class="target-weight-row">
      <div><strong>${h.symbol}</strong><small>${h.name||h.symbol}</small></div>
      <div class="percent-input"><input class="target-weight-input" data-symbol="${h.symbol}" type="number" min="0" max="100" step="0.1" inputmode="decimal" value="${saved[h.symbol]??""}" placeholder="0"><span>%</span></div>
    </label>`).join("");
  box.querySelectorAll(".target-weight-input").forEach(input=>{
    input.addEventListener("input",()=>{
      state.targetWeights=state.targetWeights||{};
      state.targetWeights[input.dataset.symbol]=Math.max(0,Math.min(100,n(input.value)));
      save();updateTargetWeightTotal();
    });
  });
  updateTargetWeightTotal();
}
function getTargetWeightMap(){
  const result={};
  document.querySelectorAll(".target-weight-input").forEach(input=>{result[input.dataset.symbol]=Math.max(0,Math.min(100,n(input.value)));});
  return result;
}
function effectiveTargetTotal(){
  const weights=getTargetWeightMap();
  const individual=Object.values(weights).reduce((a,b)=>a+b,0);
  const groups=(state.allocationGroups||[]).reduce((a,g)=>a+n(g.target),0);
  return individual+groups;
}
function updateTargetWeightTotal(){
  const total=effectiveTargetTotal();
  const el=$("targetWeightTotal");
  if(el){el.textContent=`${fmt(total,1)}%`;el.className=Math.abs(total-100)<0.01?"positive":"negative";}
  const groupTotal=$("groupTargetTotal");if(groupTotal)groupTotal.textContent=`${fmt((state.allocationGroups||[]).reduce((a,g)=>a+n(g.target),0),1)}%`;
}
function marketFundingHints(values,unitPlans,capital){
  const funds={TW:Math.max(0,capital)+state.cashPositions.filter(x=>x.currency==="TWD").reduce((s,x)=>s+cashValueTwd(x),0),US:state.cashPositions.filter(x=>x.currency==="USD").reduce((s,x)=>s+cashValueTwd(x),0)};
  unitPlans.filter(u=>u.diff<0).forEach(u=>{
    if(u.type==="single")funds[u.members[0].market]+=Math.abs(u.diff);
    else{
      const total=u.members.reduce((s,m)=>s+m.value,0)||1;
      u.members.forEach(m=>funds[m.market]+=Math.abs(u.diff)*(m.value/total));
    }
  });
  return funds;
}
function chooseGroupBuyMembers(unit,funds){
  return [...unit.members].sort((a,b)=>{
    const fundingDiff=(funds[b.market]||0)-(funds[a.market]||0);if(Math.abs(fundingDiff)>1)return fundingDiff;
    return a.value-b.value;
  });
}
function calculateRebalance(){
  const capital=Math.max(0,n($("newCapital")?.value));
  const values=getCurrentHoldingValues();
  const weights=getTargetWeightMap();
  const box=$("rebalanceResult");if(!box)return;
  if(!values.length){box.innerHTML='<div class="result-row"><small>請先加入持股。</small></div>';return;}

  const groups=(state.allocationGroups||[]).filter(g=>(g.members||[]).length>0&&n(g.target)>=0);
  const grouped=new Set(groups.flatMap(g=>g.members));
  const sumW=Object.values(weights).reduce((a,b)=>a+n(b),0)+groups.reduce((a,g)=>a+n(g.target),0);
  if(Math.abs(sumW-100)>0.01){box.innerHTML=`<div class="result-row warning-row"><small>有效目標比例合計為 ${fmt(sumW,1)}%，請將「群組比例＋未分組個別比例」調整為 100%。</small></div>`;return;}
  const duplicateSymbols=[];const seen=new Set();groups.forEach(g=>g.members.forEach(s=>{if(seen.has(s))duplicateSymbols.push(s);seen.add(s)}));
  if(duplicateSymbols.length){box.innerHTML=`<div class="result-row warning-row"><small>${[...new Set(duplicateSymbols)].join("、")} 同時存在多個群組，請重新選擇。</small></div>`;return;}

  state.targetWeights=weights;save();
  // 聰明再平衡的比例基準必須與首頁「總資產」一致：持股 + 現金。
  // 這樣「00662 + QQQM = 總資產 20%」才不會因現金被排除而得到不同數字。
  const portfolioTotals=totals();
  const currentTotal=portfolioTotals.total;
  const availableCash=portfolioTotals.cash;
  const targetTotal=currentTotal+capital;
  const bySymbol=new Map(values.map(v=>[v.symbol,v]));
  const units=[];
  groups.forEach(g=>{const members=g.members.map(s=>bySymbol.get(s)).filter(Boolean);if(!members.length)return;const value=members.reduce((s,m)=>s+m.value,0),targetPct=n(g.target),targetValue=targetTotal*targetPct/100;units.push({type:"group",id:g.id,name:g.name,targetPct,targetValue,value,diff:targetValue-value,members});});
  values.filter(v=>!grouped.has(v.symbol)).forEach(v=>{const targetPct=n(weights[v.symbol]),targetValue=targetTotal*targetPct/100;units.push({type:"single",id:v.symbol,name:v.symbol,targetPct,targetValue,value:v.value,diff:targetValue-v.value,members:[v]});});

  const funds=marketFundingHints(values,units,capital);
  const symbolDiff=new Map(values.map(v=>[v.symbol,0]));
  const groupNotes=[];
  units.forEach(unit=>{
    if(unit.type==="single"){symbolDiff.set(unit.members[0].symbol,unit.diff);return;}
    const groupCurrentPct=currentTotal>0?unit.value/currentTotal*100:0;
    if(Math.abs(unit.diff)<=1){groupNotes.push(`<div class="smart-group-result hold-action"><div><strong>${escapeExpenseHtml(unit.name)}</strong><small>${unit.members.map(m=>m.symbol).join(" + ")}</small></div><div><span>${fmt(groupCurrentPct,1)}% → ${fmt(unit.targetPct,1)}%</span><strong>群組已接近目標</strong></div></div>`);return;}
    if(unit.diff>0){
      const ranked=chooseGroupBuyMembers(unit,funds),chosen=ranked[0];symbolDiff.set(chosen.symbol,(symbolDiff.get(chosen.symbol)||0)+unit.diff);funds[chosen.market]=Math.max(0,(funds[chosen.market]||0)-unit.diff);
      const alternatives=ranked.slice(1).map(x=>x.symbol);
      const reason=chosen.market==="US"?"優先使用美股資金互轉，減少 USD/TWD 換匯":"優先使用台幣／台股資金，減少額外換匯";
      groupNotes.push(`<div class="smart-group-result buy-action"><div><strong>${escapeExpenseHtml(unit.name)}</strong><small>${unit.members.map(m=>m.symbol).join(" + ")}</small></div><div><span>${fmt(groupCurrentPct,1)}% → ${fmt(unit.targetPct,1)}%</span><strong>建議增加 ${chosen.symbol} ${money(unit.diff)}</strong><small>${reason}${alternatives.length?`｜也可改買 ${alternatives.join(" / ")}`:""}</small></div></div>`);
    }else{
      let remain=Math.abs(unit.diff);const ranked=[...unit.members].sort((a,b)=>b.value-a.value);const sold=[];
      ranked.forEach(m=>{if(remain<=1)return;const amt=Math.min(remain,m.value);if(amt>0){symbolDiff.set(m.symbol,(symbolDiff.get(m.symbol)||0)-amt);remain-=amt;funds[m.market]=(funds[m.market]||0)+amt;sold.push(`${m.symbol} ${money(amt)}`);}});
      groupNotes.push(`<div class="smart-group-result sell-action"><div><strong>${escapeExpenseHtml(unit.name)}</strong><small>${unit.members.map(m=>m.symbol).join(" + ")}</small></div><div><span>${fmt(groupCurrentPct,1)}% → ${fmt(unit.targetPct,1)}%</span><strong>群組需減碼 ${money(Math.abs(unit.diff))}</strong><small>建議先從目前部位較大的標的減碼：${sold.join("、")}</small></div></div>`);
    }
  });

  const rows=values.map(x=>{const diff=symbolDiff.get(x.symbol)||0;let action="維持";if(diff>1)action="買入";else if(diff<-1)action="賣出";return {...x,targetValue:x.value+diff,currentPct:currentTotal>0?x.value/currentTotal*100:0,targetPct:targetTotal>0?(x.value+diff)/targetTotal*100:0,diff,action,isExit:x.value+diff<=1&&x.value>0};});
  const buyTotal=rows.filter(x=>x.diff>1).reduce((s,x)=>s+x.diff,0),sellTotal=rows.filter(x=>x.diff<-1).reduce((s,x)=>s+Math.abs(x.diff),0),net=buyTotal-sellTotal;
  // Beta 直接使用 holding.beta；若該持股是手動 Beta，這裡會用使用者輸入值。
  // 未知 Beta 不再默默當成 0，以免低估再平衡後風險。
  let projectedBetaValue=0,projectedBetaKnownValue=0;
  const missingBetaSymbols=[];
  rows.forEach(x=>{
    const h=state.holdings[x.index];
    const targetValue=Math.max(0,x.targetValue);
    if(targetValue<=1)return;
    if(validBeta(h)){
      projectedBetaValue+=targetValue*n(h.beta);
      projectedBetaKnownValue+=targetValue;
    }else missingBetaSymbols.push(x.symbol);
  });
  const projectedBetaCoverage=targetTotal>0?projectedBetaKnownValue/targetTotal*100:0;
  const projectedBeta=targetTotal>0?projectedBetaValue/targetTotal:null;
  const betaGap=projectedBeta===null?null:projectedBeta-targetBeta();
  const betaComplete=missingBetaSymbols.length===0;
  const manualBetaSymbols=rows.filter(x=>{const h=state.holdings[x.index];return Math.max(0,x.targetValue)>1&&h?.betaManual&&validBeta(h)}).map(x=>x.symbol);
  const betaStatus=projectedBeta===null?"尚無可用 Beta":betaComplete
    ?`目標 ${fmt(targetBeta(),2)}｜${Math.abs(betaGap)<=0.03?"已接近目標":`仍相差 ${betaGap>=0?"+":""}${fmt(betaGap,2)}`}`
    :`Beta 覆蓋 ${fmt(projectedBetaCoverage,1)}%｜缺少 ${missingBetaSymbols.join("、")}，建議手動輸入後再判斷風險`;
  const betaSourceNote=manualBetaSymbols.length?`｜已採用手動 Beta：${manualBetaSymbols.join("、")}`:"";
  const summary=`<div class="rebalance-summary"><div><span>目前資產</span><strong>${money(currentTotal)}</strong></div><div><span>新增資金</span><strong>${money(capital)}</strong></div><div><span>再平衡後</span><strong>${money(targetTotal)}</strong></div></div>
  <div class="rebalance-beta-result"><span>調整後 Portfolio Beta</span><strong>${projectedBeta===null?"--":fmt(projectedBeta,2)}</strong><small>${betaStatus}${betaSourceNote}</small></div>
  ${groupNotes.length?`<div class="smart-group-results"><div class="smart-group-title"><strong>同性質群組建議</strong><small>群組內標的可互相替代；推薦順序優先降低換匯。</small></div>${groupNotes.join("")}</div>`:""}
  <div class="rebalance-flow"><span>預計賣出 <strong>${money(sellTotal)}</strong></span><span>預計買入 <strong>${money(buyTotal)}</strong></span><span>淨投入 <strong>${money(net)}</strong></span></div>`;

  const ordered=[...rows.filter(x=>x.action==="賣出").sort((a,b)=>a.diff-b.diff),...rows.filter(x=>x.action==="買入").sort((a,b)=>b.diff-a.diff),...rows.filter(x=>x.action==="維持")];
  const detail=ordered.map(x=>{
    const actionClass=x.action==="買入"?"buy-action":x.action==="賣出"?"sell-action":"hold-action",amount=Math.abs(x.diff);
    const actionText=x.isExit?`全部賣出 ${money(x.value)}`:x.action==="維持"?"無需調整":`${x.action} ${money(amount)}`;
    const rawShares=x.unitPriceTwd>0?amount/x.unitPriceTwd:0,shareDigits=x.market==="US"?4:0;
    const shareText=x.isExit?`賣出 ${fmt(x.shares,x.market==="US"?4:0)} 股`:x.action==="維持"?"股數無需調整":x.unitPriceTwd>0?`約 ${x.action} ${fmt(rawShares,shareDigits)} 股｜每股約 ${money(x.unitPriceTwd)}`:"目前價格不足，無法換算股數";
    return `<div class="rebalance-row ${actionClass}"><div class="rebalance-symbol"><strong>${x.symbol}</strong><small>${x.name}</small></div><div class="rebalance-ratio"><span>${fmt(x.currentPct,1)}%</span><b>→</b><strong>${fmt(x.targetPct,1)}%</strong></div><div class="rebalance-action"><strong>${actionText}</strong><span class="share-estimate">${shareText}</span><small>建議後市值 ${money(Math.max(0,x.targetValue))}</small></div></div>`;
  }).join("");
  box.innerHTML=summary+detail;
}
function renderStress(){
  const drop=n($("stressDrop")?.value);
  const t=totals();
  const pledged=state.pledges.map(p=>({record:p,holding:holdingForPledge(p.symbol)})).filter(x=>x.holding&&n(x.record.amount)>0);
  const pledgedValue=pledged.reduce((s,x)=>s+valueTwd(x.holding),0);
  const pledgeDebt=pledged.reduce((s,x)=>s+n(x.record.amount),0);
  const stressed=pledgedValue*(1-drop/100);
  const ratio=pledgeDebt>0?stressed/pledgeDebt*100:null;
  if($("stressDropText"))$("stressDropText").textContent=`-${drop}%`;
  if($("stressMaintenance"))$("stressMaintenance").textContent=ratio===null?"--":`${fmt(ratio,1)}%`;
  if($("stressBuffer")){
    const buffer=ratio===null?null:ratio-140;
    $("stressBuffer").textContent=buffer===null?"--":`${buffer>=0?"+":""}${fmt(buffer,1)}%`;
    $("stressBuffer").className=buffer===null?"":buffer>=30?"positive":"negative";
  }
}
function applyTheme(theme){
  const isLight=theme==="light";
  document.body.classList.toggle("light-mode",isLight);
  document.documentElement.style.colorScheme=isLight?"light":"dark";
  const toggle=$("themeToggle");
  if(toggle){toggle.textContent=isLight?"☀":"☾";toggle.setAttribute("aria-label",isLight?"切換為深色模式":"切換為亮色模式");}
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute("content",isLight?"#f4f7fb":"#081222");
  localStorage.setItem(THEME_KEY,theme);
  requestAnimationFrame(()=>{
    try{renderMarketPie();renderPie()}catch(error){console.error("Theme chart redraw failed",error)}
  });
}
document.addEventListener("DOMContentLoaded",()=>{
  applyTheme(localStorage.getItem(THEME_KEY)||"dark");
  $("themeToggle")?.addEventListener("click",()=>applyTheme(document.body.classList.contains("light-mode")?"dark":"light"));
  $("calcRebalance")?.addEventListener("click",calculateRebalance);
  $("addAllocationGroup")?.addEventListener("click",addAllocationGroup);
  $("stressDrop")?.addEventListener("input",renderStress);
  setTimeout(renderStress,50);
});
const originalRenderV5=render;
render=function(){originalRenderV5();renderStress();}

document.addEventListener("DOMContentLoaded",()=>{
  $("marketScenario")?.addEventListener("input",renderBetaScenario);
  setTimeout(()=>{renderBetaCenter();renderBetaScenario()},80);
});

function cleanBackupState(source){
  const incoming=source&&typeof source==="object"?source:{};
  return {
    ...DEFAULT,
    ...incoming,
    holdings:Array.isArray(incoming.holdings)?incoming.holdings:[],
    pledges:Array.isArray(incoming.pledges)?incoming.pledges:[],
    history:Array.isArray(incoming.history)?incoming.history:[],
    fixedExpenses:(Array.isArray(incoming.fixedExpenses)?incoming.fixedExpenses:[]).map((x,i)=>({
      ...x,
      id:String(x.id||`expense-${Date.now()}-${i}`),
      termMonths:Math.max(0,Math.round(Number(x.termMonths ?? (Number(x.termYears)||0)*12)||0)),
      graceMonths:Math.max(0,Math.round(Number(x.graceMonths ?? (Number(x.graceYears)||0)*12)||0))
    })).filter(x=>x.name&&x.startDate&&Number(x.principal)>0&&x.termMonths>0),
    targetWeights:incoming.targetWeights&&typeof incoming.targetWeights==="object"?incoming.targetWeights:{},
    allocationGroups:Array.isArray(incoming.allocationGroups)?incoming.allocationGroups:[],
    targetBeta:Math.max(0.1,Math.min(3,n(incoming.targetBeta||1.20)))
  };
}
function backupPayload(){
  const snapshot=cleanBackupState(JSON.parse(JSON.stringify(state)));
  return {
    app:"AlphaPilot",
    version:"9.3.0",
    exportedAt:new Date().toISOString(),
    summary:{holdings:snapshot.holdings.length,cashTwd:n(snapshot.cashTwd),cashUsd:n(snapshot.cashUsd),history:snapshot.history.length,fixedExpenses:snapshot.fixedExpenses.length},
    data:snapshot
  };
}
function exportBackup(){
  const status=$("backupStatus");
  try{
    const backup=backupPayload();
    const payload=JSON.stringify(backup,null,2);
    const verified=JSON.parse(payload);
    if(!Array.isArray(verified.data?.holdings))throw new Error("備份內容驗證失敗");
    const blob=new Blob([payload],{type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    const d=new Date();
    const stamp=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    a.href=url;a.download=`AlphaPilot-V12.3.3-backup-${stamp}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    if(status)status.textContent=`備份完成：${backup.summary.holdings} 檔持股、台幣現金 ${money(backup.summary.cashTwd)}。`;
  }catch(error){if(status)status.textContent=`匯出失敗：${error.message}`;}
}
async function importBackupFile(file){
  const status=$("backupStatus");
  try{
    const text=await file.text();
    const parsed=JSON.parse(text);
    const raw=parsed?.data||parsed;
    if(!raw||typeof raw!=="object"||!Array.isArray(raw.holdings))throw new Error("不是有效的 AlphaPilot 備份檔");
    const incoming=cleanBackupState(raw);
    const count=incoming.holdings.length;
    const date=parsed?.exportedAt?new Date(parsed.exportedAt).toLocaleString("zh-TW"):"日期不明";
    const cashText=`台幣 ${money(incoming.cashTwd)}／美元 ${money(incoming.cashUsd,"USD")}`;
    const ok=confirm(`備份日期：${date}\n持股數量：${count} 檔\n現金：${cashText}\n歷史紀錄：${incoming.history.length} 筆\n\n還原後會覆蓋目前資料，確定繼續嗎？`);
    if(!ok){if(status)status.textContent="已取消匯入。";return}
    localStorage.setItem(KEY,JSON.stringify(incoming));
    const stored=JSON.parse(localStorage.getItem(KEY)||"null");
    if(!stored||!Array.isArray(stored.holdings))throw new Error("資料寫入手機儲存空間失敗");
    if(stored.holdings.length!==count||n(stored.cashTwd)!==n(incoming.cashTwd)||n(stored.cashUsd)!==n(incoming.cashUsd))throw new Error("寫入後驗證不一致，已停止還原");
    state=cleanBackupState(stored);
    render();renderAllocationGroups();renderTargetWeightList();
    if(status)status.textContent=`匯入成功：${count} 檔持股，現金與設定已載入。`;
    toast("記錄檔匯入成功");
  }catch(error){if(status)status.textContent=`匯入失敗：${error.message}`;toast("記錄檔匯入失敗");}
  finally{if($("importBackupFile"))$("importBackupFile").value="";}
}

document.addEventListener("DOMContentLoaded",()=>{
  $("exportBackup")?.addEventListener("click",exportBackup);
  $("chooseBackup")?.addEventListener("click",()=>$("importBackupFile")?.click());
  $("importBackupFile")?.addEventListener("change",e=>{
    const file=e.target.files?.[0];
    if(file)importBackupFile(file);
  });
  setTimeout(()=>{renderAllocationGroups();renderTargetWeightList();},100);
});

document.addEventListener("DOMContentLoaded",()=>{
  $("openBetaAdvisor")?.addEventListener("click",()=>switchPage("allocation"));
  $("openPledgeRisk")?.addEventListener("click",()=>{switchPage("risk");setTimeout(()=>$("pledgeHoldingList")?.scrollIntoView({behavior:"smooth",block:"start"}),120);});
  $("targetBeta")?.addEventListener("change",()=>{state.targetBeta=Math.max(0.1,Math.min(3,n($("targetBeta").value)||1.20));save();render();});
});


document.addEventListener("DOMContentLoaded",()=>{
  if($("expenseStartDate")&&!$("expenseStartDate").value)$("expenseStartDate").value=new Date().toISOString().slice(0,10);
  ["expenseName","expenseStartDate","expensePrincipal","expenseTermMonths","expenseGraceMonths","expenseRate","expenseShare"].forEach(id=>{
    $(id)?.addEventListener("input",updateExpensePreview);
    $(id)?.addEventListener("change",updateExpensePreview);
  });
  $("saveExpense")?.addEventListener("click",saveFixedExpense);
  $("cancelExpenseEdit")?.addEventListener("click",resetExpenseForm);
  $("clearExpenses")?.addEventListener("click",()=>{
    if(!state.fixedExpenses.length)return;
    if(!confirm("確定清除全部固定支出？"))return;
    state.fixedExpenses=[];save();resetExpenseForm();renderFixedExpenses();toast("固定支出已全部清除");
  });
  renderFixedExpenses();updateExpensePreview();
});


// AlphaPilot V10.0.0 — subtle value transition without changing financial logic
function installPremiumValueMotion(){
  const ids=["totalTwd","dailyPnl","dailyPnlPct","twTotal","usTotal","cashTotal","portfolioBeta","investmentScore","lowestPledgeRatio"];
  ids.forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    const observer=new MutationObserver(()=>{
      el.classList.remove("value-pop");
      void el.offsetWidth;
      el.classList.add("value-pop");
    });
    observer.observe(el,{childList:true,characterData:true,subtree:true});
  });
}
document.addEventListener("DOMContentLoaded",installPremiumValueMotion);


// AlphaPilot V10.0.0 — premium motion, isolated from financial logic
function replayAllocationMotion(){
  ["marketChart","allocationChart"].forEach(id=>{
    const canvas=document.getElementById(id);if(!canvas)return;
    canvas.classList.remove("chart-reveal");void canvas.offsetWidth;canvas.classList.add("chart-reveal");
  });
}
function installRefreshMotion(){
  const button=document.getElementById("refreshAll");if(!button)return;
  const originalHandler=button.onclick;
  button.onclick=async event=>{
    if(button.classList.contains("is-loading"))return;
    button.classList.add("is-loading");button.setAttribute("aria-busy","true");
    try{return await originalHandler?.call(button,event)}finally{button.classList.remove("is-loading");button.removeAttribute("aria-busy")}
  };
}
function installPageMotionHooks(){
  const navButtons=document.querySelectorAll(".side-menu-nav button");
  navButtons.forEach(button=>button.addEventListener("click",()=>{
    if(button.dataset.tab==="allocation")setTimeout(replayAllocationMotion,40);
  }));
  document.querySelectorAll(".summary-card").forEach(card=>card.classList.add("interactive-card"));
}
document.addEventListener("DOMContentLoaded",()=>{installRefreshMotion();installPageMotionHooks();});


// AlphaPilot V12.3.3 — auto-upgrade manual Beta when historical data becomes sufficient
(() => {
  let deferredInstallPrompt = null;
  let waitingWorker = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const splash = document.getElementById('pwaSplash');
  const installCard = document.getElementById('pwaInstallCard');
  const installButton = document.getElementById('pwaInstallButton');
  const installClose = document.getElementById('pwaInstallClose');
  const installText = document.getElementById('pwaInstallText');
  const updateCard = document.getElementById('pwaUpdateCard');
  const updateButton = document.getElementById('pwaUpdateButton');

  const hideSplash = () => splash?.classList.add('is-hidden');
  window.addEventListener('load', () => setTimeout(hideSplash, 380), { once: true });
  setTimeout(hideSplash, 1800);

  const dismissedAt = Number(localStorage.getItem('alphapilot-pwa-dismissed') || 0);
  const canSuggest = !isStandalone() && Date.now() - dismissedAt > 7 * 86400000;
  const showInstallCard = () => { if (canSuggest && installCard) installCard.hidden = false; };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installText) installText.textContent = '加入主畫面後，可像 App 一樣全螢幕開啟。';
    setTimeout(showInstallCard, 1200);
  });

  if (isIOS && canSuggest) {
    if (installText) installText.textContent = '點 Safari 分享按鈕，再選「加入主畫面」。';
    setTimeout(showInstallCard, 1500);
  }

  installButton?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      if (installCard) installCard.hidden = true;
      return;
    }
    if (isIOS) alert('請點 Safari 下方的「分享」按鈕，選擇「加入主畫面」，再按右上角「加入」。');
  });
  installClose?.addEventListener('click', () => {
    if (installCard) installCard.hidden = true;
    localStorage.setItem('alphapilot-pwa-dismissed', String(Date.now()));
  });
  window.addEventListener('appinstalled', () => {
    if (installCard) installCard.hidden = true;
    localStorage.setItem('alphapilot-pwa-installed', '1');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      if (registration.waiting) { waitingWorker = registration.waiting; if (updateCard) updateCard.hidden = false; }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = worker;
            if (updateCard) updateCard.hidden = false;
          }
        });
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  }
  updateButton?.addEventListener('click', () => waitingWorker?.postMessage({ type: 'SKIP_WAITING' }));
})();
