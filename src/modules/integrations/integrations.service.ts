import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import jwt from 'jsonwebtoken';
import { ExportStatus, OAuthProvider, Prisma } from '@prisma/client';

import { env, prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { fileStorageService } from '@/shared/services/file-storage.service';

const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_LIST_FOLDER_URL = 'https://api.dropboxapi.com/2/files/list_folder';
const DROPBOX_CREATE_FOLDER_URL = 'https://api.dropboxapi.com/2/files/create_folder_v2';
const DROPBOX_DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';
const DROPBOX_UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const DROPBOX_SCOPES = 'files.metadata.read files.content.read files.content.write';

const GOOGLE_DRIVE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const GOOGLE_DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file';

const connectorStatusCode = (status: number): number => {
  if (status === 401 || status === 403) {
    return 401;
  }
  if (status === 404) {
    return 404;
  }
  if (status === 429) {
    return 429;
  }
  if (status >= 500) {
    return 502;
  }
  return status >= 400 && status < 500 ? 400 : 502;
};

const connectorError = (
  provider: 'Dropbox' | 'Google Drive',
  action: string,
  status: number,
): AppError => {
  if (status === 401 || status === 403) {
    return new AppError(
      `${provider} needs to be reconnected before ${action}.`,
      401,
    );
  }
  if (status === 404) {
    return new AppError(`${provider} item was not found. Refresh and try again.`, 404);
  }
  if (status === 429) {
    return new AppError(`${provider} rate limit reached. Please try again shortly.`, 429);
  }
  return new AppError(
    `${provider} ${action} failed. Please reconnect ${provider} and try again.`,
    connectorStatusCode(status),
  );
};

const connectorTokenRefreshError = (
  provider: 'Dropbox' | 'Google Drive',
  status: number,
): AppError =>
  new AppError(
    `${provider} token refresh failed. Please reconnect ${provider}.`,
    status >= 500 ? 502 : 401,
  );

const connectorStatusMessage = (
  provider: 'Dropbox' | 'Google Drive',
  configured: boolean,
  connected: boolean,
): string => {
  if (!configured) {
    return `${provider} OAuth is not configured.`;
  }
  if (!connected) {
    return `Connect your ${provider} account.`;
  }
  return `${provider} is connected.`;
};

const ensureQuery = (query: string): string => {
  const normalized = query.trim();
  if (normalized.length < 2) {
    throw new AppError('Search query is required', 400);
  }
  return normalized;
};

const encryptionKey = (): Buffer =>
  createHash('sha256').update(env.JWT_REFRESH_SECRET).digest();

const encryptJson = (payload: Record<string, unknown>): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted]
    .map((item) => item.toString('base64url'))
    .join('.');
};

const decryptJson = <T extends Record<string, unknown>>(value: string): T => {
  const [ivValue, authTagValue, encryptedValue] = value.split('.');
  if (!ivValue || !authTagValue || !encryptedValue) {
    throw new AppError('Stored cloud connection is invalid. Please reconnect.', 401);
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    throw new AppError('Stored cloud connection is invalid. Please reconnect.', 401);
  }
};

const mimeTypeForFileName = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    case 'mkv':
      return 'video/x-matroska';
    case 'webm':
      return 'video/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
      return 'audio/ogg';
    case 'txt':
      return 'text/plain';
    case 'md':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'slwb':
      return 'application/vnd.softlogic.whiteboard+json';
    default:
      return 'application/octet-stream';
  }
};

interface DropboxStoredTokens extends Record<string, unknown> {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  tokenType?: string;
  expiresAt?: string;
}

interface DropboxTokenResponse {
  access_token: string;
  refresh_token?: string;
  account_id?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface DropboxListResponse {
  entries?: Array<{
    '.tag': 'file' | 'folder' | string;
    name: string;
    path_lower?: string;
    path_display?: string;
    id?: string;
    size?: number;
    server_modified?: string;
  }>;
  cursor?: string;
  has_more?: boolean;
}

interface DropboxStatePayload {
  userId: string;
  provider: 'dropbox';
}

interface GoogleDriveStoredTokens extends Record<string, unknown> {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
}

interface GoogleDriveTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface GoogleDriveListResponse {
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
  }>;
  nextPageToken?: string;
}

