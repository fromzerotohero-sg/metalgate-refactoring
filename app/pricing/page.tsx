"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/src/lib/api";

type Plan={id:string;name:string;price_display?:string;interval?:string;credits_per_period?:number};
export default function PricingPage(){const [plans,setPlans]=useState<Plan[]>([]);const [error,setError]=useState("");useEffect(()=>{api.plans().then((data:any)=>setPlans(data.plans??[])).catch((e:ApiError)=>setError(e.message));},[]);return <main className="simple-page"><a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero"/><span>From Zero To Hero</span></a><section className="simple-content"><p className="eyebrow">PREZZI</p><h1>Scegli il piano giusto.</h1><p>I piani arrivano dall’API ufficiale e i crediti non utilizzati non si accumulano al mese successivo.</p>{error&&<p className="form-error">{error}</p>}<div className="plans">{plans.map((plan)=><article className="plan-card" key={plan.id}><h2>{plan.name}</h2><strong>{plan.price_display??"—"}<small> / {plan.interval??"mese"}</small></strong><p>{plan.credits_per_period??""} unità per periodo</p><button className="button primary" onClick={()=>api.subscribe(plan.id).then(r=>window.location.href=r.url).catch(e=>setError((e as ApiError).message))}>Scegli piano</button></article>)}</div><a href="/">← Torna alla home</a></section></main>;
}
