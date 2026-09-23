"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  AdminApiError,
  adminApi,
  formatDate,
  formatNumber,
  type CampaignFilters,
  type EmailHistoryResponse,
  type EmailPreviewResponse,
  type EmailSendPayload,
  type EmailSendResponse,
  type EmailCampaignHistoryItem
} from "@/src/lib/admin-api";
import DataTable, { type ColumnDef, type DataTableQuery } from "@/src/components/admin/data-table";
import Badge, { VerifiedBadge, type BadgeTone } from "@/src/components/admin/badge";
import { useToast } from "@/src/components/admin/toast";

const PREVIEW_DEBOUNCE_MS = 500;
const RENDER_DEBOUNCE_MS = 800;

type Preset = { id: string; label: string; description: string; filters: CampaignFilters };

const PRESETS: Preset[] = [
  { id: "tutti", label: "Tutti gli iscritti", description: "Ogni utente registrato a From Zero To Hero.", filters: {} },
  { id: "verificati", label: "Email verificate", description: "Solo chi ha confermato il proprio indirizzo.", filters: { verified_status: "verified" } },
  { id: "non_verificati", label: "Email non verificate", description: "Chi non ha ancora confermato l'indirizzo.", filters: { verified_status: "unverified" } },
  { id: "attivi_30", label: "Attivi di recente", description: "Chi è entrato negli ultimi 30 giorni.", filters: { active_within_days: 30 } },
  { id: "inattivi_30", label: "Inattivi >30gg", description: "Chi non entra da più di un mese.", filters: { inactive_days_over: 30 } },
  { id: "con_crediti", label: "Con crediti", description: "Chi ha ancora crediti da spendere.", filters: { min_credits: 1 } },
  { id: "ref_streamer", label: "Arrivati da streamer", description: "Iscritti tramite il referral di uno streamer.", filters: { referral_type: "streamer" } },
  { id: "ref_utenti", label: "Arrivati da amici", description: "Iscritti tramite il referral di un altro utente.", filters: { referral_type: "user" } },
  { id: "senza_ref", label: "Senza referral", description: "Iscritti da soli, senza codice referral.", filters: { referral_type: "none" } }
];

const MODE_LABELS: Record<EmailCampaignHistoryItem["mode"], string> = {
  campaign: "Campagna",
  test: "Test",
  single: "Singola"
};

const MODE_TONES: Record<EmailCampaignHistoryItem["mode"], BadgeTone> = {
  campaign: "info",
  test: "neutral",
  single: "warn"
};

const HISTORY_COLUMNS: ColumnDef<EmailCampaignHistoryItem, unknown>[] = [
  {
    id: "created_at",
    header: "Data",
    enableSorting: false,
    cell: ({ row }) => formatDate(row.original.created_at)
  },
  {
    id: "subject",
    header: "Oggetto",
    enableSorting: false,
    cell: ({ row }) => row.original.subject || "—"
  },
  {
    id: "mode",
    header: "Modalità",
    enableSorting: false,
    cell: ({ row }) => <Badge tone={MODE_TONES[row.original.mode] ?? "neutral"}>{MODE_LABELS[row.original.mode] ?? row.original.mode}</Badge>
  },
  {
    id: "recipients_count",
    header: "Destinatari",
    enableSorting: false,
    meta: { numeric: true },
    cell: ({ row }) => formatNumber(row.original.recipients_count)
  },
  {
    id: "sent",
    header: "Inviate",
    enableSorting: false,
    meta: { numeric: true },
    cell: ({ row }) => formatNumber(row.original.sent)
  },
  {
    id: "failed",
    header: "Fallite",
    enableSorting: false,
    meta: { numeric: true },
    cell: ({ row }) => formatNumber(row.original.failed)
  }
];

function SectionCard({
  header,
  children,
  className,
  bodyClassName
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("rounded-[14px] border border-line bg-white shadow-card", className)}>
      {header && <div className="border-b border-line px-6 py-5">{header}</div>}
      <div className={clsx("px-6 py-6", bodyClassName)}>{children}</div>
    </section>
  );
}

