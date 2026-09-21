import axios, { AxiosError } from 'axios';
import { reportClientError } from './diagnostics';
import type {
  ApiResponse,
  LoginRequest,
  LoginResponse,
  UserInfo,
} from '@chunlv/shared';

const http = axios.create({
  baseURL: '/api',
  // 云服务器带宽有限，偶发会有一个短暂停顿；15 秒太紧容易误报 network error。
  timeout: 25000,
  headers: {
    // 强制每次请求都向服务端重新校验，绕过 Electron/Chromium 的磁盘缓存，
    // 避免「接口返回 200 但前端拿到的是旧缓存空数据」。
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  },
});

// 内存短时缓存：只对「只读列表」接口做缓存，切标签秒开；实时接口（订单池/抢单/客服）不缓存。
const memCache = new Map<string, { data: unknown; ts: number }>();
const MEM_TTL_MS = 20_000;
const isCacheableGet = (config: any): boolean => {
  if (config.method?.toLowerCase() !== 'get') return false;
  const url = config.url || '';
  return url === '/orders' || url === '/customers' || url === '/companions' || url.startsWith('/finance/');
};
const memCacheKey = (config: any): string =>
  `${config.method}:${config.url}:${JSON.stringify(config.params || {})}`;

// Request interceptor: attach Bearer token from sessionStorage
http.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // 有写操作（增删改）时清空缓存，确保下一次列表查询拿到最新数据。
    if (config.method?.toLowerCase() !== 'get') {
      memCache.clear();
    }
    if (isCacheableGet(config)) {
      const key = memCacheKey(config);
      const hit = memCache.get(key);
      if (hit && Date.now() - hit.ts < MEM_TTL_MS) {
        config.adapter = async () => ({
          data: hit.data,
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        });
      }
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

// 登录态彻底失效时回到登录页；Electron 客户端会重新挂载 LoginPage，
// 如果保存过账号密码就会自动重新登录，避免机器开着却一直显示离线。
const redirectToLogin = () => {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  window.location.href = '/login';
};

http.interceptors.response.use(
  (response) => {
    if (isCacheableGet(response.config)) {
      memCache.set(memCacheKey(response.config), { data: response.data, ts: Date.now() });
    }
    return response;
  },
  async (error: AxiosError) => {
    // 网络层失败（服务端一个字节都没收到）在前端最难查：服务端日志里干干净净，什么都没有。
    // 统一回传一条到服务器 client-errors/，以后「动不动报网络错误/掉线」有据可查。
    if (!error.response) {
      reportClientError({
        phase: 'axios-network',
        url: error.config?.url,
        message: error.message,
        detail: `method=${error.config?.method || ''} timeout=${(error.config as any)?.timeout || ''}`,
      });
    }
    const originalRequest = error.config as AxiosError['config'] & {
      _retry?: boolean;
    };

    // Skip retry for /auth/refresh itself — prevents infinite loop when JWT secrets mismatch
    if (originalRequest.url?.includes('/auth/refresh')) {
      // 只有服务端明确拒绝了这个 refreshToken（4xx）才算登录态失效；
      // 断网/超时/服务端 5xx 是临时故障，清掉令牌等于把人踢回登录页。
      const status = error.response?.status;
      if (status && status >= 400 && status < 500) {
        sessionStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        redirectToLogin();
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        sessionStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        redirectToLogin();
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
        try {
          (window as any).electronAPI?.storeSet?.('token', newAccessToken);
        } catch {}
        try {
          (window as any).electronAPI?.storeSet?.('refreshToken', newRefreshToken);
        } catch {}

        processQueue(null, newAccessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        }
        return http(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        // 同上：临时故障（断网、超时、5xx）保留登录态，只有 4xx 才判定为失效。
        const status = (refreshError as AxiosError)?.response?.status;
        if (status && status >= 400 && status < 500) {
          sessionStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          redirectToLogin();
        }
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
    return http.put<ApiResponse<UserInfo>>('/auth/me', { displayName });
  },
  async uploadAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    const token = sessionStorage.getItem('accessToken');
    return axios.post<ApiResponse<{ filename: string }>>('/api/auth/me/avatar', form, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  },
};

export default http;
