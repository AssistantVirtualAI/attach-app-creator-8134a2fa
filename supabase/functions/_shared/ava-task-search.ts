/** Match task context without confusing a client/contract reference with a task id. */
export function matchesAvaTaskSearch(task: any, search: string): boolean {
  const norm = (value: unknown) => String(value ?? "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const words = norm(search).split(/\s+/).filter(Boolean);
  const raw = task?.raw ?? {};
  const hay = norm([
    task?.notes, task?.title, task?.description, task?.target_name, task?.client_name,
    task?.xid, raw?.client_id, raw?.contract_id, raw?.contract_number,
    raw?.number, raw?.filogix, raw?.target?.id, raw?.target?.name,
  ].join(" "));
  const tokens = new Set(hay.split(/\s+/));
  return words.length > 0 && words.every((word) => /^\d+$/.test(word) ? tokens.has(word) : hay.includes(word));
}