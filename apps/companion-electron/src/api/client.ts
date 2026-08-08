import axios from 'axios';

const http = axios.create({
  timeout: 15000,
});

// Set base URL from electronAPI on init
if (window.electronAPI) {
  window.electronAPI.getServerUrl().then((url: string) => {
    http.defaults.baseURL = `${url}/api`;
  });
}

// Attach token from sessionStorage
http.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export { http };
