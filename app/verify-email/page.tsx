"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/src/lib/api";
export default function VerifyEmailPage(){const [message,setMessage]=useState("Verifica in corso…");useEffect(()=>{const token=new URLSearchParams(location.search).get("token");if(!token){setMessage("Token di verifica mancante.");return;}api.verifyEmail(token).then(()=>{setMessage("Email verificata. Ti portiamo al tuo account…");setTimeout(()=>location.assign("/account"),800);}).catch((e:ApiError)=>setMessage(e.message));},[]);return <main className="form-page"><section className="form-card"><img className="form-logo" src="/logo.webp" alt="From Zero To Hero"/><h1>{message}</h1></section></main>}
