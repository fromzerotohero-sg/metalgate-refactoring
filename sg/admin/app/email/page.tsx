"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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

type Preset = { id: string; label: string; filters: CampaignFilters };

const PRESETS: Preset[] = [
  { id: "tutti", label: "Tutti", filters: {} },
  { id: "verificati", label: "Verificati", filters: { verified_status: "verified" } },
  { id: "non_verificati", label: "Non verificati", filters: { verified_status: "unverified" } },
  { id: "attivi_30", label: "Attivi 30gg", filters: { active_within_days: 30 } },
  { id: "inattivi_30", label: "Inattivi >30gg", filters: { inactive_days_over: 30 } },
  { id: "con_crediti", label: "Con crediti", filters: { min_credits: 1 } },
  { id: "ref_streamer", label: "Referral streamer", filters: { referral_type: "streamer" } },
  { id: "ref_utenti", label: "Referral utenti", filters: { referral_type: "user" } },
  { id: "senza_ref", label: "Senza referral", filters: { referral_type: "none" } }
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

function orUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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

  // ── Destinatari ──────────────────────────────────────────────────
  const [presetId, setPresetId] = useState("tutti");
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  // ── Contenuto ────────────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [introText, setIntroText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [footerNote, setFooterNote] = useState("");
  const [bannerImage, setBannerImage] = useState("");
  const [logoImage, setLogoImage] = useState("");

  // ── Invio ────────────────────────────────────────────────────────
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
        .emailPreview({ filters, banner_image: orUndefined(bannerImage), logo_image: orUndefined(logoImage) })
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
  }, [filtersKey, bannerImage, logoImage, singleMode]);

  const recipientsCount = singleMode ? 1 : (preview?.recipients_count ?? null);
  const hasBody = Boolean(introText.trim() || bodyText.trim());
  const canSend = Boolean(subject.trim()) && hasBody && !sending && (singleMode || (recipientsCount ?? 0) > 0);

  const buildPayload = useCallback(
    (extra: Partial<EmailSendPayload>): EmailSendPayload => ({
      subject: subject.trim(),
      heading: orUndefined(heading),
      intro_text: orUndefined(introText),
      body_text: orUndefined(bodyText),
      footer_note: orUndefined(footerNote),
      cta_text: orUndefined(ctaText),
      cta_url: orUndefined(ctaUrl),
      banner_image: orUndefined(bannerImage),
      logo_image: orUndefined(logoImage),
      ...(singleMode ? { recipient_emails: [singleTo] } : { filters }),
      ...extra
    }),
    [subject, heading, introText, bodyText, footerNote, ctaText, ctaUrl, bannerImage, logoImage, singleMode, singleTo, filters]
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

  return (
    <div className="admin-page">
      <h1 className="admin-title">Email</h1>

      {singleMode && (
        <section className="admin-card">
          <h2>Destinatario</h2>
          <p className="text-sm text-ink">
            A: <strong>{singleTo}</strong>
          </p>
          <p className="admin-muted mt-1">Invio singolo: i filtri sui segmenti non si applicano.</p>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {!singleMode && (
          <section className="admin-card">
            <h2>Destinatari</h2>

            <div className="mb-4 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPresetId(preset.id)}
                  className={
                    presetId === preset.id
                      ? "rounded-full border border-brand bg-brand px-3.5 py-1.5 text-xs font-bold text-white"
                      : "rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="mb-4 text-sm font-semibold text-brand underline"
              onClick={() => setShowAdvanced((open) => !open)}
            >
              {showAdvanced ? "Nascondi filtri avanzati ↑" : "Filtri avanzati ↓"}
            </button>

            {showAdvanced && (
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
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
            )}

            <div className="rounded-xl border border-line bg-surface p-4">
              {previewError ? (
                <p className="admin-error">{previewError}</p>
              ) : (
                <>
                  <p className="text-sm font-semibold text-ink">
                    {previewLoading && !preview
                      ? "Calcolo destinatari…"
                      : `${formatNumber(preview?.recipients_count ?? 0)} destinatari`}
                    {previewLoading && preview ? " (aggiornamento…)" : ""}
                  </p>
                  {preview && (
                    <p className="admin-muted mt-1">
                      {formatNumber(preview.verified_count)} verificati · {formatNumber(preview.unverified_count)} non verificati ·{" "}
                      {formatNumber(preview.active_30d_count)} attivi 30gg · {formatNumber(preview.inactive_30d_count)} inattivi
                    </p>
                  )}
                  {preview && preview.recipients_preview.length > 0 && (
                    <div className="mt-3">
                      <button
                        type="button"
                        className="text-sm font-semibold text-brand underline"
                        onClick={() => setPreviewOpen((open) => !open)}
                      >
                        {previewOpen ? "Nascondi anteprima ↑" : `Mostra i primi ${preview.recipients_preview.length} destinatari ↓`}
                      </button>
                      {previewOpen && (
                        <ul className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
                          {preview.recipients_preview.map((recipient) => (
                            <li key={recipient.email} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-ink">{recipient.username || recipient.email}</span>
                                <span className="block truncate text-muted">{recipient.email}</span>
                              </span>
                              <VerifiedBadge verified={recipient.email_verified} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        <section className="admin-card">
          <h2>Contenuto</h2>
          <div className="flex flex-col gap-4">
            <label className="field">
              <span className="field-label">Oggetto *</span>
              <span className="field-input">
                <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Oggetto dell'email" />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Titolo interno</span>
              <span className="field-input">
                <input type="text" value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="Se vuoto, usa l'oggetto" />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Testo introduttivo</span>
              <textarea
                className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink focus:border-brand focus:outline-none"
                rows={2}
                value={introText}
                onChange={(e) => setIntroText(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Corpo</span>
              <textarea
                className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink focus:border-brand focus:outline-none"
                rows={5}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
              />
            </label>
            {!hasBody && <p className="admin-muted">Serve almeno un testo introduttivo o un corpo.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span className="field-label">Testo pulsante (CTA)</span>
                <span className="field-input">
                  <input type="text" value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Es. Scopri di più" />
                </span>
              </label>
              <label className="field">
                <span className="field-label">URL pulsante</span>
                <span className="field-input">
                  <input type="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://…" />
                </span>
              </label>
            </div>
            <label className="field">
              <span className="field-label">Nota a piè di pagina</span>
              <span className="field-input">
                <input type="text" value={footerNote} onChange={(e) => setFooterNote(e.target.value)} placeholder="Messaggio interno SilverGate." />
              </span>
            </label>
            <label className="field">
              <span className="field-label">URL immagine banner</span>
              <span className="field-input">
                <input type="url" value={bannerImage} onChange={(e) => setBannerImage(e.target.value)} placeholder="https://… (solo URL hostati)" />
              </span>
            </label>
            <label className="field">
              <span className="field-label">URL logo</span>
              <span className="field-input">
                <input type="url" value={logoImage} onChange={(e) => setLogoImage(e.target.value)} placeholder="https://… (solo URL hostati)" />
              </span>
            </label>

            {preview && preview.warnings.length > 0 && (
              <ul className="flex flex-col gap-1">
                {preview.warnings.map((warning) => (
                  <li key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                    {warning}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              <button type="button" className="btn btn-outline" disabled={!subject.trim() || sending} onClick={() => setTestOpen(true)}>
                Invia email di test
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canSend}
                onClick={() => setConfirmOpen(true)}
              >
                {sending ? "Invio in corso…" : singleMode ? "Invia email" : "Invia campagna"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {lastResult && lastResult.mode === "campaign" && (
        <section className="admin-card">
          <h2>Esito ultimo invio</h2>
          <p className="text-sm text-ink">
            <strong>{formatNumber(lastResult.sent)}</strong> inviate · <strong>{formatNumber(lastResult.failed ?? 0)}</strong> fallite
            {lastResult.excluded_count ? ` · ${formatNumber(lastResult.excluded_count)} esclusi` : ""}
          </p>
          {(lastResult.failed_recipients?.length ?? 0) > 0 && (
            <ul className="mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {lastResult.failed_recipients!.map((failure) => (
                <li key={failure.email} className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  <strong>{failure.email}</strong> — {failure.error}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="admin-card">
        <h2>Storico invii</h2>
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
      </section>

      {testOpen && (
        <Dialog title="Invia email di test" onClose={() => setTestOpen(false)}>
          <div className="flex flex-col gap-4">
            <label className="field">
              <span className="field-label">Indirizzo di destinazione</span>
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
