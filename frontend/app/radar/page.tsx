"use client";
import { useEffect, useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { ModeBanner } from "@/components/ModeBanner";
import { RadarTable } from "@/components/RadarTable";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { StatusBar } from "@/components/StatusBar";
import { Tabs } from "@/components/Tabs";
import { TopBar } from "@/components/TopBar";
import { useRadar } from "@/hooks/useRadar";
import type { Filters, SortKey, StageKey } from "@/lib/types";

const NO_FILTERS: Filters = { riskLevel: "", maxAge: "", minLiquidity: "", includeRejected: false };

export default function RadarPage() {
  const [stage, setStage] = useState<StageKey>("new_creation");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<SortKey>("adjusted");
  const { data, error, loading, updatedAt } = useRadar(stage, filters, sort, undefined);
  const [mode, setMode] = useState<"MOCK" | "REAL" | undefined>();
  useEffect(() => { if (data?.mode) setMode(data.mode); }, [data?.mode]);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <div className="min-h-dvh flex flex-col">
      <ModeBanner mode={mode} />
      <TopBar mode={mode} />
      <Tabs stage={stage} onChange={setStage} count={data?.count ?? null} />
      <FilterBar f={filters} onChange={setFilters} />
      {error && <ErrorState message={error} hasData={!!data} />}
      <main className="flex-1">
        {loading && !data ? <LoadingRows />
          : data && data.items.length === 0 ? <EmptyState filtered={filtered} />
          : data ? <RadarTable items={data.items} sort={sort} onSort={setSort} /> : null}
      </main>
      <StatusBar mode={mode} updatedAt={updatedAt} error={!!error} count={data?.count ?? null} quadrant={data?.items.filter((i) => i.quadrant).length ?? 0} />
    </div>
  );
}
