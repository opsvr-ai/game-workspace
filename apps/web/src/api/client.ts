import axios, { AxiosError } from 'axios';
import type {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  UserInfo,
} from '@chunlv/shared';

const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: {},
});

// Request interceptor: attach Bearer token from sessionStorage
http.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor: on 401, try refresh from localStorage, retry original request
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((p) => {
    if (token) {
      p.resolve(token);
    } else {
      p.reject(error);
    }
  });
  failedQueue = [];
};

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosError['config'] & {
      _retry?: boolean;
    };

    // Skip retry for /auth/refresh itself — prevents infinite loop when JWT secrets mismatch
    if (originalRequest.url?.includes('/auth/refresh')) {
      sessionStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        sessionStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return http(originalRequest);
          })
          .catch(() => Promise.reject(error));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await http.post<ApiResponse<{
          accessToken: string;
          refreshToken: string;
        }>>('/auth/refresh', { refreshToken });

        const newAccessToken = data.data.accessToken;
        const newRefreshToken = data.data.refreshToken;

        sessionStorage.setItem('accessToken', newAccessToken);
        localStorage.setItem('refreshToken', newRefreshToken);

        processQueue(null, newAccessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }
        return http(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        sessionStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export const authApi = {
  login(dto: LoginRequest) {
    return http.post<ApiResponse<LoginResponse>>('/auth/login', dto);
  },
  refresh(refreshToken: string) {
    return http.post<ApiResponse<{ accessToken: string; refreshToken: string }>>(
      '/auth/refresh',
      { refreshToken },
    );
  },
  me() {
    return http.get<ApiResponse<UserInfo>>('/auth/me');
  },
  verifySecond(password: string) {
    return http.post<ApiResponse<{ secondToken: string }>>(
      '/auth/verify-2nd',
      { password },
    );
  },
  authorizeUser(userId: string) {
    return http.put<ApiResponse<null>>(`/auth/users/${userId}/authorize`);
  },
  changePassword(oldPassword: string, newPassword: string) {
    return http.put<ApiResponse<null>>('/auth/me/password', { oldPassword, newPassword });
  },
  updateProfile(displayName: string) {
    return http.put<ApiResponse<null>>('/auth/me/profile', { displayName });
  },
  async uploadAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    const token = sessionStorage.getItem('accessToken');
    return axios.post<ApiResponse<{ filename: string }>>('/api/auth/me/avatar', form, {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  },
};

export default http;
