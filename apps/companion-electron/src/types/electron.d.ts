export interface ElectronAPI {
  login: (params: { username: string; password: string }) => Promise<{
    success: boolean;
    user?: any;
    message?: string;
  }>;
  getToken: () => Promise<string>;
  getServerUrl: () => Promise<string>;
  logout: () => Promise<{ success: boolean }>;
  apiRequest: (params: { method: string; url: string; body?: any }) => Promise<any>;
  storeGet: (key: string) => Promise<any>;
  storeSet: (key: string, value: any) => Promise<void>;
  showWindow: () => Promise<void>;
  hideWindow: () => Promise<void>;
  onStatusChanged: (status: string) => void;
  onWsEvent: (channel: string, callback: (...args: any[]) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
