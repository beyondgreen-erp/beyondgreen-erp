"use client";
import { useState } from "react";

type AnyObj = Record<string, unknown>;
type ContainerRow = {cases:number;pallets?:number;total_cbm:number;utilization:number;freight_est?:number;container_cbm:number};

export default function EnterpriseFeatures({ onConfirmSaved }: { onConfirmSaved?: () => void }) {
  const [tab, setTab] = useState<string>("container");
  const [confirming, setConfirming] = useState<AnyObj | null>(null);
  const [cf, setCf] = useState<Record<string,string>>({supplier:"",qdate:"",sell:"",margin:"",notes:"",by:""});
  const [cc, setCc] = useState<Record<string,string>>({l:"",w:"",h:"",wt:"",cpp:"",fpcbm:"",op:"YANTIAN",dp:"LONG BEACH"});
  const [ccResult, setCcResult] = useState<AnyObj | null>(null);
  const [ccLoading, setCcLoading] = useState<boolean>(false);
  const [dutyHts, setDutyHts] = useState<string>("");
  const [dutyResult, setDutyResult] = useState<AnyObj | null>(null);
  const [dutyLoading, setDutyLoading] = useState<boolean>(false);

  async function runCalc() {
    setCcLoading(true); setCcResult(null);
    try {
      const res = await fetch("/api/professional/container-calc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({l_cm:+cc.l,w_cm:+cc.w,h_cm:+cc.h,gross_wt_kg:cc.wt?+cc.wt:null,cases_per_pallet:cc.cpp?+cc.cpp:null,freight_per_cbm:cc.fpcbm?+cc.fpcbm:null,origin_port:cc.op,dest_port:cc.dp})});
      setCcResult(await res.json() as AnyObj);
    } catch(e) { setCcResult({error:String(e)}); }
    setCcLoading(false);
  }

  async function runDuty() {
    if(!dutyHts) return;
    setDutyLoading(true); setDutyResult(null);
    try { const r = await fetch("/api/professional/live-duty?hts="+encodeURIComponent(dutyHts)); setDutyResult(await r.json() as AnyObj); } catch(e) { setDutyResult({error:String(e)}); }
    setDutyLoading(false);
  }

  async function saveConfirm() {
    if(!confirming) return;
    await fetch("/api/professional/confirm-product",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:confirming.id,supplier_name:cf.supplier,supplier_quote_date:cf.qdate||null,sell_price:cf.sell?+cf.sell:null,margin_pct:cf.margin?+cf.margin:null,notes_internal:cf.notes,confirmed_by:cf.by||"ERP"})});
    setConfirming(null);
    if(onConfirmSaved) onConfirmSaved();
  }

  function inp(): React.CSSProperties { return {width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:"8px",fontSize:"13px",boxSizing:"border-box",marginBottom:"10px"}; }
  function lbl(): React.CSSProperties { return {fontSize:"12px",fontWeight:600,color:"#475569",display:"block",marginBottom:"3px"}; }
  function btn(bg: string, col = "#fff"): React.CSSProperties { return {padding:"9px 18px",border:"none",borderRadius:"8px",background:bg,color:col,fontSize:"13px",fontWeight:700,cursor:"pointer"}; }

  const containers = ccResult && !ccResult.error ? ccResult.containers as Record<string,ContainerRow> : null;

  return (
    <div style={{fontFamily:"Inter,-apple-system,sans-serif"}}>
      <div style={{display:"flex",background:"#fff",borderTop:"2px solid #e2e8f0",padding:"0 24px",marginTop:"8px"}}>
        {([["container","Container Calc"],["duty","Live Duty"],["downloads","Downloads"]] as [string,string][]).map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:"12px 18px",border:"none",background:"none",cursor:"pointer",fontWeight:tab===t?700:400,fontSize:"13px",color:tab===t?"#2E7D32":"#64748b",borderBottom:tab===t?"3px solid #2E7D32":"3px solid transparent"}}>{l}</button>
        ))}
      </div>

      {tab==="container" && (
        <div style={{background:"#fff",margin:"16px 24px",borderRadius:"12px",border:"1px solid #e2e8f0",padding:"24px"}}>
          <h2 style={{margin:"0 0 4px",fontSize:"17px",fontWeight:800,color:"#1a2e1a"}}>Container Load Calculator</h2>
          <p style={{margin:"0 0 16px",fontSize:"13px",color:"#64748b"}}>Enter case dimensions to calculate 20ft / 40ft / 40HQ load plans, CBM utilization, and estimated freight.</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"10px"}}>
            {([["op","Origin Port"],["dp","Destination Port"]] as [string,string][]).map(([k,l])=>(
              <div key={k}><label style={lbl()}>{l}</label><input style={inp()} value={cc[k]} onChange={e=>setCc(p=>({...p,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px",marginBottom:"16px"}}>
            {([["l","Length (cm)"],["w","Width (cm)"],["h","Height (cm)"],["wt","Gross Wt (kg)"],["cpp","Cases/Pallet"],["fpcbm","Freight $/CBM"]] as [string,string][]).map(([k,l])=>(
              <div key={k}><label style={lbl()}>{l}</label><input type="number" style={inp()} value={cc[k]} onChange={e=>setCc(p=>({...p,[k]:e.target.value}))} /></div>
            ))}
          </div>
          <button onClick={runCalc} disabled={!cc.l||!cc.w||!cc.h||ccLoading} style={{...btn("#2E7D32"),padding:"11px 28px",fontSize:"14px",opacity:(!cc.l||!cc.w||!cc.h||ccLoading)?0.6:1}}>{ccLoading?"Calculating...":"Calculate Container Load"}</button>
          {containers&&(
            <div style={{marginTop:"20px"}}>
              <div style={{fontSize:"13px",color:"#64748b",marginBottom:"12px"}}>Case volume: {String(ccResult!.case_cbm)} m3 - {cc.op} to {cc.dp}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"14px"}}>
                {Object.entries(containers).map(([name,c])=>{
                  const u=c.utilization,bc=u>90?"#16a34a":u>70?"#fbbf24":"#e2e8f0",tc=u>90?"#16a34a":u>70?"#ca8a04":"#64748b";
                  return(<div key={name} style={{border:"2px solid "+bc,borderRadius:"12px",padding:"18px",textAlign:"center"}}>
                    <div style={{fontWeight:800,color:"#1a2e1a",marginBottom:"6px"}}>{name.toUpperCase()}</div>
                    <div style={{fontSize:"34px",fontWeight:900,color:"#2E7D32"}}>{c.cases.toLocaleString()}</div>
                    <div style={{fontSize:"11px",color:"#64748b"}}>cases</div>
                    <div style={{fontSize:"12px",margin:"4px 0"}}>{c.total_cbm} / {c.container_cbm} m3</div>
                    <div style={{fontWeight:700,color:tc}}>{u}% utilized</div>
                    {c.pallets&&<div style={{fontSize:"11px",color:"#64748b"}}>{c.pallets} pallets</div>}
                    {c.freight_est!=null&&<div style={{fontWeight:700,color:"#1565c0",marginTop:"4px"}}>est. freight: ${c.freight_est.toFixed(2)}</div>}
                  </div>);
                })}
              </div>
            </div>
          )}
          {ccResult?.error&&<div style={{marginTop:"12px",color:"#b71c1c"}}>{String(ccResult.error)}</div>}
        </div>
      )}

      {tab==="duty" && (
        <div style={{background:"#fff",margin:"16px 24px",borderRadius:"12px",border:"1px solid #e2e8f0",padding:"24px"}}>
          <h2 style={{margin:"0 0 4px",fontSize:"17px",fontWeight:800,color:"#1a2e1a"}}>Live HTS Duty Lookup</h2>
          <p style={{margin:"0 0 16px",fontSize:"13px",color:"#64748b"}}>Queries USITC tariff data in real time. Enter any 10-digit HTS code.</p>
          <div style={{display:"flex",gap:"10px",maxWidth:"480px"}}>
            <input style={{...inp(),marginBottom:0,flex:1}} value={dutyHts} onChange={e=>setDutyHts(e.target.value)} placeholder="e.g. 3923.29.0000" />
            <button onClick={runDuty} disabled={!dutyHts||dutyLoading} style={btn("#2E7D32")}>{dutyLoading?"Looking up...":"Look Up"}</button>
          </div>
          {dutyResult&&(
            <div style={{marginTop:"16px",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:"10px",padding:"20px",maxWidth:"480px"}}>
              <div style={{fontSize:"13px",color:"#64748b",marginBottom:"4px"}}>HTS: <strong>{String(dutyResult.hts||"")}</strong></div>
              <div style={{fontSize:"28px",fontWeight:900,color:"#16a34a"}}>{String(dutyResult.rate||"No rate found")}</div>
              <div style={{fontSize:"11px",color:"#64748b",marginTop:"4px"}}>Source: {String(dutyResult.source||"USITC")}</div>
              {dutyResult.error&&<div style={{color:"#b71c1c",fontSize:"12px",marginTop:"6px"}}>{String(dutyResult.error)}</div>}
            </div>
          )}
        </div>
      )}

      {tab==="downloads" && (
        <div style={{background:"#fff",margin:"16px 24px",borderRadius:"12px",border:"1px solid #e2e8f0",padding:"24px"}}>
          <h2 style={{margin:"0 0 16px",fontSize:"17px",fontWeight:800,color:"#1a2e1a"}}>Downloads</h2>
          <div style={{display:"flex",gap:"14px",flexWrap:"wrap"}}>
            <a href="/api/professional/export-internal" style={{...btn("#1a2e1a"),textDecoration:"none",display:"inline-block"}}>Internal Costing CSV</a>
            <a href="/api/professional/export-quote" style={{...btn("#2E7D32"),textDecoration:"none",display:"inline-block"}}>Customer Quote CSV</a>
          </div>
          <p style={{fontSize:"12px",color:"#94a3b8",marginTop:"12px"}}>Internal CSV includes all costing data, margins, and confirmed notes. Customer Quote shows sell price only.</p>
        </div>
      )}

      {confirming&&(
        <>
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:60}} onClick={()=>setConfirming(null)}/>
          <div style={{position:"fixed",top:0,right:0,height:"100%",width:"400px",maxWidth:"94vw",background:"#fff",zIndex:61,padding:"24px",overflowY:"auto",boxShadow:"-4px 0 20px rgba(0,0,0,0.15)"}}>
            <div style={{fontWeight:800,fontSize:"17px",color:"#1a2e1a",marginBottom:"4px"}}>Confirm Costing</div>
            <div style={{fontSize:"12px",color:"#64748b",marginBottom:"18px"}}>{String(confirming.sku||"")} - {String(confirming.description||"")}</div>
            {([["Supplier Name","supplier","text"],["Quote Date","qdate","date"],["Sell Price ($/case)","sell","number"],["Margin %","margin","number"],["Your Initials","by","text"]] as [string,string,string][]).map(([l,k,t])=>(
              <label key={k} style={{display:"block",marginBottom:"10px"}}>
                <span style={lbl()}>{l}</span>
                <input type={t} value={cf[k]} onChange={e=>setCf(p=>({...p,[k]:e.target.value}))} style={inp()}/>
              </label>
            ))}
            <label style={{display:"block",marginBottom:"14px"}}>
              <span style={lbl()}>Internal Notes</span>
              <textarea rows={3} value={cf.notes} onChange={e=>setCf(p=>({...p,notes:e.target.value}))} style={inp() as React.CSSProperties}/>
            </label>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={saveConfirm} style={{...btn("#2E7D32"),flex:1}}>Confirm Costing</button>
              <button onClick={()=>setConfirming(null)} style={btn("#f1f5f9","#475569")}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
