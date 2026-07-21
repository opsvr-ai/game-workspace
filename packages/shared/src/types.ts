import type { UserRole } from './enums.js';

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: UserInfo;
}

export interface UserInfo {
  id: string;
  username: string;
  role: UserRole;
  studioId: string | null;
  companionId?: string;
  displayName?: string | null;
  avatar?: string | null;
  pendingReviewCount?: number;
}
