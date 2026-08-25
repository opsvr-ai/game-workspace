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
  collectProcesses?: (token: string) => Promise<{ success: boolean }>;
  getSavedCredentials: () => Promise<{ username?: string; password?: string } | null>;
  saveCredentials: (creds: { username: string; password: string }) => Promise<{
    success: boolean;
    reason?: string;
  }>;
  clearSavedCredentials: () => Promise<{ success: boolean }>;
  unlockScreen: (pass: string) => Promise<boolean>;
  showWindow: () => Promise<void>;
  hideWindow: () => Promise<void>;
  onStatusChanged: (status: string) => void;
  setRole?: (role: string) => void;
  setStudioName?: (name: string) => void;
  onWsEvent: (channel: string, callback: (...args: any[]) => void) => () => void;
  executeRemoteDeploy: (script: string) => Promise<{ success: boolean; output: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
