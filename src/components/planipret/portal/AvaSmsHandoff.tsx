import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Volume2, MessageSquare, RotateCcw, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { createHandoffLifecycle } from "@/lib/planipret/avaHandoffLifecycle";
const PILOT_OWNER = "a7df1872-f25a-4925-b763-a573e7452462";
type Summary = {peer:string;job_id:string;summary:string;read:boolean;greeted:boolean};
export default function AvaSmsHandoff({userId,callState}:{userId?:string|null;callState?:string}) {
 const [state,setState]=useState<{online?:boolean;taking_over?:boolean;summaries?:Record<string,Summary>;taken_over?:Record<string,boolean>}>({});
 const [error,setError]=useState<string|null>(null),[playing,setPlaying]=useState(false);
 const audio=useRef<HTMLAudioElement|null>(null),call=useRef(callState),visible=useRef(true),epoch=useRef(0);
 const navigate=useNavigate();call.current=callState;
 const request=useCallback(async(body:Record<string,unknown>)=>{
  const {data,error}=await supabase.functions.invoke("pp-ava-sms",{body});
  if(error||data?.error)throw new Error("Relais indisponible. Réessaie avant de reprendre les échanges.");
  return data;
 },[]);
 const stop=useCallback(()=>{epoch.current++;audio.current?.pause();audio.current=null;setPlaying(false);},[]);
 const speak=useCallback(async(item:Summary,automatic=false)=>{
  if(!visible.current||["active","held","ringing-in","ringing-out"].includes(call.current??""))return;
  const version=epoch.current;
  try{
   if(automatic){const claim=await request({action:"greet",peer:item.peer,job_id:item.job_id});if(!claim.claimed)return;}
   const {data,error}=await supabase.functions.invoke("pp-ava-tts",{body:{text:item.summary,language:"fr"}});
   const content=data?.data??data;
   if(error||!content?.audioContent)throw new Error("Lecture indisponible.");
   if(version!==epoch.current||!visible.current||["active","held","ringing-in","ringing-out"].includes(call.current??""))return;
   const player=new Audio(`data:audio/mpeg;base64,${content.audioContent}`);audio.current=player;
   player.onended=()=>setPlaying(false);setPlaying(true);await player.play();
  }catch{setPlaying(false);setError("Le résumé reste disponible; utilise le bouton de lecture.");}
 },[request]);
 useEffect(()=>{
  if(userId!==PILOT_OWNER)return;
  const session=crypto.randomUUID();let disposed=false;
  const update=createHandoffLifecycle(async active=>{
   try{
    const result=await request({action:"presence",session_id:session,active});
    if(disposed||!active)return;
    setState(result);setError(null);
    const next=Object.values(result.summaries??{}).find((row:any)=>!row.greeted) as Summary|undefined;
    if(next&&localStorage.getItem("ava_tts_on")==="true")void speak(next,true);
   }catch(e){if(!disposed)setError(e instanceof Error?e.message:"Relais indisponible.");}
  });
  const visibility=()=>{visible.current=document.visibilityState==="visible";if(!visible.current)stop();void update(visible.current);};
  visibility();document.addEventListener("visibilitychange",visibility);
  const leave=()=>{visible.current=false;stop();void update(false);};
  window.addEventListener("pagehide",leave);
  return()=>{disposed=true;document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",leave);stop();void update(false);};
 },[userId,request,speak,stop]);
 useEffect(()=>{if(["active","held","ringing-in","ringing-out"].includes(callState??""))stop();},[callState,stop]);
 if(userId!==PILOT_OWNER)return null;
 const summaries=Object.values(state.summaries??{}).filter(item=>!item.read||state.taken_over?.[item.peer]);
 return <aside aria-label="Relais SMS AVA" className="border-y border-border bg-background p-3 text-foreground">
  <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">AVA — {state.taking_over?"Reprise en cours":state.online?"Tu as la main · réponses suspendues":"Relais SMS"}</strong>
   <Button variant="ghost" size="icon" title="Actualiser le relais" onClick={()=>void request({action:"handoff_status"}).then(setState).catch(e=>setError(e.message))}><RefreshCw className="h-4 w-4"/></Button>
  </div>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {summaries.map(item=><article key={item.peer} className="mt-3 border-t border-border pt-3">
   <p className="whitespace-pre-line break-words text-sm">{item.summary}</p>
   <div className="mt-2 flex flex-wrap gap-2">
    <Button size="sm" variant="outline" disabled={playing||["active","held","ringing-in","ringing-out"].includes(callState??"")} onClick={()=>void speak(item)}><Volume2 className="mr-2 h-4 w-4"/>Écouter</Button>
    <Button size="sm" onClick={()=>{void request({action:"read",peer:item.peer,job_id:item.job_id}).catch(()=>null);navigate(`${location.pathname.startsWith("/mplanipret")?"/mplanipret/messages":"/planipret/broker/messages"}?to=${encodeURIComponent(item.peer)}`);}}><MessageSquare className="mr-2 h-4 w-4"/>Continuer</Button>
    {state.taken_over?.[item.peer]&&<Button size="sm" variant="outline" onClick={()=>void request({action:"resume",peer:item.peer}).then(setState).catch(e=>setError(e.message))}><RotateCcw className="mr-2 h-4 w-4"/>Rendre à AVA</Button>}
   </div>
  </article>)}
 </aside>;
}