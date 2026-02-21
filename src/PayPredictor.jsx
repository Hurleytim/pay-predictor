import { useState, useMemo, useCallback, useEffect } from "react";

// ─── THEME ───────────────────────────────────────────────────────────────────
const T = {
  bg:"#080C18", panel:"#0C1120", card:"#101828", cardH:"#131E30",
  border:"#1A2540", borderL:"#243050", text:"#E4ECF7", muted:"#4A5A7A",
  mutedL:"#7A8FAF", acc:"#E8A000", accL:"rgba(232,160,0,0.12)",
  green:"#00C896", greenL:"rgba(0,200,150,0.10)",
  red:"#E05555", redL:"rgba(224,85,85,0.10)",
  blue:"#4A9EFF", blueL:"rgba(74,158,255,0.10)",
  purple:"#9B6FE8", purpleL:"rgba(155,111,232,0.10)",
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const BASE_HOURS    = 6.00;
const OT_HOURS      = 2.50;
const OT_THRESHOLD  = 15;
const OVERRIDE_PCT  = 0.15;
const HOLIDAY_HOURS = 5.25;
const VAC_HOURS_DAY = 3.67;

const PAY_RATES = {
  2026: { narrow: 266.58, wide: 330.44 },
  2027: { narrow: 274.58, wide: 340.35 },
};
const CONTRACT_YEAR = new Date().getFullYear() >= 2027 ? 2027 : 2026;

const DUTY_TYPES = [
  { id:"IP",       label:"Instructor of Record",   hasOverride:true,  isCancelled:false, isVac:false, isSick:false, vacDays:0 },
  { id:"SEAT",     label:"Seat Filler",            hasOverride:true,  isCancelled:false, isVac:false, isSick:false, vacDays:0 },
  { id:"SIM",      label:"Simulator Event",        hasOverride:true,  isCancelled:false, isVac:false, isSick:false, vacDays:0 },
  { id:"PT",       label:"Practice Teaching",      hasOverride:true,  isCancelled:false, isVac:false, isSick:false, vacDays:0 },
  { id:"OBS",      label:"Observing",              hasOverride:false, isCancelled:false, isVac:false, isSick:false, vacDays:0 },
  { id:"WDAY",     label:"W Day",                  hasOverride:false, isCancelled:false, isVac:false, isSick:false, vacDays:0 },
  { id:"RECUR",    label:"Recurrent Training",     hasOverride:false, isCancelled:false, isVac:false, isSick:false, vacDays:0 },
  { id:"GROUND",   label:"Ground Training",        hasOverride:false, isCancelled:false, isVac:false, isSick:false, vacDays:0 },
  { id:"SICK",     label:"Sick",                   hasOverride:false, isCancelled:false, isVac:false, isSick:true,  vacDays:0 },
  { id:"WKCXLD",   label:"Cancelled Work Day",     hasOverride:false, isCancelled:true,  isVac:false, isSick:false, vacDays:0 },
  { id:"VAC_WEEK", label:"Vacation Week (7 days)", hasOverride:false, isCancelled:false, isVac:true,  isSick:false, vacDays:1 },
  { id:"VAC_DAY",  label:"Vacation Day",           hasOverride:false, isCancelled:false, isVac:true,  isSick:false, vacDays:1 },
];

const DOW          = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const pad2  = n => String(n).padStart(2,"0");
const fmtH  = h => Number(h).toFixed(2);
const fmtD  = n => "$" + Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const getDT = id => DUTY_TYPES.find(d => d.id === id) || DUTY_TYPES[0];

function dateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseDate(s) { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function addDays(d,n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function formatDisplay(s) {
  const d=parseDate(s);
  return `${DOW[d.getDay()]} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// ─── CALC SINGLE DAY ─────────────────────────────────────────────────────────
function calcDay(day, workDayNum) {
  if (!day.active) return { base:0, ot:0, override:0, holiday:0, vac:0, total:0 };
  const dt = getDT(day.dutyType);
  if (dt.isVac) {
    return { base:0, ot:0, override:0, holiday:0, vac:VAC_HOURS_DAY, total:VAC_HOURS_DAY };
  }
  if (dt.isSick) {
    return { base:BASE_HOURS, ot:0, override:0, holiday:0, vac:0, total:BASE_HOURS, isOT:false, overElig:false };
  }
  const base     = BASE_HOURS;
  const autoOT   = workDayNum > OT_THRESHOLD;
  const isOT     = day.otManual !== null ? day.otManual : autoOT;
  const ot       = (isOT && !dt.isCancelled) ? OT_HOURS : 0;
  const overElig = (dt.hasOverride || day.overrideOn) && !dt.isCancelled;
  const override = overElig ? OVERRIDE_PCT*(base+ot) : 0;
  const holiday  = day.holiday ? HOLIDAY_HOURS : 0;
  return { base, ot, override, holiday, vac:0, total:base+ot+override+holiday, isOT, overElig };
}

// ─── BASELINE ESTIMATE ───────────────────────────────────────────────────────
function baseSlotHours(dayNum) {
  return dayNum <= OT_THRESHOLD ? BASE_HOURS : BASE_HOURS + OT_HOURS;
}

function calcBaseline(baseDays) {
  let h=0;
  for(let i=1;i<=baseDays;i++) h += baseSlotHours(i);
  return h;
}

function calcHybridEstimate(loggedHours, loggedWorkDays, vacationDays, baseDays) {
  const usedSlots = loggedWorkDays + vacationDays;
  let remaining = 0;
  const start = usedSlots + 1;
  for(let i=start; i<=baseDays; i++) remaining += baseSlotHours(i);
  return loggedHours + remaining;
}

// ─── BUILD GRID ───────────────────────────────────────────────────────────────
function buildGrid(s, e) {
  if (!s||!e) return [];
  const start=parseDate(s), end=parseDate(e);
  if (start>end) return [];
  const days=[]; let cur=new Date(start);
  while(cur<=end){
    days.push({ date:dateStr(cur), active:false, dutyType:"IP",
      otManual:null, overrideOn:false, holiday:false });
    cur=addDays(cur,1);
  }
  return days;
}

// ─── TOGGLE ───────────────────────────────────────────────────────────────────
function Toggle({ on, onChange, color=T.acc }) {
  return (
    <div onClick={onChange} style={{ width:44,height:26,borderRadius:13,
      background:on?color:T.border, position:"relative",cursor:"pointer",
      transition:"background 0.2s", flexShrink:0 }}>
      <div style={{ position:"absolute",top:3,left:on?21:3,width:20,height:20,
        borderRadius:"50%",background:"#fff",transition:"left 0.2s",
        boxShadow:"0 1px 4px rgba(0,0,0,0.4)" }} />
    </div>
  );
}

// ─── PILL ─────────────────────────────────────────────────────────────────────
function Pill({ label, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{ padding:"6px 12px",borderRadius:20,
      border:`1px solid ${active?color:T.border}`,
      background:active?`${color}22`:"transparent",
      color:active?color:T.muted, fontSize:12,
      fontFamily:"'Roboto Mono',monospace",cursor:"pointer",
      transition:"all 0.15s",whiteSpace:"nowrap",
    }}>{label}</button>
  );
}

// ─── DAY ROW ─────────────────────────────────────────────────────────────────
function DayRow({ day, calc, workDayNum, onUpdate, isOTDay }) {
  const dt      = getDT(day.dutyType);
  const isVac   = dt.isVac;
  const isCxld  = dt.isCancelled;
  const display = formatDisplay(day.date);
  const autoOT  = workDayNum > OT_THRESHOLD;
  const showOT  = day.otManual !== null ? day.otManual : autoOT;

  const borderCol = !day.active ? T.border
    : isVac  ? T.purple
    : isCxld ? T.red
    : isOTDay? T.acc
    : T.green;

  const rowBg = !day.active ? "transparent"
    : isVac  ? T.purpleL
    : isCxld ? T.redL
    : isOTDay? T.accL
    : T.greenL;

  const upd = (k,v) => onUpdate(day.date,k,v);

  return (
    <div style={{ border:`1px solid ${borderCol}`,borderRadius:10,marginBottom:8,
      background:rowBg,overflow:"hidden",transition:"all 0.2s" }}>
      <div style={{ display:"flex",alignItems:"center",gap:10,padding:"11px 12px" }}>
        <Toggle on={day.active} onChange={() => upd("active",!day.active)} color={isVac?T.purple:isOTDay&&day.active?T.acc:T.green} />
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:18,
              color:day.active?T.text:T.muted,lineHeight:1 }}>{display}</span>
            {day.active && workDayNum && !isVac &&
              <span style={{ fontSize:10,color:isOTDay?T.acc:T.mutedL,fontFamily:"'Roboto Mono',monospace",
                background:isOTDay?T.accL:T.border,padding:"2px 6px",borderRadius:4 }}>
                Day {workDayNum}{isOTDay?" ⚡OT":""}
              </span>}
            {day.active && isVac &&
              <span style={{ fontSize:10,color:T.purple,fontFamily:"'Roboto Mono',monospace",
                background:T.purpleL,padding:"2px 6px",borderRadius:4 }}>🌴 VAC</span>}
            {day.active && getDT(day.dutyType).isSick &&
              <span style={{ fontSize:10,color:T.red,fontFamily:"'Roboto Mono',monospace",
                background:T.redL,padding:"2px 6px",borderRadius:4 }}>SICK</span>}
          </div>
          {!day.active &&
            <div style={{ fontSize:11,color:T.muted,fontFamily:"'Roboto Mono',monospace",marginTop:2 }}>Off</div>}
        </div>
        {day.active && (
          <div style={{ textAlign:"right",flexShrink:0 }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:22,
              color:isVac?T.purple:T.acc,lineHeight:1 }}>{fmtH(calc.total)}</div>
            <div style={{ fontSize:10,color:T.muted,fontFamily:"'Roboto Mono',monospace" }}>hrs</div>
          </div>
        )}
      </div>
      {day.active && (
        <div style={{ padding:"10px 12px 12px",borderTop:`1px solid ${borderCol}40` }}>
          <select value={day.dutyType} onChange={e=>upd("dutyType",e.target.value)}
            style={{ width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:6,
              padding:"9px 12px",color:T.text,fontSize:14,
              fontFamily:"'Roboto Mono',monospace",outline:"none",marginBottom:10 }}>
            {DUTY_TYPES.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          {!isVac && !dt.isSick && (
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
              {!isCxld && (
                <Pill label={`15% Override${dt.hasOverride?" (auto)":""}`}
                  active={dt.hasOverride||day.overrideOn}
                  onClick={()=>!dt.hasOverride&&upd("overrideOn",!day.overrideOn)}
                  color={T.green} />
              )}
              {!isCxld && (
                <Pill label={`OT +2.5${autoOT&&day.otManual===null?" (auto)":""}`}
                  active={showOT}
                  onClick={()=>upd("otManual",!showOT)}
                  color={T.acc} />
              )}
              <Pill label="Holiday +5.25" active={day.holiday}
                onClick={()=>upd("holiday",!day.holiday)} color={T.purple} />
              {isCxld &&
                <span style={{ fontSize:11,color:T.red,fontFamily:"'Roboto Mono',monospace",alignSelf:"center" }}>
                  Pay protected · No override
                </span>}
            </div>
          )}
          {!isVac && dt.isSick && (
            <div style={{ fontSize:11,color:T.red,fontFamily:"'Roboto Mono',monospace" }}>
              Sick day · 6.00 hrs flat · No override or OT
            </div>
          )}
          {isVac && dt.vacDays===7 && (
            <div style={{ fontSize:11,color:T.purple,fontFamily:"'Roboto Mono',monospace" }}>
              ✓ Next 7 days auto-filled as vacation
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SUMMARY TAB ─────────────────────────────────────────────────────────────
function SummaryTab({ totals, workDays, vacDays, fleet, setFleet, baseDays, baselineHrs, hasEntries }) {
  const rates   = PAY_RATES[CONTRACT_YEAR];
  const rate    = rates[fleet];
  const useHrs  = calcHybridEstimate(totals.grand, workDays, vacDays, baseDays);
  const gross   = useHrs * rate;

  const rows = [
    { label:"Base Pay Hours",          value:totals.base,     color:T.text,   code:"INSTRHRS"   },
    { label:"Overtime (2.5 hrs/day)",  value:totals.ot,       color:T.acc,    code:"INSTR OT"   },
    { label:"IP Override (15%)",       value:totals.override, color:T.green,  code:"INSTR 15"   },
    { label:"Holiday Premium",         value:totals.holiday,  color:T.purple, code:"PM HOLIDAY" },
    { label:"Vacation Hours",          value:totals.vac,      color:T.blue,   code:"VAC"        },
  ];

  return (
    <div style={{ padding:"16px 16px 60px" }}>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:2,
          fontFamily:"'Roboto Mono',monospace",marginBottom:8 }}>
          Pay Scale — {CONTRACT_YEAR} Contract
        </div>
        <div style={{ display:"flex",background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,padding:4,gap:4 }}>
          {[{id:"narrow",label:"Narrow Body",rate:rates.narrow},{id:"wide",label:"Wide Body",rate:rates.wide}].map(f=>(
            <button key={f.id} onClick={()=>setFleet(f.id)} style={{
              flex:1,padding:"10px 8px",borderRadius:6,border:"none",cursor:"pointer",
              background:fleet===f.id?T.acc:"transparent",
              color:fleet===f.id?"#000":T.muted,
              fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:15,letterSpacing:1,
              transition:"all 0.2s",
            }}>
              <div>{f.label.toUpperCase()}</div>
              <div style={{ fontSize:11,fontFamily:"'Roboto Mono',monospace",fontWeight:400,
                color:fleet===f.id?"#00000088":T.muted,marginTop:2 }}>${f.rate.toFixed(2)}/hr</div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px",marginBottom:16 }}>
        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:8 }}>
          <div style={{ fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:2,fontFamily:"'Roboto Mono',monospace" }}>Work Days</div>
          <span style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:22,
            color:workDays>OT_THRESHOLD?T.acc:T.text }}>
            {workDays} <span style={{ fontSize:13,color:T.muted }}>/ {baseDays} base</span>
          </span>
        </div>
        <div style={{ height:6,background:T.border,borderRadius:3,overflow:"hidden" }}>
          <div style={{ width:`${Math.min((workDays/18)*100,100)}%`,height:"100%",borderRadius:3,
            background:workDays>OT_THRESHOLD?T.acc:T.green,transition:"width 0.4s ease" }} />
        </div>
        <div style={{ display:"flex",justifyContent:"space-between",marginTop:5,fontSize:10,
          color:T.muted,fontFamily:"'Roboto Mono',monospace" }}>
          <span>0</span><span style={{ color:workDays>=15?T.acc:T.muted }}>15 ← OT</span><span>18</span>
        </div>
        {workDays>OT_THRESHOLD&&<div style={{ marginTop:6,fontSize:11,color:T.acc,fontFamily:"'Roboto Mono',monospace" }}>⚡ {workDays-OT_THRESHOLD} day(s) at overtime rate</div>}
        {vacDays>0&&<div style={{ marginTop:4,fontSize:11,color:T.purple,fontFamily:"'Roboto Mono',monospace" }}>🌴 {vacDays} vacation day(s) — not counted toward OT</div>}
      </div>
      <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:10,overflow:"hidden",marginBottom:16 }}>
        <div style={{ padding:"10px 16px",background:T.panel,borderBottom:`1px solid ${T.border}` }}>
          <div style={{ fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:2,fontFamily:"'Roboto Mono',monospace" }}>
            Hour Breakdown {!hasEntries&&<span style={{ color:T.acc }}>(baseline)</span>}
          </div>
        </div>
        {rows.map(r=>(
          <div key={r.label} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"12px 16px",borderBottom:`1px solid ${T.border}` }}>
            <div>
              <div style={{ fontSize:13,color:T.mutedL,fontFamily:"'Roboto Mono',monospace" }}>{r.label}</div>
              <div style={{ fontSize:10,color:T.muted,fontFamily:"'Roboto Mono',monospace",letterSpacing:1 }}>{r.code}</div>
            </div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:22,
              color:r.value>0?r.color:T.muted }}>{fmtH(r.value)}</div>
          </div>
        ))}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"14px 16px",background:T.accL }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:18,color:T.acc }}>TOTAL HOURS</div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:32,color:T.acc }}>{fmtH(useHrs)}</div>
        </div>
      </div>
      <div style={{ background:T.greenL,border:`1px solid ${T.green}40`,borderRadius:10,padding:"18px 16px" }}>
        <div style={{ fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:2,
          fontFamily:"'Roboto Mono',monospace",marginBottom:6 }}>Estimated Gross Pay</div>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:44,color:T.green }}>{fmtD(gross)}</div>
        <div style={{ fontSize:11,color:T.muted,fontFamily:"'Roboto Mono',monospace",marginTop:4 }}>
          {fmtH(useHrs)} hrs × ${rate.toFixed(2)}/hr
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function PayPredictor() {
  const now = new Date();
  const STORAGE_KEY = "pay_predictor_v1";

  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return null;
  };

  const saved = loadSaved();
  const defaultStart = dateStr(new Date(now.getFullYear(),now.getMonth(),1));
  const defaultEnd   = dateStr(new Date(now.getFullYear(),now.getMonth()+1,0));

  const [startDate, setStartDate] = useState(saved?.startDate || defaultStart);
  const [endDate,   setEndDate]   = useState(saved?.endDate   || defaultEnd);
  const [baseDays,  setBaseDays]  = useState(saved?.baseDays  || 15);
  const [fleet,     setFleet]     = useState(saved?.fleet     || "narrow");
  const [tab,       setTab]       = useState("input");
  const [days,      setDays]      = useState(() => {
    if (saved?.days?.length) return saved.days;
    return buildGrid(defaultStart, defaultEnd);
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ startDate, endDate, baseDays, fleet, days }));
    } catch(e) {}
  }, [startDate, endDate, baseDays, fleet, days]);

  const applyRange = useCallback((s,e) => {
    if(!s||!e) return;
    const sd=parseDate(s), ed=parseDate(e);
    if(sd>ed) return;
    setDays(buildGrid(s,e));
  },[]);

  const handleStart = v => { setStartDate(v); applyRange(v,endDate); };
  const handleEnd   = v => { setEndDate(v);   applyRange(startDate,v); };

  const updateDay = useCallback((date,key,value) => {
    setDays(prev => {
      const idx = prev.findIndex(d=>d.date===date);
      if(idx===-1) return prev;
      const updated = [...prev];
      if(key==="dutyType" && value==="VAC_WEEK") {
        for(let i=0; i<7 && idx+i<updated.length; i++) {
          updated[idx+i] = { ...updated[idx+i], active:true, dutyType:"VAC_DAY",
            otManual:null, overrideOn:false, holiday:false };
        }
        updated[idx] = { ...updated[idx], dutyType:"VAC_WEEK" };
        return updated;
      }
      updated[idx] = { ...updated[idx], [key]:value };
      if(key==="active" && !value) {
        updated[idx] = { ...updated[idx], otManual:null, overrideOn:false, holiday:false };
      }
      return updated;
    });
  },[]);

  const enriched = useMemo(() => {
    let wc=0;
    return days.map(day => {
      const dt     = getDT(day.dutyType);
      const isWork = day.active && !dt.isVac;
      if(isWork) wc++;
      const calc = calcDay(day, wc-(isWork?1:0));
      return { day, calc, workDayNum: isWork?wc:null };
    });
  },[days]);

  const totals = useMemo(() => {
    let base=0,ot=0,override=0,holiday=0,vac=0;
    enriched.forEach(({day,calc}) => {
      if(!day.active) return;
      const dt=getDT(day.dutyType);
      if(dt.isVac) vac+=calc.vac;
      else { base+=calc.base; ot+=calc.ot; override+=calc.override; holiday+=calc.holiday; }
    });
    return {base,ot,override,holiday,vac,grand:base+ot+override+holiday+vac};
  },[enriched]);

  const workDays    = enriched.filter(e=>e.day.active&&!getDT(e.day.dutyType).isVac).length;
  const vacDays     = enriched.filter(e=>e.day.active&&getDT(e.day.dutyType).isVac)
    .reduce((s,e)=>s+(getDT(e.day.dutyType).vacDays||1),0);
  const hasEntries  = enriched.some(e=>e.day.active);
  const baselineHrs = useMemo(()=>calcBaseline(baseDays),[baseDays]);
  const rate        = PAY_RATES[CONTRACT_YEAR][fleet];
  const displayHrs  = calcHybridEstimate(totals.grand, workDays, vacDays, baseDays);
  const grossPay    = displayHrs * rate;

  const periodLabel = startDate && endDate
    ? `${formatDisplay(startDate)} – ${formatDisplay(endDate)}`
    : "Set pay period";

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Roboto+Mono:wght@300;400;500&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    html,body{background:${T.bg};color:${T.text};font-family:'Roboto Mono',monospace;max-width:100vw;overflow-x:hidden;}
    input,select{color-scheme:dark;}
    input:focus,select:focus{border-color:${T.acc}!important;outline:none;}
    select option{background:${T.panel};}
    ::-webkit-scrollbar{width:4px;}
    ::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px;}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
  `;

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight:"100vh",background:T.bg,maxWidth:480,margin:"0 auto" }}>
        <div style={{ background:T.panel,borderBottom:`1px solid ${T.border}`,padding:"12px 16px",
          position:"sticky",top:0,zIndex:100 }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <div style={{ width:32,height:32,background:T.acc,borderRadius:7,display:"flex",
              alignItems:"center",justifyContent:"center",fontFamily:"'Barlow Condensed',sans-serif",
              fontWeight:800,fontSize:16,color:"#000",flexShrink:0 }}>✈</div>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:18,
                color:T.text,letterSpacing:2,lineHeight:1 }}>PAY PREDICTOR</div>
              <div style={{ fontSize:10,color:T.muted,letterSpacing:1,fontFamily:"'Roboto Mono',monospace",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{periodLabel}</div>
            </div>
            <div style={{ textAlign:"right",flexShrink:0 }}>
              <div style={{ fontSize:9,color:T.muted,fontFamily:"'Roboto Mono',monospace",letterSpacing:1 }}>EST. GROSS</div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:24,color:T.green,lineHeight:1 }}>
                {fmtD(grossPay)}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display:"flex",background:T.panel,borderBottom:`1px solid ${T.border}`,
          position:"sticky",top:62,zIndex:99 }}>
          {[["input","INPUT / LOG"],["summary","SUMMARY"]].map(([v,l])=>(
            <button key={v} onClick={()=>setTab(v)} style={{
              flex:1,padding:"13px 8px",border:"none",cursor:"pointer",
              fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:16,letterSpacing:1.5,
              background:"transparent",transition:"all 0.2s",
              color:tab===v?T.acc:T.muted,
              borderBottom:tab===v?`2px solid ${T.acc}`:"2px solid transparent",
            }}>{l}</button>
          ))}
        </div>
        {tab==="input" && (
          <div style={{ padding:"16px 16px 60px",animation:"fadeIn 0.2s ease" }}>
            <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:10,
              padding:"14px 16px",marginBottom:14 }}>
              <div style={{ fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:2,
                fontFamily:"'Roboto Mono',monospace",marginBottom:10 }}>Pay Period</div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                {[["START DATE",startDate,handleStart],["END DATE",endDate,handleEnd]].map(([lbl,val,fn])=>(
                  <div key={lbl}>
                    <div style={{ fontSize:10,color:T.muted,fontFamily:"'Roboto Mono',monospace",marginBottom:4 }}>{lbl}</div>
                    <input type="date" value={val} onChange={e=>fn(e.target.value)}
                      style={{ width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:6,
                        padding:"9px 10px",color:T.text,fontSize:13,fontFamily:"'Roboto Mono',monospace" }} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14 }}>
              <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px" }}>
                <div style={{ fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:2,
                  fontFamily:"'Roboto Mono',monospace",marginBottom:8 }}>Base Days Assigned</div>
                <select value={baseDays} onChange={e=>setBaseDays(Number(e.target.value))}
                  style={{ width:"100%",background:T.bg,border:`1px solid ${T.border}`,borderRadius:6,
                    padding:"9px 10px",color:T.acc,fontSize:17,fontFamily:"'Barlow Condensed',sans-serif",
                    fontWeight:700,outline:"none" }}>
                  {[14,15,16,17,18].map(n=><option key={n} value={n}>{n} days</option>)}
                </select>
                <div style={{ fontSize:10,color:T.muted,fontFamily:"'Roboto Mono',monospace",marginTop:6 }}>
                  Baseline: {fmtH(baselineHrs)} hrs
                </div>
              </div>
              <div style={{ background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px" }}>
                <div style={{ fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:2,
                  fontFamily:"'Roboto Mono',monospace",marginBottom:8 }}>Pay Scale</div>
                <div style={{ display:"flex",gap:6,marginBottom:6 }}>
                  {[{id:"narrow",label:"NB"},{id:"wide",label:"WB"}].map(f=>(
                    <button key={f.id} onClick={()=>setFleet(f.id)} style={{
                      flex:1,padding:"8px 4px",borderRadius:6,
                      border:`1px solid ${fleet===f.id?T.acc:T.border}`,
                      background:fleet===f.id?T.accL:"transparent",
                      color:fleet===f.id?T.acc:T.muted,
                      fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:18,
                      cursor:"pointer",transition:"all 0.15s",
                    }}>{f.label}</button>
                  ))}
                </div>
                <div style={{ fontSize:10,color:T.muted,fontFamily:"'Roboto Mono',monospace" }}>
                  ${rate.toFixed(2)}/hr · {CONTRACT_YEAR}
                </div>
              </div>
            </div>
            <div style={{ background:hasEntries?T.greenL:T.accL,
              border:`1px solid ${hasEntries?T.green+"40":T.acc+"40"}`,
              borderRadius:8,padding:"10px 14px",marginBottom:16,
              display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div style={{ fontSize:11,color:hasEntries?T.green:T.acc,fontFamily:"'Roboto Mono',monospace" }}>
                {workDays>0?`${workDays} logged + ${Math.max(0,baseDays-workDays-vacDays)} base remaining · ${fmtH(displayHrs)} hrs`:`Baseline · ${baseDays} days · ${fmtH(baselineHrs)} hrs`}
              </div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:20,
                color:hasEntries?T.green:T.acc }}>{fmtD(grossPay)}</div>
            </div>
            <div style={{ fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:2,
              fontFamily:"'Roboto Mono',monospace",marginBottom:10 }}>
              {days.length} Days in Period — Toggle to Log
            </div>
            {days.length===0 ? (
              <div style={{ textAlign:"center",padding:48,color:T.muted,
                fontFamily:"'Roboto Mono',monospace",fontSize:13 }}>
                Set a valid pay period above to load the day grid
              </div>
            ) : (
              enriched.map(({day,calc,workDayNum})=>(
                <DayRow key={day.date} day={day} calc={calc} workDayNum={workDayNum}
                  onUpdate={updateDay} isOTDay={workDayNum>OT_THRESHOLD} />
              ))
            )}
          </div>
        )}
        {tab==="summary" && (
          <div style={{ animation:"fadeIn 0.2s ease" }}>
            <SummaryTab totals={totals} workDays={workDays} vacDays={vacDays}
              fleet={fleet} setFleet={setFleet} baseDays={baseDays}
              baselineHrs={baselineHrs} hasEntries={hasEntries} />
          </div>
        )}
      </div>
    </>
  );
}
