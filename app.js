
const $=id=>document.getElementById(id);
const KEY="stockDashboardV3";
const DEFAULT={holdings:[],cashTwd:0,cashUsd:0,pledgeDebt:0,fxRate:32.5,workerUrl:"https://stock-dashboard-api.eric760614.workers.dev",finnhubKey:"",history:[]};
let state=(()=>{try{return {...DEFAULT,...JSON.parse(localStorage.getItem(KEY)||"{}")}}catch{return {...DEFAULT}}})();
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const money=(v,c="TWD")=>new Intl.NumberFormat("zh-TW",{style:"currency",currency:c,maximumFractionDigits:c==="TWD"?0:2}).format(n(v));
const fmt=(v,d=2)=>n(v).toLocaleString("zh-TW",{maximumFractionDigits:d});
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const toast=m=>{const e=$("toast");e.textContent=m;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2200)};
const now=()=>new Date().toLocaleString("zh-TW",{hour12:false});
const valueTwd=h=>n(h.price)*n(h.shares)*(h.market==="US"?n(state.fxRate):1);
const prevTwd=h=>n(h.previousClose)*n(h.shares)*(h.market==="US"?n(state.fxRate):1);

function totals(){
  let tw=0,us=0,daily=0,base=0,pledge=0;
  state.holdings.forEach(h=>{
    const local=n(h.price)*n(h.shares);
    h.market==="TW"?tw+=local:us+=local;
    if(n(h.previousClose)>0){daily+=valueTwd(h)-prevTwd(h);base+=prevTwd(h)}
    pledge+=valueTwd(h)*n(h.pledgeRatio)/100;
  });
  const cash=n(state.cashTwd)+n(state.cashUsd)*n(state.fxRate);
  return {tw,us,daily,base,pledge,cash,total:tw+us*n(state.fxRate)+cash};
}

function render(){
  const t=totals();
  $("totalTwd").textContent=money(t.total);$("twTotal").textContent=money(t.tw);$("usTotal").textContent=money(t.us,"USD");
  $("cashTotal").textContent=money(t.cash);$("pledgeTotal").textContent=money(t.pledge);$("pledgeHolding").textContent=money(t.pledge);
  $("pledgeRemaining").textContent=money(Math.max(0,t.pledge-n(state.pledgeDebt)));
  const pledgedValue=state.holdings.filter(h=>n(h.pledgeRatio)>0).reduce((s,h)=>s+valueTwd(h),0);
  $("maintenanceRatio").textContent=n(state.pledgeDebt)>0?`${fmt(pledgedValue/n(state.pledgeDebt)*100,1)}%`:"--";
  $("dailyPnl").textContent=money(t.daily);$("dailyPnlPct").textContent=t.base?`${t.daily>=0?"+":""}${fmt(t.daily/t.base*100,2)}%`:"0.00%";
  $("twCount").textContent=`${state.holdings.filter(h=>h.market==="TW").length} 檔`;$("fxText").textContent=`USD/TWD ${fmt(state.fxRate,4)}`;
  $("pledgeText").textContent=`借款 ${money(state.pledgeDebt)}`;
  $("lastUpdated").textContent=state.holdings.map(h=>h.updatedAt).filter(Boolean).sort().at(-1)||"尚未更新";
  renderHoldings();renderPie();renderHistory();
  $("cashTwd").value=state.cashTwd;$("cashUsd").value=state.cashUsd;$("pledgeDebt").value=state.pledgeDebt;
  $("workerUrl").value=state.workerUrl;$("finnhubKey").value=state.finnhubKey;$("fxRate").value=state.fxRate;
}

function renderHoldings(){
  $("holdingsList").innerHTML=state.holdings.map((h,i)=>{
    const c=h.market==="TW"?"TWD":"USD",change=n(h.previousClose)>0?(n(h.price)-n(h.previousClose))/n(h.previousClose)*100:null;
    return `<div class="holding"><div class="holding-top"><div><span class="holding-symbol">${h.symbol}</span><span class="pill">${h.market==="TW"?"台股":"美股"}</span></div><div class="holding-value">${money(n(h.price)*n(h.shares),c)}</div></div>
    <div class="holding-meta">${h.name||""}<br>股數 ${fmt(h.shares,4)}｜價格 ${money(h.price,c)}${change===null?"":`｜<span class="${change>=0?"positive":"negative"}">${change>=0?"+":""}${fmt(change,2)}%</span>`}${n(h.pledgeRatio)>0?`｜質押 ${fmt(h.pledgeRatio,0)}%`:""}<br>${h.updatedAt?`更新 ${h.updatedAt}`:"尚未取得報價"}${h.error?`<br><span class="holding-error">${h.error}</span>`:""}</div>
    <div class="holding-actions"><button onclick="refreshHolding(${i})">更新</button><button onclick="editHolding(${i})">修改</button><button class="remove" onclick="removeHolding(${i})">刪除</button></div></div>`;
  }).join("");
}

