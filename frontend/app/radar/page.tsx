"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertBell } from "@/components/AlertBell";
import { AlertToasts } from "@/components/AlertToasts";
import { Hero } from "@/components/Hero";
import { DetailPanel } from "@/components/DetailPanel";
import { ScatterMap } from "@/components/ScatterMap";
import { SourceSettings } from "@/components/SourceSettings";
import { FilterBar } from "@/components/FilterBar";
import { ModeBanner } from "@/components/ModeBanner";
import { RadarTable } from "@/components/RadarTable";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { StatusBar } from "@/components/StatusBar";
import { Tabs } from "@/components/Tabs";
import { TopBar } from "@/components/TopBar";
import { useAlerts } from "@/hooks/useAlerts";
import { useRadar } from "@/hooks/useRadar";
import { loadMuted, saveMuted, unlockAudio } from "@/lib/sound";
import type { AlertEvent, Filters, RadarItem, SortKey, StageKey } from "@/lib/types";

const NO_FILTERS: Filters = { riskLevel: "", maxAge: "", minLiquidity: "", includeRejected: false };

export default function RadarPage() {
  const [stage, setStage] = useState<StageKey>("new_creation");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<SortKey>("adjusted");
  const [reload, setReload] = useState(0);
  const { data, error, loading, updatedAt } = useRadar(stage, filters, sort, undefined, reload);
  const [view, setView] = useState<"table" | "map">("table");
  const [sel, setSel] = useState<RadarItem | null>(null);
  // el panel sigue al token seleccionado aunque se actualicen los datos (o salga de la lista)
  const live = sel ? data?.items.find((i) => i.entry.token.address === sel.entry.token.address) : undefined;
  const shown = live ?? sel;
  const [muted, setMuted] = useState(false);
  useEffect(() => { setMuted(loadMuted()); const u = () => unlockAudio(); window.addEventListener("pointerdown", u, { once: true }); window.addEventListener("keydown", u, { once: true }); return () => { window.removeEventListener("pointerdown", u); window.removeEventListener("keydown", u); }; }, []);
  const toggleMute = () => { setMuted((m) => { saveMuted(!m); return !m; }); };
  const alerts = useAlerts(muted);
  // Abrir un token desde una alerta: cambia a su etapa y lo selecciona cuando llegan los datos
  const [pending, setPending] = useState<string | null>(null);
  const openFromAlert = useCallback((e: AlertEvent) => { setView("table"); setFilters(NO_FILTERS); setStage(e.stage); setSel(null); setPending(e.address); }, []);
  useEffect(() => {
    if (!pending || !data) return;
    const hit = data.items.find((i) => i.entry.token.address === pending);
    if (hit) { setSel(hit); setPending(null); } else if (data.stage === stage && !loading) setPending(null);
  }, [pending, data, stage, loading]);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="min-h-dvh flex flex-col">
      <ModeBanner ready={!!data || !!updatedAt} source={data?.mode} gmgn={data?.meta.gmgn} />
      <TopBar ready={!!data || !!updatedAt}>
        <SourceSettings source={data?.mode} status={data?.meta.gmgn} onApplied={() => { setSel(null); setReload((n) => n + 1); }} />
        <AlertBell history={alerts.history} unread={alerts.unread} muted={muted} onToggleMute={toggleMute}
          onOpenPanel={alerts.markRead} onSelect={openFromAlert} onTest={alerts.test} />
      </TopBar>
      <Hero items={data?.items ?? []} meta={data?.meta} />
      <Tabs stage={stage} onChange={(s) => { setStage(s); setSel(null); }} count={data?.count ?? null} />
      <FilterBar f={filters} onChange={setFilters} view={view} onView={setView} />
      {error && <ErrorState message={error} hasData={!!data} />}
      <main className="flex-1">
        {loading && !data ? <LoadingRows />
          : data && data.items.length === 0 ? <EmptyState filtered={filtered} stage={stage} />
          : data ? (view === "map"
            ? <ScatterMap items={data.items} meta={data.meta} onSelect={setSel} selected={shown?.entry.token.address} />
            : <RadarTable items={data.items} sort={sort} onSort={setSort} onSelect={setSel} selected={shown?.entry.token.address} />) : null}
      </main>
      {shown && data && <DetailPanel key={shown.entry.token.address} item={shown} onClose={() => setSel(null)} />}
      <AlertToasts toasts={alerts.toasts} onClose={alerts.dismiss} onOpen={openFromAlert} />
      <StatusBar source={data?.mode} updatedAt={updatedAt} error={!!error} count={data?.count ?? null} quadrant={data?.items.filter((i) => i.quadrant).length ?? 0} />
    </div>
  );
}
