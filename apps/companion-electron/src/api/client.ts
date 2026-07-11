import axios from 'axios';

const http = axios.create({
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Set baseURL from electron store (server URL)
const init = async () => {
  if ((window as any).electronAPI) {
    const url = await (window as any).electronAPI.getServerUrl();
    http.defaults.baseURL = `${url}/api`;
  } else {
    http.defaults.baseURL = 'http://localhost:3001/api';
  }
};
init();

// Request interceptor: attach Bearer token
http.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: 401 refresh
let isRefreshing = false;
let failedQueue: Array<{ resolve: (t: string) => void; reject: (e: unknown) => void }> = [];

http.interceptors.response.use(
  (r) => r,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (originalRequest.url?.includes('/auth/refresh')) {
        sessionStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        return Promise.reject(error);
      }
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) { sessionStorage.removeItem('accessToken'); return Promise.reject(error); }
      if (isRefreshing) return new Promise<string>((resolve, reject) => { failedQueue.push({ resolve, reject }); }).then(t => { originalRequest.headers.Authorization = `Bearer ${t}`; return http(originalRequest); }).catch(() => Promise.reject(error));
      originalRequest._retry = true; isRefreshing = true;
      try {
        const { data } = await http.post('/auth/refresh', { refreshToken });
        const newAccessToken = data.data.accessToken;
        const newRefreshToken = data.data.refreshToken;
        sessionStorage.setItem('accessToken', newAccessToken);
        localStorage.setItem('refreshToken', newRefreshToken);
        failedQueue.forEach(p => p.resolve(newAccessToken));
        failedQueue = [];
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return http(originalRequest);
      } catch (refreshError) {
        failedQueue.forEach(p => p.reject(refreshError));
        sessionStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        return Promise.reject(refreshError);
      } finally { isRefreshing = false; }
    }
    return Promise.reject(error);
  }
);

export default http;
