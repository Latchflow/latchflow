export interface PaginateParams {
  limit?: number;
  cursor?: string | null;
}

export function paginateArray<T extends { id: string }>(
  data: T[],
  params: URLSearchParams | PaginateParams,
): { items: T[]; nextCursor?: string } {
  const limitStr =
    params instanceof URLSearchParams
      ? (params.get("limit") ?? undefined)
      : params.limit !== undefined
        ? String(params.limit)
        : undefined;
  const cursorStr =
    params instanceof URLSearchParams ? params.get("cursor") : (params.cursor ?? null);
  const limit = Number(limitStr || 50);
  const cursor = cursorStr;
  let start = 0;
  if (cursor) {
    const idx = data.findIndex((d) => d.id === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const items = data.slice(start, start + limit);
  const nextCursor =
    items.length === limit && data[start + limit] ? data[start + limit].id : undefined;
  return { items, nextCursor };
}
