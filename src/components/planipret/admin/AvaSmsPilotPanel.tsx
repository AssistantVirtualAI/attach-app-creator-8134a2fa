import { useCallback, useEffect, useState } from "react";
import { MessageSquare, RefreshCw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
type Job={id:string;peer:string;status:string;reply:string|null;proposal:{kind?:string;start?:string;end?:string}|null;error_code:string|null};
export function AvaSmsPilotPanel(){
 const [enabled,setEnabled]=useState(false),[jobs,setJobs]=useState<Job[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[drafts,setDrafts]=useState<Record<string,string>>({});
 const call=useCallback(async(body:Record<string,unknown>)=>{
  const {data,error}=await supabase.functions.invoke("pp-ava-sms",{body});
  if(error||data?.error)throw new Error(data?.error??error?.message??"Demande refusée");
  return data;
 },[]);
 const load=useCallback(async()=>{
  setBusy(true);setError(null);
  try{await call({action:"watch_now"}).catch(()=>null);const data=await call({action:"status"});setEnabled(data.enabled===true);setJobs(data.jobs??[]);}catch(e){setError(e instanceof Error?e.message:"Chargement impossible");}finally{setBusy(false);}
 },[call]);
 useEffect(()=>{void load();},[load]);
 const decide=async(job:Job,action:"approve"|"decline")=>{
  setBusy(true);
  try{const data=await call({action,job_id:job.id,reply:drafts[job.id]??job.reply??""});toast.success(data.needs_review?"Vérification nécessaire":"Décision enregistrée");await load();}catch(e){toast.error(e instanceof Error?e.message:"Décision refusée");}finally{setBusy(false);}
 };
 return <section className="mb-6 border-y border-border py-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <h2 className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4"/>AVA textos — Marc · 1136</h2>
   <div className="flex items-center gap-3"><span className="text-sm">{enabled?"Actif":"Arrêté"}</span><Switch aria-label="Activer AVA textos pour Marc" checked={enabled} disabled={busy} onCheckedChange={async value=>{setBusy(true);try{await call({action:"configure",enabled:value});setEnabled(value);}catch(e){toast.error(e instanceof Error?e.message:"Modification refusée");}finally{setBusy(false);}}}/><Button variant="outline" size="icon" title="Actualiser les demandes texto" disabled={busy} onClick={()=>void load()}><RefreshCw className="h-4 w-4"/></Button></div>
  </div>
  {error&&<p className="mt-3 text-sm text-destructive">{error}</p>}
  {!jobs.length&&!error&&<p className="mt-3 text-sm text-muted-foreground">Aucune demande texto.</p>}
  <div className="mt-3 space-y-3">{jobs.map(job=><article key={job.id} className="rounded-md border border-border p-3">
   <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><strong>{job.peer}</strong><span className="text-muted-foreground">{({needs_review:"À vérifier",accepted:"Accepté par le service",ready:"Préparé",approved:"Approuvé",declined:"Refusé",processing:"Analyse en cours"} as Record<string,string>)[job.status]??job.status}</span></div>
   {job.proposal?.start&&<p className="mt-2 text-sm">Rendez-vous : {new Date(job.proposal.start).toLocaleString("fr-CA",{timeZone:"America/Toronto"})}</p>}
   {job.status==="needs_review"&&!job.error_code?<><Textarea className="mt-3" aria-label={`Réponse approuvée pour ${job.peer}`} value={drafts[job.id]??job.reply??""} onChange={event=>setDrafts(current=>({...current,[job.id]:event.target.value}))}/><div className="mt-2 flex gap-2"><Button size="sm" disabled={busy||!(drafts[job.id]??job.reply??"").trim()} onClick={()=>void decide(job,"approve")}><Check className="mr-2 h-4 w-4"/>Approuver et envoyer</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>void decide(job,"decline")}><X className="mr-2 h-4 w-4"/>Refuser</Button></div></>:<p className="mt-2 text-sm text-muted-foreground">{job.error_code?"Action non confirmée — aucun nouvel essai automatique.":job.reply}</p>}
  </article>)}</div>
 </section>;
}