import { useQuery } from "@tanstack/react-query";
import { useLuc } from "./LucContext";
import { lucApi } from "./api";

export function useLucList<T = any>(table: string, cols = "*", order = "created_at", extra?: (q: any) => any, key: unknown[] = []) {
  const { tenantId } = useLuc();
  return useQuery<T[]>({
    queryKey: ["luc", table, tenantId, cols, ...key],
    enabled: !!tenantId,
    queryFn: () => lucApi.list(table, tenantId!, cols, order, extra) as Promise<T[]>,
  });
}