interface GoogleDriveStatePayload {
  userId: string;
  provider: 'google_drive';
}

interface CloudUploadInput {
  fileName?: string;
  name?: string;
  path?: string;
  parentId?: string;
  mimeType?: string;
  contentBase64?: string;
  dataBase64?: string;
  content?: string;
  overwrite?: boolean;
}

interface CloudFolderInput {
  name?: string;
  path?: string;
  parentId?: string;
}

const providerValue = (provider: 'DROPBOX' | 'GOOGLE_DRIVE'): OAuthProvider =>
  provider as OAuthProvider;

const normalizeFolderPath = (value?: string): string => {
  const normalized = (value ?? '').trim().replace(/\\/g, '/');
  if (!normalized || normalized === '/') {
    return '';
  }
  return `/${normalized.replace(/^\/+|\/+$/g, '')}`;
};

const normalizeDropboxFilePath = (fileName: string, folderPath?: string): string => {
  const safeName = fileName.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (!safeName) {
    throw new AppError('File name is required', 400);
  }
  const folder = normalizeFolderPath(folderPath);
  return folder ? `${folder}/${safeName}` : `/${safeName}`;
};

const base64ToBuffer = (value?: string): Buffer => {
  if (!value || !value.trim()) {
    throw new AppError('File content is required', 400);
  }
  const base64 = value.includes(',') ? value.split(',').pop()! : value;
  return Buffer.from(base64, 'base64');
};

