import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Readable } from 'stream';
import jwt from 'jsonwebtoken';
import { OAuthProvider, Prisma } from '@prisma/client';

import { env, prisma } from '@/config';
import { AppError } from '@/shared/errors/AppError';
import { fileStorageService } from '@/shared/services/file-storage.service';

const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_LIST_FOLDER_URL = 'https://api.dropboxapi.com/2/files/list_folder';
const DROPBOX_DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';
const DROPBOX_SCOPES = 'files.metadata.read files.content.read';

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
    throw new AppError('Stored Dropbox connection is invalid', 500);
  }
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
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'mp4':
      return 'video/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
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
    if (!env.DROPBOX_CLIENT_ID) {
      return {
        configured: false,
        authUrl: null,
        message: 'Dropbox OAuth is not configured.',
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
    return { configured: true, authUrl: url.toString() };
  }

  async handleDropboxCallback(input: { code?: string; state?: string; error?: string }) {
    if (input.error) {
      throw new AppError(`Dropbox authorization failed: ${input.error}`, 400);
    }
    if (!input.code || !input.state) {
      throw new AppError('Dropbox callback is missing code or state', 400);
    }
    if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET) {
      throw new AppError('Dropbox OAuth is not configured', 500);
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
    return {
      configured: Boolean(env.DROPBOX_CLIENT_ID && env.DROPBOX_CLIENT_SECRET),
      connected: Boolean(connection),
      scopes: connection?.scopes ?? null,
      updatedAt: connection?.updatedAt ?? null,
      expiresAt: connection?.expiresAt ?? null,
    };
  }

  async disconnectDropbox(userId: string) {
    await prisma.oAuthConnection.deleteMany({
      where: { userId, provider: OAuthProvider.DROPBOX },
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
      throw new AppError('Dropbox file list failed', response.status);
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
      throw new AppError('Dropbox file download failed', response.status);
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
          provider: OAuthProvider.DROPBOX,
        },
      },
    });
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
      throw new AppError('Dropbox token refresh failed', response.status);
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
          provider: OAuthProvider.DROPBOX,
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