async function fetchTw(symbol){
  const r=await fetch(`${state.workerUrl.replace(/\/+$/,"")}/tw?symbol=${encodeURIComponent(symbol)}`,{cache:"no-store"});
  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||`HTTP ${r.status}`);
  return {price:n(d.price),previousClose:n(d.previousClose),name:d.name||symbol};
}
async function fetchUs(symbol){
  if(!state.finnhubKey)throw new Error("請先設定 Finnhub API Key");
  const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(state.finnhubKey)}`,{cache:"no-store"});
  const d=await r.json();if(!r.ok||!n(d.c))throw new Error("查無美股報價");
  return {price:n(d.c),previousClose:n(d.pc),name:symbol};
}

const looksLikeTw=symbol=>/^\d{4,6}$/.test(symbol);

async function detectStock(symbol){
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
window.refreshHolding=async i=>{const h=state.holdings[i];h.error="更新中";renderHoldings();try{const q=h.market==="TW"?await fetchTw(h.symbol):await fetchUs(h.symbol);Object.assign(h,q,{updatedAt:now(),error:""})}catch(e){h.error=e.message}save();render()};
window.removeHolding=i=>{state.holdings.splice(i,1);save();render()};
window.editHolding=i=>{const h=state.holdings[i],s=prompt(`${h.symbol} 股數`,h.shares);if(s===null)return;const p=prompt(`${h.symbol} 手動價格`,h.price||"");if(p===null)return;const g=prompt(`${h.symbol} 質押成數 %`,h.pledgeRatio||0);if(g===null)return;h.shares=n(s);if(p!==""){h.price=n(p);h.updatedAt=`手動 ${now()}`}h.pledgeRatio=Math.max(0,Math.min(100,n(g)));save();render()};

function renderPie(){
  const canvas=$("allocationChart"),ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height,map=new Map();
  state.holdings.forEach(x=>map.set(x.symbol,(map.get(x.symbol)||0)+valueTwd(x)));
  const cash=n(state.cashTwd)+n(state.cashUsd)*n(state.fxRate);if(cash>0)map.set("現金",cash);
  const data=[...map.entries()].filter(([,v])=>v>0),total=data.reduce((s,[,v])=>s+v,0);ctx.clearRect(0,0,w,h);
  if(!total){ctx.fillStyle="#98a8c1";ctx.font="26px sans-serif";ctx.textAlign="center";ctx.fillText("尚無資料",w/2,h/2);$("allocationLegend").innerHTML="";return}
  let a=-Math.PI/2,r=Math.min(w,h)*.36,cx=w/2,cy=h/2;
  data.forEach(([,v],i)=>{const b=a+v/total*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,a,b);ctx.closePath();ctx.fillStyle=`hsl(${(i*67+210)%360} 65% 55%)`;ctx.fill();a=b});
  ctx.beginPath();ctx.arc(cx,cy,r*.55,0,Math.PI*2);ctx.fillStyle="#101c30";ctx.fill();ctx.fillStyle="#fff";ctx.textAlign="center";ctx.font="bold 26px sans-serif";ctx.fillText("總資產",cx,cy-4);ctx.font="20px sans-serif";ctx.fillText(money(total),cx,cy+28);
  $("allocationLegend").innerHTML=data.map(([k,v])=>`<div class="legend-row"><span>${k}</span><strong>${fmt(v/total*100,1)}%</strong></div>`).join("");
}

function renderHistory(){
  const c=$("historyChart"),ctx=c.getContext("2d"),w=c.width,h=c.height,p=45,d=state.history.slice(-30);ctx.clearRect(0,0,w,h);
  if(d.length<2){ctx.fillStyle="#98a8c1";ctx.font="22px sans-serif";ctx.textAlign="center";ctx.fillText("至少記錄兩次後顯示曲線",w/2,h/2)}else{const vals=d.map(x=>n(x.total)),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;ctx.strokeStyle="#2f64e9";ctx.lineWidth=5;ctx.beginPath();d.forEach((x,i)=>{const px=p+i*(w-2*p)/(d.length-1),py=h-p-(n(x.total)-min)/range*(h-2*p);i?ctx.lineTo(px,py):ctx.moveTo(px,py)});ctx.stroke()}
  $("historyList").innerHTML=d.slice(-10).reverse().map(x=>`<div class="history-item"><span>${x.date}</span><strong>${money(x.total)}</strong></div>`).join("");
}

$("addHolding").onclick=async()=>{
  const symbol=$("symbol").value.trim().toUpperCase().replace(/\s+/g,"");
  const shares=n($("shares").value),manualPrice=n($("manualPrice").value),pledge=n($("pledgeRatio").value);
  if(!symbol||shares<=0)return toast("請輸入股票代號與持有股數");
  if(state.holdings.some(h=>h.symbol===symbol))return toast("這個股票代號已經加入");

  const button=$("addHolding");
  const originalText=button.textContent;
  button.disabled=true;
  button.textContent="正在辨識股票…";
  $("symbolStatus").textContent="正在自動判斷台股或美股";
  $("symbolStatus").className="field-status";

  try{
    const detected=await detectStock(symbol);
    const price=manualPrice>0?manualPrice:detected.price;
    state.holdings.push({
      market:detected.market,
      symbol,
      shares,
      price,
      previousClose:detected.previousClose,
      pledgeRatio:Math.max(0,Math.min(100,pledge)),
      name:detected.name||symbol,
      updatedAt:manualPrice>0?`手動 ${now()}`:now(),
      error:""
    });
    save();
    render();
    $("symbol").value="";
    $("shares").value="";
    $("manualPrice").value="";
    $("pledgeRatio").value="";
    $("symbolStatus").textContent=`已辨識為${detected.market==="TW"?"台股":"美股"}：${detected.name||symbol}`;
    $("symbolStatus").className="field-status success";
    toast(`已加入${detected.market==="TW"?"台股":"美股"} ${symbol}`);
  }catch(e){
    $("symbolStatus").textContent=e.message;
    $("symbolStatus").className="field-status error";
    toast(e.message);
  }finally{
    button.disabled=false;
    button.textContent=originalText;
  }
};
$("refreshAll").onclick=async()=>{try{const r=await fetch(`${state.workerUrl.replace(/\/+$/,"")}/fx`),d=await r.json();if(d.ok)state.fxRate=n(d.rate)}catch{}for(let i=0;i<state.holdings.length;i++)await refreshHolding(i);save();render();toast("更新完成")};
$("clearHoldings").onclick=()=>{if(confirm("確定刪除全部持股？")){state.holdings=[];save();render()}};
$("saveCash").onclick=()=>{state.cashTwd=n($("cashTwd").value);state.cashUsd=n($("cashUsd").value);save();render();toast("現金已儲存")};
$("savePledge").onclick=()=>{state.pledgeDebt=n($("pledgeDebt").value);save();render();toast("質押借款已儲存")};
$("saveSettings").onclick=()=>{state.workerUrl=$("workerUrl").value.trim();state.finnhubKey=$("finnhubKey").value.trim();state.fxRate=n($("fxRate").value)||state.fxRate;save();render();toast("設定已儲存")};
$("testWorker").onclick=async()=>{try{const r=await fetch(`${$("workerUrl").value.trim().replace(/\/+$/,"")}/status`),d=await r.json();$("settingsStatus").textContent=d.ok?`連線正常｜版本 ${d.version}`:`失敗：${d.error}`}catch(e){$("settingsStatus").textContent=`連線失敗：${e.message}`}};
$("saveSnapshot").onclick=()=>{const date=new Date().toISOString().slice(0,10),total=totals().total,old=state.history.find(x=>x.date===date);old?old.total=total:state.history.push({date,total});save();render();toast("今天資產已記錄")};
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".tab-panel").forEach(p=>p.classList.toggle("active",p.id===b.dataset.tab));render()});
render();if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