const multerFileFromBuffer = (
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Express.Multer.File => ({
  fieldname: 'file',
  originalname: fileName,
  encoding: '7bit',
  mimetype: mimeType,
  size: buffer.length,
  buffer,
  destination: '',
  filename: fileName,
  path: '',
  stream: Readable.from(buffer),
});

const escapeDriveQueryValue = (value: string): string => value.replace(/'/g, "\\'");

export class IntegrationsService {
  async searchGoogleImages(query: string) {
    const q = ensureQuery(query);
    if (!env.SERPER_API_KEY) {
      return {
        configured: false,
        items: [],
        message: 'Serper image search is not configured.',
      };
    }

    const response = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': env.SERPER_API_KEY,
      },
      body: JSON.stringify({
        q,
        num: 12,
        safe: 'active',
      }),
    });

    if (!response.ok) {
      throw new AppError('Serper image search failed', response.status);
    }
    const payload = await response.json() as {
      images?: Array<{
        title?: string;
        imageUrl?: string;
        thumbnailUrl?: string;
        source?: string;
        link?: string;
      }>;
    };
    return {
      configured: true,
      items: (payload.images ?? []).map((item) => ({
        title: item.title,
        url: item.imageUrl,
        thumbnailUrl: item.thumbnailUrl,
        source: item.source,
        link: item.link,
      })),
    };
  }

  async searchYouTube(query: string) {
    const q = ensureQuery(query);
    if (!env.YOUTUBE_API_KEY) {
      return {
        configured: false,
        items: [],
        message: 'YouTube search is not configured.',
      };
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('key', env.YOUTUBE_API_KEY);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('safeSearch', 'strict');
    url.searchParams.set('maxResults', '12');
    url.searchParams.set('q', q);

    const response = await fetch(url);
    if (!response.ok) {
      throw new AppError('YouTube search failed', response.status);
    }
    const payload = await response.json() as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: {
          title?: string;
          description?: string;
          thumbnails?: { medium?: { url?: string } };
        };
      }>;
    };
    return {
      configured: true,
      items: (payload.items ?? []).map((item) => ({
        videoId: item.id?.videoId,
        title: item.snippet?.title,
        description: item.snippet?.description,
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url,
        url: item.id?.videoId
          ? `https://www.youtube.com/watch?v=${item.id.videoId}`
          : null,
      })),
    };
  }

  dropboxOAuthUrl(userId: string) {
    if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET) {
      return {
        configured: false,
        authUrl: null,
        message: 'Dropbox OAuth is not configured.',
        action: 'configure',
      };
    }

    const redirectUri = `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/oauth/dropbox/callback`;
    const state = jwt.sign(
      { userId, provider: 'dropbox' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '10m' },
    );
    const url = new URL(DROPBOX_AUTH_URL);
    url.searchParams.set('client_id', env.DROPBOX_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('token_access_type', 'offline');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', DROPBOX_SCOPES);
    return {
      configured: true,
      authUrl: url.toString(),
      message: 'Open this URL to connect Dropbox.',
      action: 'connect',
    };
  }

  async handleDropboxCallback(input: { code?: string; state?: string; error?: string }) {
    if (input.error) {
      throw new AppError(`Dropbox authorization failed: ${input.error}`, 400);
    }
    if (!input.code || !input.state) {
      throw new AppError('Dropbox callback is missing code or state', 400);
    }
    if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET) {
      throw new AppError('Dropbox OAuth is not configured.', 400);
    }

    const decoded = jwt.verify(input.state, env.JWT_ACCESS_SECRET) as DropboxStatePayload;
    if (decoded.provider !== 'dropbox' || !decoded.userId) {
      throw new AppError('Invalid Dropbox OAuth state', 400);
    }

    const redirectUri = `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/oauth/dropbox/callback`;
    const body = new URLSearchParams({
      code: input.code,
      grant_type: 'authorization_code',
      client_id: env.DROPBOX_CLIENT_ID,
      client_secret: env.DROPBOX_CLIENT_SECRET,
      redirect_uri: redirectUri,
    });
    const response = await fetch(DROPBOX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new AppError('Dropbox token exchange failed', response.status);
    }
    const token = await response.json() as DropboxTokenResponse;
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : undefined;
    const storedTokens: DropboxStoredTokens = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accountId: token.account_id,
      tokenType: token.token_type,
      expiresAt: expiresAt?.toISOString(),
    };

    await prisma.oAuthConnection.upsert({
      where: {
        userId_provider: {
          userId: decoded.userId,
          provider: OAuthProvider.DROPBOX,
        },
      },
      create: {
        userId: decoded.userId,
        provider: OAuthProvider.DROPBOX,
        encryptedTokens: encryptJson(storedTokens),
        scopes: token.scope ?? DROPBOX_SCOPES,
        expiresAt,
      },
      update: {
        encryptedTokens: encryptJson(storedTokens),
        scopes: token.scope ?? DROPBOX_SCOPES,
        expiresAt,
      },
    });

    return { connected: true };
  }

  async dropboxStatus(userId: string) {
    const connection = await this.findDropboxConnection(userId);
    const configured = Boolean(env.DROPBOX_CLIENT_ID && env.DROPBOX_CLIENT_SECRET);
    const connected = Boolean(connection);
    return {
      configured,
      connected,
      action: connected ? 'refresh' : configured ? 'connect' : 'configure',
      message: connectorStatusMessage('Dropbox', configured, connected),
      scopes: connection?.scopes ?? null,
      updatedAt: connection?.updatedAt ?? null,
      expiresAt: connection?.expiresAt ?? null,
    };
  }

  async disconnectDropbox(userId: string) {
    await prisma.oAuthConnection.deleteMany({
      where: { userId, provider: providerValue('DROPBOX') },
    });
    return { connected: false };
  }

  async listDropboxFiles(userId: string, path = '') {
    const accessToken = await this.getDropboxAccessToken(userId);
    const response = await fetch(DROPBOX_LIST_FOLDER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path,
        recursive: false,
        include_deleted: false,
        include_non_downloadable_files: false,
      }),
    });
    if (!response.ok) {
      throw connectorError('Dropbox', 'file list', response.status);
    }
    const payload = await response.json() as DropboxListResponse;
    const entries = (payload.entries ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      path: entry.path_display ?? entry.path_lower ?? '',
      type: entry['.tag'] === 'folder' ? 'folder' : 'file',
      sizeBytes: entry.size ?? null,
      modifiedAt: entry.server_modified ?? null,
    }));
    return {
      path,
      entries,
      hasMore: Boolean(payload.has_more),
      cursor: payload.cursor ?? null,
    };
  }

  async importDropboxFile(userId: string, dropboxPath: string) {
    if (!dropboxPath || !dropboxPath.trim()) {
      throw new AppError('Dropbox file path is required', 400);
    }
    const accessToken = await this.getDropboxAccessToken(userId);
    const response = await fetch(DROPBOX_DOWNLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
      },
    });
    if (!response.ok) {
      throw connectorError('Dropbox', 'file download', response.status);
    }
    const metadataHeader = response.headers.get('dropbox-api-result');
    const metadata = metadataHeader
      ? JSON.parse(metadataHeader) as { name?: string; size?: number }
      : {};
    const fileName = metadata.name ?? dropboxPath.split('/').pop() ?? 'dropbox-file';
    const buffer = Buffer.from(await response.arrayBuffer());
    const file: Express.Multer.File = {
      fieldname: 'file',
      originalname: fileName,
      encoding: '7bit',
      mimetype: mimeTypeForFileName(fileName),
      size: metadata.size ?? buffer.length,
      buffer,
      destination: '',
      filename: fileName,
      path: '',
      stream: Readable.from(buffer),
    };

    const stored = await fileStorageService.storeFile(`dropbox/${userId}`, file);
    return {
      ...stored,
      dropboxPath,
    };
  }

  async createDropboxFolder(userId: string, input: CloudFolderInput) {
    const folderPath = input.path?.trim()
      ? normalizeFolderPath(input.path)
      : normalizeDropboxFilePath(input.name ?? '', '');
    if (!folderPath) {
      throw new AppError('Dropbox folder path is required', 400);
    }
    const accessToken = await this.getDropboxAccessToken(userId);
    const response = await fetch(DROPBOX_CREATE_FOLDER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: folderPath,
        autorename: false,
      }),
    });
    if (!response.ok) {
      throw connectorError('Dropbox', 'folder creation', response.status);
    }
    const payload = await response.json() as {
      metadata?: { id?: string; name?: string; path_display?: string; path_lower?: string };
    };
    const metadata = payload.metadata ?? {};
    return {
      id: metadata.id ?? null,
      name: metadata.name ?? folderPath.split('/').pop(),
      path: metadata.path_display ?? metadata.path_lower ?? folderPath,
      type: 'folder',
    };
  }

  async uploadDropboxFile(userId: string, input: CloudUploadInput) {
    const fileName = (input.fileName ?? input.name ?? '').trim();
    const mimeType = input.mimeType?.trim() || mimeTypeForFileName(fileName);
    const buffer = base64ToBuffer(
      input.contentBase64 ?? input.dataBase64 ?? input.content,
    );
    const requestedPath = input.path?.trim();
    const requestedName = requestedPath?.split('/').filter(Boolean).pop();
    const dropboxPath = requestedPath?.startsWith('/') && requestedName === fileName
      ? requestedPath
      : normalizeDropboxFilePath(fileName, requestedPath);
    const accessToken = await this.getDropboxAccessToken(userId);
    const response = await fetch(DROPBOX_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath,
          mode: input.overwrite === false ? 'add' : 'overwrite',
          autorename: input.overwrite === false,
          mute: false,
        }),
      },
      body: buffer,
    });
    if (!response.ok) {
      throw connectorError('Dropbox', 'file upload', response.status);
    }
    const metadata = await response.json() as {
      id?: string;
      name?: string;
      path_display?: string;
      path_lower?: string;
      size?: number;
      server_modified?: string;
    };
    return {
      id: metadata.id ?? null,
      name: metadata.name ?? fileName,
      path: metadata.path_display ?? metadata.path_lower ?? dropboxPath,
      type: 'file',
      mimeType,
      sizeBytes: metadata.size ?? buffer.length,
      modifiedAt: metadata.server_modified ?? null,
    };
  }

  googleDriveOAuthUrl(userId: string) {
    if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET) {
      return {
        configured: false,
        authUrl: null,
        message: 'Google Drive OAuth is not configured.',
        action: 'configure',
      };
    }

    const redirectUri = this.googleDriveRedirectUri();
    const state = jwt.sign(
      { userId, provider: 'google_drive' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '10m' },
    );
    const url = new URL(GOOGLE_DRIVE_AUTH_URL);
    url.searchParams.set('client_id', env.GOOGLE_DRIVE_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('scope', GOOGLE_DRIVE_SCOPES);
    url.searchParams.set('state', state);
    return {
      configured: true,
      authUrl: url.toString(),
      message: 'Open this URL to connect Google Drive.',
      action: 'connect',
    };
  }

  async handleGoogleDriveCallback(input: {
    code?: string;
    state?: string;
    error?: string;
  }) {
    if (input.error) {
      throw new AppError(`Google Drive authorization failed: ${input.error}`, 400);
    }
    if (!input.code || !input.state) {
      throw new AppError('Google Drive callback is missing code or state', 400);
    }
    if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET) {
      throw new AppError('Google Drive OAuth is not configured.', 400);
    }

    const decoded = jwt.verify(
      input.state,
      env.JWT_ACCESS_SECRET,
    ) as GoogleDriveStatePayload;
    if (decoded.provider !== 'google_drive' || !decoded.userId) {
      throw new AppError('Invalid Google Drive OAuth state', 400);
    }

    const body = new URLSearchParams({
      code: input.code,
      grant_type: 'authorization_code',
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      redirect_uri: this.googleDriveRedirectUri(),
    });
    const response = await fetch(GOOGLE_DRIVE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw new AppError('Google Drive token exchange failed', response.status);
    }
    const token = await response.json() as GoogleDriveTokenResponse;
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : undefined;
    const storedTokens: GoogleDriveStoredTokens = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      expiresAt: expiresAt?.toISOString(),
    };

    await prisma.oAuthConnection.upsert({
      where: {
        userId_provider: {
          userId: decoded.userId,
          provider: providerValue('GOOGLE_DRIVE'),
        },
      },
      create: {
        userId: decoded.userId,
        provider: providerValue('GOOGLE_DRIVE'),
        encryptedTokens: encryptJson(storedTokens),
        scopes: token.scope ?? GOOGLE_DRIVE_SCOPES,
        expiresAt,
      },
      update: {
        encryptedTokens: encryptJson(storedTokens),
        scopes: token.scope ?? GOOGLE_DRIVE_SCOPES,
        expiresAt,
      },
    });

    return { connected: true };
  }

  async googleDriveStatus(userId: string) {
    const connection = await this.findGoogleDriveConnection(userId);
    const configured = Boolean(
      env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET,
    );
    const connected = Boolean(connection);
    return {
      configured,
      connected,
      action: connected ? 'refresh' : configured ? 'connect' : 'configure',
      message: connectorStatusMessage('Google Drive', configured, connected),
      scopes: connection?.scopes ?? null,
      updatedAt: connection?.updatedAt ?? null,
      expiresAt: connection?.expiresAt ?? null,
    };
  }

  async disconnectGoogleDrive(userId: string) {
    await prisma.oAuthConnection.deleteMany({
      where: { userId, provider: providerValue('GOOGLE_DRIVE') },
    });
    return { connected: false };
  }

  async listGoogleDriveFiles(userId: string, parentId = 'root', pageToken?: string) {
    const accessToken = await this.getGoogleDriveAccessToken(userId);
    const url = new URL(GOOGLE_DRIVE_FILES_URL);
    url.searchParams.set(
      'q',
      `'${escapeDriveQueryValue(parentId || 'root')}' in parents and trashed = false`,
    );
    url.searchParams.set(
      'fields',
      'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
    );
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('orderBy', 'folder,name');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw connectorError('Google Drive', 'file list', response.status);
    }
    const payload = await response.json() as GoogleDriveListResponse;
    return {
      parentId: parentId || 'root',
      entries: (payload.files ?? []).map((file) => ({
        id: file.id ?? '',
        name: file.name ?? 'Untitled',
        path: file.id ?? '',
        type: file.mimeType === GOOGLE_DRIVE_FOLDER_MIME ? 'folder' : 'file',
        mimeType: file.mimeType ?? null,
        sizeBytes: file.size ? Number(file.size) : null,
        modifiedAt: file.modifiedTime ?? null,
        webViewLink: file.webViewLink ?? null,
      })),
      hasMore: Boolean(payload.nextPageToken),
      cursor: payload.nextPageToken ?? null,
    };
  }

  async createGoogleDriveFolder(userId: string, input: CloudFolderInput) {
    const name = input.name?.trim();
    if (!name) {
      throw new AppError('Google Drive folder name is required', 400);
    }
    const accessToken = await this.getGoogleDriveAccessToken(userId);
    const response = await fetch(GOOGLE_DRIVE_FILES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: GOOGLE_DRIVE_FOLDER_MIME,
        parents: [input.parentId?.trim() || 'root'],
      }),
    });
    if (!response.ok) {
      throw connectorError('Google Drive', 'folder creation', response.status);
    }
    const metadata = await response.json() as {
      id?: string;
      name?: string;
      mimeType?: string;
    };
    return {
      id: metadata.id ?? null,
      name: metadata.name ?? name,
      path: metadata.id ?? '',
      type: 'folder',
      mimeType: metadata.mimeType ?? GOOGLE_DRIVE_FOLDER_MIME,
    };
  }

  async uploadGoogleDriveFile(userId: string, input: CloudUploadInput) {
    const fileName = (input.fileName ?? input.name ?? '').trim();
    if (!fileName) {
      throw new AppError('File name is required', 400);
    }
    const mimeType = input.mimeType?.trim() || mimeTypeForFileName(fileName);
    const buffer = base64ToBuffer(
      input.contentBase64 ?? input.dataBase64 ?? input.content,
    );
    const accessToken = await this.getGoogleDriveAccessToken(userId);
    const boundary = `softlogic_${randomBytes(12).toString('hex')}`;
    const metadata = {
      name: fileName,
      parents: [input.parentId?.trim() || 'root'],
    };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      ),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const url = new URL(GOOGLE_DRIVE_UPLOAD_URL);
    url.searchParams.set('uploadType', 'multipart');
    url.searchParams.set(
      'fields',
      'id,name,mimeType,size,modifiedTime,webViewLink',
    );
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!response.ok) {
      throw connectorError('Google Drive', 'file upload', response.status);
    }
    const metadataResponse = await response.json() as {
      id?: string;
      name?: string;
      mimeType?: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    };
    return {
      id: metadataResponse.id ?? null,
      name: metadataResponse.name ?? fileName,
      path: metadataResponse.id ?? '',
      type: 'file',
      mimeType: metadataResponse.mimeType ?? mimeType,
      sizeBytes: metadataResponse.size
        ? Number(metadataResponse.size)
        : buffer.length,
      modifiedAt: metadataResponse.modifiedTime ?? null,
      webViewLink: metadataResponse.webViewLink ?? null,
    };
  }

  async importGoogleDriveFile(userId: string, fileId: string, fileName?: string) {
    const normalizedFileId = fileId.trim();
    if (!normalizedFileId) {
      throw new AppError('Google Drive file id is required', 400);
    }
    const accessToken = await this.getGoogleDriveAccessToken(userId);
    const metadataResponse = await fetch(
      `${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(normalizedFileId)}?fields=id,name,mimeType,size`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!metadataResponse.ok) {
      throw connectorError('Google Drive', 'metadata lookup', metadataResponse.status);
    }
    const metadata = await metadataResponse.json() as {
      name?: string;
      mimeType?: string;
      size?: string;
    };
    if (metadata.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
      throw new AppError('Google Drive folders cannot be imported as files', 400);
    }
    const response = await fetch(
      `${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(normalizedFileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      throw connectorError('Google Drive', 'file download', response.status);
    }
    const resolvedFileName = fileName?.trim() || metadata.name || 'drive-file';
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = multerFileFromBuffer(
      resolvedFileName,
      metadata.mimeType ?? mimeTypeForFileName(resolvedFileName),
      buffer,
    );
    const stored = await fileStorageService.storeFile(`google-drive/${userId}`, file);
    return {
      ...stored,
      googleDriveFileId: normalizedFileId,
    };
  }

  webPortalStatus(userId: string) {
    return {
      configured: true,
      connected: true,
      action: 'refresh',
      userId,
      message: 'Web Portal storage uses authenticated Softlogic app storage.',
    };
  }

  async listWebPortalFiles(userId: string) {
    const [canvases, exports] = await Promise.all([
      prisma.canvas.findMany({
        where: { userId, deletedAt: null },
        select: {
          id: true,
          name: true,
          updatedAt: true,
          thumbnail: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      prisma.export.findMany({
        where: {
          userId,
          status: ExportStatus.COMPLETED,
          fileUrl: { not: null },
        },
        select: {
          id: true,
          format: true,
          status: true,
          fileUrl: true,
          fileSize: true,
          completedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      entries: [
        ...canvases.map((canvas) => ({
          id: canvas.id,
          name: canvas.name,
          type: 'board',
          path: canvas.id,
          modifiedAt: canvas.updatedAt,
          thumbnail: canvas.thumbnail,
        })),
        ...exports.map((exportRecord) => ({
          id: exportRecord.id,
          name: `Export ${exportRecord.id}.${exportRecord.format.toLowerCase()}`,
          type: 'file',
          path: exportRecord.fileUrl!,
          status: exportRecord.status,
          sizeBytes: exportRecord.fileSize,
          modifiedAt: exportRecord.completedAt,
        })),
      ],
    };
  }

  async uploadWebPortalFile(userId: string, input: CloudUploadInput) {
    const fileName = (input.fileName ?? input.name ?? '').trim();
    if (!fileName) {
      throw new AppError('File name is required', 400);
    }
    const mimeType = input.mimeType?.trim() || mimeTypeForFileName(fileName);
    const buffer = base64ToBuffer(
      input.contentBase64 ?? input.dataBase64 ?? input.content,
    );
    const stored = await fileStorageService.storeFile(
      `web-portal/${userId}`,
      multerFileFromBuffer(fileName, mimeType, buffer),
    );
    return {
      ...stored,
      type: 'file',
    };
  }

  async importWebPortalFile(userId: string, pathValue: string, fileName?: string) {
    const normalizedPath = pathValue.trim();
    if (!normalizedPath) {
      throw new AppError('Web Portal file path is required', 400);
    }
    const exportRecord = await prisma.export.findFirst({
      where: {
        userId,
        status: ExportStatus.COMPLETED,
        OR: [
          { id: normalizedPath },
          { fileUrl: normalizedPath },
        ],
      },
      select: {
        id: true,
        fileUrl: true,
        format: true,
      },
    });
    if (!exportRecord?.fileUrl) {
      throw new AppError('Web Portal file is not available for import', 404);
    }

    const resolvedFileName =
      fileName?.trim() ||
      this.webPortalFileName(exportRecord.fileUrl, exportRecord.id, exportRecord.format);
    const buffer = await this.readWebPortalExportBuffer(exportRecord.fileUrl);
    const stored = await fileStorageService.storeFile(
      `web-portal-import/${userId}`,
      multerFileFromBuffer(
        resolvedFileName,
        mimeTypeForFileName(resolvedFileName),
        buffer,
      ),
    );
    return {
      ...stored,
      webPortalPath: exportRecord.fileUrl,
      exportId: exportRecord.id,
    };
  }

  async lmsStatus(userId: string) {
    const connections = await prisma.lmsConnection.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      configured: connections.length > 0,
      connections,
    };
  }

  async createLmsSync(userId: string, payload: Record<string, unknown>) {
    return prisma.lmsSyncJob.create({
      data: {
        userId,
        connectionId: payload.connectionId?.toString(),
        liveSessionId: payload.liveSessionId?.toString(),
        direction: payload.direction?.toString() ?? 'EXPORT',
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }

  private async findDropboxConnection(userId: string) {
    return prisma.oAuthConnection.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: providerValue('DROPBOX'),
        },
      },
    });
  }

  private webPortalFileName(
    fileUrl: string,
    exportId: string,
    format: string,
  ): string {
    try {
      const parsed = new URL(fileUrl);
      const basename = path.basename(parsed.pathname);
      if (basename && basename !== '/') {
        return basename;
      }
    } catch {
      const basename = path.basename(fileUrl);
      if (basename && basename !== '.') {
        return basename;
      }
    }
    return `web-portal-export-${exportId}.${format.toLowerCase()}`;
  }

  private async readWebPortalExportBuffer(fileUrl: string): Promise<Buffer> {
    if (/^https?:\/\//i.test(fileUrl)) {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new AppError('Web Portal file download failed', response.status);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    const storageRoot = path.resolve(process.cwd(), 'storage');
    const resolvedPath = path.resolve(fileUrl);
    if (!resolvedPath.startsWith(storageRoot)) {
      throw new AppError('Invalid Web Portal storage path', 400);
    }
    const fileStats = await stat(resolvedPath);
    if (!fileStats.isFile()) {
      throw new AppError('Web Portal file is not available for import', 404);
    }
    return readFile(resolvedPath);
  }

  private async findGoogleDriveConnection(userId: string) {
    return prisma.oAuthConnection.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: providerValue('GOOGLE_DRIVE'),
        },
      },
    });
  }

  private googleDriveRedirectUri(): string {
    return (
      env.GOOGLE_DRIVE_REDIRECT_URI ??
      `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/oauth/google-drive/callback`
    );
  }

  private async getDropboxAccessToken(userId: string): Promise<string> {
    const connection = await this.findDropboxConnection(userId);
    if (!connection) {
      throw new AppError('Dropbox is not connected', 400);
    }
    const tokens = decryptJson<DropboxStoredTokens>(connection.encryptedTokens);
    if (!tokens.expiresAt || new Date(tokens.expiresAt).getTime() > Date.now() + 60_000) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken || !env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET) {
      throw new AppError('Dropbox token is expired. Please reconnect Dropbox.', 401);
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: env.DROPBOX_CLIENT_ID,
      client_secret: env.DROPBOX_CLIENT_SECRET,
    });
    const response = await fetch(DROPBOX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw connectorTokenRefreshError('Dropbox', response.status);
    }
    const refreshed = await response.json() as DropboxTokenResponse;
    const expiresAt = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000)
      : undefined;
    const updatedTokens: DropboxStoredTokens = {
      ...tokens,
      accessToken: refreshed.access_token,
      tokenType: refreshed.token_type ?? tokens.tokenType,
      expiresAt: expiresAt?.toISOString(),
    };
    await prisma.oAuthConnection.update({
      where: {
        userId_provider: {
          userId,
          provider: providerValue('DROPBOX'),
        },
      },
      data: {
        encryptedTokens: encryptJson(updatedTokens),
        expiresAt,
      },
    });
    return refreshed.access_token;
  }

  private async getGoogleDriveAccessToken(userId: string): Promise<string> {
    const connection = await this.findGoogleDriveConnection(userId);
    if (!connection) {
      throw new AppError('Google Drive is not connected', 400);
    }
    const tokens = decryptJson<GoogleDriveStoredTokens>(connection.encryptedTokens);
    if (!tokens.expiresAt || new Date(tokens.expiresAt).getTime() > Date.now() + 60_000) {
      return tokens.accessToken;
    }
    if (
      !tokens.refreshToken ||
      !env.GOOGLE_DRIVE_CLIENT_ID ||
      !env.GOOGLE_DRIVE_CLIENT_SECRET
    ) {
      throw new AppError('Google Drive token is expired. Please reconnect Google Drive.', 401);
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
    });
    const response = await fetch(GOOGLE_DRIVE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw connectorTokenRefreshError('Google Drive', response.status);
    }
    const refreshed = await response.json() as GoogleDriveTokenResponse;
    const expiresAt = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000)
      : undefined;
    const updatedTokens: GoogleDriveStoredTokens = {
      ...tokens,
      accessToken: refreshed.access_token,
      tokenType: refreshed.token_type ?? tokens.tokenType,
      expiresAt: expiresAt?.toISOString(),
    };
    await prisma.oAuthConnection.update({
      where: {
        userId_provider: {
          userId,
          provider: providerValue('GOOGLE_DRIVE'),
        },
      },
      data: {
        encryptedTokens: encryptJson(updatedTokens),
        expiresAt,
      },
    });
    return refreshed.access_token;
  }
}

export const integrationsService = new IntegrationsService();
