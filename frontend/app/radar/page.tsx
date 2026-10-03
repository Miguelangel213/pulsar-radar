"use client";
import { useEffect, useState } from "react";
import { DetailPanel } from "@/components/DetailPanel";
import { ScatterMap } from "@/components/ScatterMap";
import { FilterBar } from "@/components/FilterBar";
import { ModeBanner } from "@/components/ModeBanner";
import { RadarTable } from "@/components/RadarTable";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { StatusBar } from "@/components/StatusBar";
import { Tabs } from "@/components/Tabs";
import { TopBar } from "@/components/TopBar";
import { useRadar } from "@/hooks/useRadar";
import type { Filters, RadarItem, SortKey, StageKey } from "@/lib/types";

const NO_FILTERS: Filters = { riskLevel: "", maxAge: "", minLiquidity: "", includeRejected: false };

export default function RadarPage() {
  const [stage, setStage] = useState<StageKey>("new_creation");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<SortKey>("adjusted");
  const { data, error, loading, updatedAt } = useRadar(stage, filters, sort, undefined);
  const [mode, setMode] = useState<"MOCK" | "REAL" | undefined>();
  useEffect(() => { if (data?.mode) setMode(data.mode); }, [data?.mode]);
  const [view, setView] = useState<"table" | "map">("table");
  const [sel, setSel] = useState<RadarItem | null>(null);
  // el panel sigue al token seleccionado aunque se actualicen los datos (o salga de la lista)
  const live = sel ? data?.items.find((i) => i.entry.token.address === sel.entry.token.address) : undefined;
  const shown = live ?? sel;
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="min-h-dvh flex flex-col">
      <ModeBanner mode={mode} />
      <TopBar mode={mode} />
      <Tabs stage={stage} onChange={(s) => { setStage(s); setSel(null); }} count={data?.count ?? null} />
      <FilterBar f={filters} onChange={setFilters} view={view} onView={setView} />
      {error && <ErrorState message={error} hasData={!!data} />}
      <main className="flex-1">
        {loading && !data ? <LoadingRows />
          : data && data.items.length === 0 ? <EmptyState filtered={filtered} />
          : data ? (view === "map"
            ? <ScatterMap items={data.items} meta={data.meta} onSelect={setSel} selected={shown?.entry.token.address} />
            : <RadarTable items={data.items} sort={sort} onSort={setSort} onSelect={setSel} selected={shown?.entry.token.address} />) : null}
      </main>
      {shown && data && <DetailPanel key={shown.entry.token.address} item={shown} meta={data.meta} mode={mode} onClose={() => setSel(null)} />}
      <StatusBar mode={mode} updatedAt={updatedAt} error={!!error} count={data?.count ?? null} quadrant={data?.items.filter((i) => i.quadrant).length ?? 0} />
    </div>
  );
}
