export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export type SortOrder = 'asc' | 'desc';

export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
