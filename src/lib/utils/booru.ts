import { ipcInvoke } from './ipc.js';

export interface BooruCredentialDraft {
  gelbooru_user_id?: string;
  gelbooru_api_key?: string;
  e621_login?: string;
  e621_api_key?: string;
}


export async function updateBooruCredentials(credentials: BooruCredentialDraft, clear = false): Promise<void> {
  await ipcInvoke<void>('booru_credentials_update', { credentials, clear });
}