function StepHeading({ step, title, subtitle }: { step?: number; title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-base font-bold text-ink">
        {step !== undefined && <span className="text-muted">{step} · </span>}
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden="true">
      <path d="M2 6.4 4.8 9 10 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Dialog({
  title,
  children,
  onClose
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-extrabold text-ink">{title}</h2>
          <button type="button" aria-label="Chiudi" className="text-xl leading-none text-muted hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmailPageInner() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const singleTo = (searchParams.get("to") ?? "").trim();
  const singleMode = singleTo.length > 0;

  const historyPage = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const historyPerPage = Math.max(1, parseInt(searchParams.get("per_page") ?? "10", 10) || 10);
  const historyQuery: DataTableQuery = { page: historyPage, perPage: historyPerPage };

  // ── 1. Destinatari ───────────────────────────────────────────────
  const [presetId, setPresetId] = useState("tutti");
  const [advSearch, setAdvSearch] = useState("");
  const [advMinCredits, setAdvMinCredits] = useState("");
  const [advCreatedWithin, setAdvCreatedWithin] = useState("");
  const [advTagContains, setAdvTagContains] = useState("");

  const filters = useMemo<CampaignFilters>(() => {
    const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
    const merged: CampaignFilters = { ...preset.filters };
    if (advSearch.trim()) merged.search = advSearch.trim();
    const minCredits = parseInt(advMinCredits, 10);
    if (!Number.isNaN(minCredits) && minCredits > 0) merged.min_credits = minCredits;
    const createdWithin = parseInt(advCreatedWithin, 10);
    if (!Number.isNaN(createdWithin) && createdWithin > 0) merged.created_within_days = createdWithin;
    if (advTagContains.trim()) merged.tag_contains = advTagContains.trim();
    return merged;
  }, [presetId, advSearch, advMinCredits, advCreatedWithin, advTagContains]);
  const filtersKey = JSON.stringify(filters);

  const [preview, setPreview] = useState<EmailPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 2. Contenuto ─────────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [ctaEnabled, setCtaEnabled] = useState(false);
  const [ctaText, setCtaText] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");

  const hasCta = ctaEnabled && Boolean(ctaText.trim()) && Boolean(ctaUrl.trim());
  const hasContent = Boolean(subject.trim() || bodyText.trim());

  // ── Anteprima live ───────────────────────────────────────────────
  const [renderHtml, setRenderHtml] = useState<string | null>(null);
  const [renderLoading, setRenderLoading] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderUnavailable, setRenderUnavailable] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const renderDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 3. Invio ─────────────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testAddress, setTestAddress] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<EmailSendResponse | null>(null);
  const [historyReload, setHistoryReload] = useState(0);

  useEffect(() => {
    if (singleMode) return;
    setPreviewLoading(true);
    setPreviewError(null);
    if (previewDebounce.current) clearTimeout(previewDebounce.current);
    previewDebounce.current = setTimeout(() => {
      adminApi
        .emailPreview({ filters })
        .then((res) => {
          setPreview(res);
          setPreviewError(null);
        })
        .catch((err) => {
          setPreview(null);
          setPreviewError(err.message ?? "Anteprima non disponibile");
        })
        .finally(() => setPreviewLoading(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (previewDebounce.current) clearTimeout(previewDebounce.current);
    };
    // filtersKey è la serializzazione stabile di `filters`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, singleMode]);

  useEffect(() => {
    if (renderUnavailable || !hasContent) return;
    setRenderLoading(true);
    if (renderDebounce.current) clearTimeout(renderDebounce.current);
    renderDebounce.current = setTimeout(() => {
      adminApi
        .emailRender({
          subject: subject.trim() || "(Senza oggetto)",
          body_text: bodyText.trim(),
          ...(hasCta ? { cta_text: ctaText.trim(), cta_url: ctaUrl.trim() } : {})
        })
        .then((res) => {
          setRenderHtml(res.html);
          setRenderError(null);
        })
        .catch((err) => {
          // Endpoint non ancora deployato: nascondi l'anteprima live, la pagina
          // continua a funzionare senza.
          if (err instanceof AdminApiError && err.status === 404) {
            setRenderUnavailable(true);
          } else {
            setRenderError(err.message ?? "Anteprima non aggiornata");
          }
        })
        .finally(() => setRenderLoading(false));
    }, RENDER_DEBOUNCE_MS);
    return () => {
      if (renderDebounce.current) clearTimeout(renderDebounce.current);
    };
  }, [subject, bodyText, hasCta, ctaText, ctaUrl, renderUnavailable, hasContent]);

  const recipientsCount = singleMode ? 1 : (preview?.recipients_count ?? null);
  const canSend = Boolean(subject.trim()) && Boolean(bodyText.trim()) && !sending && (singleMode || (recipientsCount ?? 0) > 0);

  // Il titolo interno non si chiede più: senza heading l'email si apre
  // direttamente col saluto, e il piè di pagina standard arriva dal backend.
  const buildPayload = useCallback(
    (extra: Partial<EmailSendPayload>): EmailSendPayload => ({
      subject: subject.trim(),
      body_text: bodyText.trim(),
      ...(hasCta ? { cta_text: ctaText.trim(), cta_url: ctaUrl.trim() } : {}),
      ...(singleMode ? { recipient_emails: [singleTo] } : { filters }),
      ...extra
    }),
    [subject, bodyText, hasCta, ctaText, ctaUrl, singleMode, singleTo, filters]
  );

  const sendTest = async () => {
    const address = testAddress.trim().toLowerCase();
    if (!address) {
      toast.error("Inserisci un indirizzo email per il test.");
      return;
    }
    setSending(true);
    try {
      await adminApi.emailSend(buildPayload({ test_email: address }));
      toast.success(`Email di test inviata a ${address}.`);
      setTestOpen(false);
      setHistoryReload((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invio del test fallito");
    } finally {
      setSending(false);
    }
  };

  const sendCampaign = async () => {
    setSending(true);
    try {
      const result = await adminApi.emailSend(buildPayload({}));
      setLastResult(result);
      setConfirmOpen(false);
      if ((result.failed ?? 0) > 0) {
        toast.error(`Campagna inviata con errori: ${formatNumber(result.sent)} inviate, ${formatNumber(result.failed ?? 0)} fallite.`);
      } else {
        toast.success(`Campagna inviata: ${formatNumber(result.sent)} email.`);
      }
      setHistoryReload((n) => n + 1);
    } catch (err) {
      setConfirmOpen(false);
      toast.error(err instanceof Error ? err.message : "Invio della campagna fallito");
    } finally {
      setSending(false);
    }
  };

  // ── Storico ──────────────────────────────────────────────────────
  const [history, setHistory] = useState<EmailHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);

  useEffect(() => {
    setHistoryLoading(true);
    setHistoryError(null);
    adminApi
      .emailHistory(historyPage, historyPerPage)
      .then((res) => {
        setHistory(res);
        setHistoryUnavailable(res.history_available === false);
      })
      .catch((err) => {
        // Endpoint non ancora deployato o migration mancante: stato vuoto, non errore.
        if (err instanceof AdminApiError && (err.status === 400 || err.status === 404)) {
          setHistory(null);
          setHistoryUnavailable(true);
        } else {
          setHistoryError(err.message ?? "Errore nel caricamento dello storico");
        }
      })
      .finally(() => setHistoryLoading(false));
  }, [historyPage, historyPerPage, historyReload]);

  const previewBody = renderUnavailable ? (
    <div className="rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
      <p className="text-sm font-semibold text-ink">Anteprima live non ancora attiva sul server</p>
      <p className="mt-1 text-xs text-muted">L&apos;invio funziona comunque: questa sezione si attiverà da sola.</p>
    </div>
  ) : !hasContent ? (
    <div className="rounded-xl border border-dashed border-line bg-surface px-5 py-14 text-center">
      <p className="text-sm font-semibold text-ink">Niente da mostrare, per ora</p>
      <p className="mt-1 text-xs text-muted">Scrivi oggetto e messaggio per vedere l&apos;anteprima.</p>
    </div>
  ) : (
    <div>
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="border-b border-line bg-surface px-4 py-3">
          <p className="truncate text-sm font-bold text-ink">{subject.trim() || "(Senza oggetto)"}</p>
          <p className="mt-0.5 text-xs text-muted">Da: From Zero To Hero &lt;info@fromzerotohero.io&gt;</p>
        </div>
        <div className="relative">
          {renderHtml ? (
            <iframe
              title="Anteprima dell'email"
              sandbox=""
              srcDoc={renderHtml}
              className="block h-[560px] w-full bg-white"
            />
          ) : (
            <div className="flex h-[560px] flex-col gap-3 p-6" aria-busy="true">
              <div className="h-10 w-2/3 animate-pulse rounded-lg bg-surface" />
              <div className="h-4 w-full animate-pulse rounded bg-surface" />
              <div className="h-4 w-full animate-pulse rounded bg-surface" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-surface" />
              <div className="h-4 w-3/5 animate-pulse rounded bg-surface" />
            </div>
          )}
          {renderLoading && renderHtml && (
            <div className="absolute inset-x-0 top-0 h-1 animate-pulse bg-brand/40" />
          )}
        </div>
      </div>
      {renderError && <p className="mt-2 text-xs text-muted">Anteprima non aggiornata: {renderError}</p>}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div>
        <h1 className="admin-title">Nuova email</h1>
        <p className="admin-muted mt-1">Tre passaggi: scegli a chi scrivere, scrivi il messaggio, invia.</p>
      </div>

      {singleMode ? (
        <SectionCard header={<StepHeading step={1} title="A chi scrivi?" subtitle="Invio singolo: i segmenti non si applicano." />}>
          <p className="text-sm text-ink">
            A: <strong>{singleTo}</strong>
          </p>
        </SectionCard>
      ) : (
        <SectionCard
          header={
            <div className="flex flex-wrap items-start justify-between gap-4">
              <StepHeading step={1} title="A chi scrivi?" subtitle="Scegli un gruppo di utenti, oppure affina con i filtri avanzati." />
              <div className="text-right">
                {previewError ? (
                  <p className="text-sm font-semibold text-red-600">{previewError}</p>
                ) : (
                  <>
                    <p className="leading-none">
                      <span className="text-3xl font-extrabold tracking-tight text-ink">
                        {previewLoading && !preview ? "…" : formatNumber(preview?.recipients_count ?? 0)}
                      </span>{" "}
                      <span className="text-sm font-semibold text-muted">
                        destinatari{previewLoading && preview ? " (aggiornamento…)" : ""}
                      </span>
                    </p>
                    {preview && (
                      <p className="mt-1.5 text-xs text-muted">
                        {formatNumber(preview.verified_count)} verificati · {formatNumber(preview.unverified_count)} non verificati
                      </p>
                    )}
                    {preview && preview.recipients_preview.length > 0 && (
                      <button
                        type="button"
                        className="mt-1.5 text-xs font-semibold text-brand hover:underline"
                        onClick={() => setPreviewOpen((open) => !open)}
                      >
                        {previewOpen ? "Nascondi anteprima destinatari ↑" : "Anteprima destinatari ↓"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {PRESETS.map((preset) => {
              const selected = presetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPresetId(preset.id)}
                  aria-pressed={selected}
                  className={clsx(
                    "relative h-full rounded-xl border p-4 text-left transition-colors",
                    selected
                      ? "border-brand bg-brand/5 ring-2 ring-brand/40"
                      : "border-line-strong bg-white shadow-card hover:border-brand/60 hover:bg-surface/60"
                  )}
                >
                  {selected && (
                    <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-brand text-white">
                      <CheckMark />
                    </span>
                  )}
                  <span className={clsx("block truncate pr-6 text-sm font-semibold", selected ? "text-brand" : "text-ink")}>
                    {preset.label}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted" title={preset.description}>
                    {preset.description}
                  </span>
                </button>
              );
            })}
          </div>

          <details className="mt-4 rounded-xl border border-line bg-surface px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold text-brand">Filtri avanzati</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="field">
                <span className="field-label">Cerca (username o email)</span>
                <span className="field-input">
                  <input type="search" value={advSearch} onChange={(e) => setAdvSearch(e.target.value)} placeholder="Es. mario" />
                </span>
              </label>
              <label className="field">
                <span className="field-label">Crediti minimi</span>
                <span className="field-input">
                  <input type="number" min={0} value={advMinCredits} onChange={(e) => setAdvMinCredits(e.target.value)} placeholder="0" />
                </span>
              </label>
              <label className="field">
                <span className="field-label">Registrati entro (giorni)</span>
                <span className="field-input">
                  <input type="number" min={0} value={advCreatedWithin} onChange={(e) => setAdvCreatedWithin(e.target.value)} placeholder="Es. 30" />
                </span>
              </label>
              <label className="field">
                <span className="field-label">Tag contiene</span>
                <span className="field-input">
                  <input type="text" value={advTagContains} onChange={(e) => setAdvTagContains(e.target.value)} placeholder="Es. vip" />
                </span>
              </label>
            </div>
          </details>

          {previewOpen && preview && preview.recipients_preview.length > 0 && (
            <ul className="mt-4 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {preview.recipients_preview.map((recipient) => (
                <li key={recipient.email} className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{recipient.username || recipient.email}</span>
                    <span className="block truncate text-xs text-muted">{recipient.email}</span>
                  </span>
                  <VerifiedBadge verified={recipient.email_verified} />
                </li>
              ))}
            </ul>
          )}

          {preview && preview.warnings.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {preview.warnings.map((warning) => (
                <li key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-700">
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SectionCard
          header={
            <StepHeading
              step={2}
              title="Cosa dici?"
              subtitle="Il logo e la grafica From Zero To Hero sono già nel template — scrivi solo il testo."
            />
          }
        >
          <div className="flex flex-col gap-5">
            <div>
              <label className="field">
                <span className="field-label">Oggetto *</span>
                <span className="field-input">
                  <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Es. Torna in gioco: ti aspetta una sorpresa" />
                </span>
              </label>
              {!subject.trim() && bodyText.trim() && (
                <p className="mt-1.5 text-xs font-medium text-amber-600">Manca l&apos;oggetto: è obbligatorio per l&apos;invio.</p>
              )}
            </div>

            <div>
              <label className="field">
                <span className="field-label">Messaggio *</span>
                <textarea
                  className="min-h-[220px] w-full resize-y rounded-lg border border-line-strong bg-white px-4 py-3 text-sm leading-relaxed text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10"
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="Scrivi qui il testo dell'email, come se parlassi a un cliente…"
                />
              </label>
              {!bodyText.trim() && subject.trim() && (
                <p className="mt-1.5 text-xs font-medium text-amber-600">Manca il messaggio: è obbligatorio per l&apos;invio.</p>
              )}
              <p className="mt-1.5 text-xs text-muted">Il testo va a capo da solo: scrivi come parleresti, senza codice.</p>
            </div>

            {!ctaEnabled ? (
              <button
                type="button"
                onClick={() => setCtaEnabled(true)}
                className="flex w-full items-center justify-between gap-4 rounded-xl border border-dashed border-line bg-surface/50 px-4 py-3.5 text-left transition-colors hover:border-brand/50"
              >
                <span>
                  <span className="block text-sm font-semibold text-ink">Aggiungi un pulsante (CTA)</span>
                  <span className="mt-0.5 block text-xs text-muted">Opzionale: un bottone con link in fondo all&apos;email.</span>
                </span>
                <span className="flex-none text-sm font-semibold text-brand">Aggiungi</span>
              </button>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">Pulsante (CTA)</p>
                  <button
                    type="button"
                    className="flex-none text-sm font-semibold text-muted underline hover:text-ink"
                    onClick={() => {
                      setCtaEnabled(false);
                      setCtaText("");
                      setCtaUrl("");
                    }}
                  >
                    Rimuovi
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="field">
                    <span className="field-label">Testo del pulsante</span>
                    <span className="field-input">
                      <input type="text" value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Es. Scopri di più" />
                    </span>
                  </label>
                  <label className="field">
                    <span className="field-label">Link del pulsante</span>
                    <span className="field-input">
                      <input type="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://…" />
                    </span>
                  </label>
                </div>
                <p className="mt-3 text-xs text-muted">
                  {hasCta ? "Il pulsante comparirà in fondo all'email." : "Servono sia il testo sia il link."}
                </p>
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          className="lg:sticky lg:top-6"
          header={
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-ink">Così la vedono i clienti</h2>
                <p className="mt-1 text-sm text-muted">Anteprima live del template reale.</p>
              </div>
              <button
                type="button"
                className="flex-none text-sm font-semibold text-brand hover:underline lg:hidden"
                onClick={() => setMobilePreviewOpen((open) => !open)}
              >
                {mobilePreviewOpen ? "Nascondi anteprima ↑" : "Mostra anteprima ↓"}
              </button>
            </div>
          }
        >
          <div className={clsx(mobilePreviewOpen ? "" : "hidden", "lg:block")}>{previewBody}</div>
        </SectionCard>
      </div>

      <section className="rounded-[14px] border border-line bg-white px-6 py-6 shadow-card">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <StepHeading step={3} title="Invia" subtitle="Prima una prova a te, poi a tutti." />
          <div className="flex flex-col gap-2 md:items-end">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="btn btn-outline"
                disabled={!subject.trim() || !bodyText.trim() || sending}
                onClick={() => setTestOpen(true)}
              >
                Invia prima a me
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canSend}
                onClick={() => setConfirmOpen(true)}
              >
                {sending
                  ? "Invio in corso…"
                  : `Invia a ${formatNumber(recipientsCount ?? 0)} destinatari`}
              </button>
            </div>
            {!canSend && !sending && (
              <p className="text-xs text-muted">
                {!subject.trim() || !bodyText.trim()
                  ? "Per inviare servono oggetto e messaggio."
                  : "Nessun destinatario in questo gruppo."}
              </p>
            )}
          </div>
        </div>

        {lastResult && lastResult.mode === "campaign" && (
          <div className="mt-6 border-t border-line pt-5">
            <h3 className="text-sm font-bold text-ink">Esito ultimo invio</h3>
            <p className="mt-1.5 text-sm text-ink">
              <strong>{formatNumber(lastResult.sent)}</strong> inviate · <strong>{formatNumber(lastResult.failed ?? 0)}</strong> fallite
              {lastResult.excluded_count ? ` · ${formatNumber(lastResult.excluded_count)} esclusi` : ""}
            </p>
            {(lastResult.failed_recipients?.length ?? 0) > 0 && (
              <ul className="mt-3 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {lastResult.failed_recipients!.map((failure) => (
                  <li key={failure.email} className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    <strong>{failure.email}</strong> — {failure.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <SectionCard header={<StepHeading title="Storico invii" subtitle="Tutti gli invii registrati, dal più recente." />} bodyClassName="pt-5">
        {historyUnavailable ? (
          <p className="admin-empty">Storico disponibile dopo l&apos;applicazione della migration 008.</p>
        ) : (
          <DataTable
            columns={HISTORY_COLUMNS}
            rows={history?.campaigns ?? []}
            total={history?.total ?? 0}
            query={historyQuery}
            loading={historyLoading}
            error={historyError}
            emptyMessage="Nessun invio registrato."
          />
        )}
      </SectionCard>

      {testOpen && (
        <Dialog title="Invia prima a me" onClose={() => setTestOpen(false)}>
          <div className="flex flex-col gap-4">
            <p className="admin-muted">Ti mandiamo una copia esatta dell&apos;email, così la controlli prima dell&apos;invio vero.</p>
            <label className="field">
              <span className="field-label">Il tuo indirizzo email</span>
              <span className="field-input">
                <input
                  type="email"
                  value={testAddress}
                  onChange={(e) => setTestAddress(e.target.value)}
                  placeholder="nome@esempio.it"
                  autoFocus
                />
              </span>
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn btn-outline" onClick={() => setTestOpen(false)}>
                Annulla
              </button>
              <button type="button" className="btn btn-primary" disabled={sending} onClick={sendTest}>
                {sending ? "Invio…" : "Invia test"}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {confirmOpen && (
        <Dialog title="Conferma invio" onClose={() => setConfirmOpen(false)}>
          <p className="mb-5 text-sm text-ink">
            Stai per inviare <strong>&ldquo;{subject.trim()}&rdquo;</strong> a{" "}
            <strong>{formatNumber(recipientsCount ?? 0)} destinatari</strong>. Confermi?
          </p>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn btn-outline" onClick={() => setConfirmOpen(false)}>
              Annulla
            </button>
            <button type="button" className="btn btn-primary" disabled={sending} onClick={sendCampaign}>
              {sending ? "Invio in corso…" : "Conferma invio"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export default function EmailPage() {
  return (
    <Suspense fallback={<p className="admin-loading">Caricamento…</p>}>
      <EmailPageInner />
    </Suspense>
  );
}
