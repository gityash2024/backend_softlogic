import { OAuthProvider } from '@prisma/client';

import { prisma } from '@/config';
import { integrationsService } from '@/modules/integrations/integrations.service';
import { fileStorageService } from '@/shared/services/file-storage.service';

jest.mock('@/config', () => ({
  env: {
    JWT_ACCESS_SECRET: 'test_access_secret_minimum_32_chars',
    JWT_REFRESH_SECRET: 'test_refresh_secret_minimum_32_chars',
    PUBLIC_APP_URL: 'https://app.example.com',
    DROPBOX_CLIENT_ID: 'dropbox-client-id',
    DROPBOX_CLIENT_SECRET: 'dropbox-client-secret',
  },
  prisma: {
    oAuthConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    lmsConnection: {
      findMany: jest.fn(),
    },
    lmsSyncJob: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/shared/services/file-storage.service', () => ({
  fileStorageService: {
    storeFile: jest.fn(),
  },
}));

const mockedPrisma = prisma as unknown as {
  oAuthConnection: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
    update: jest.Mock;
  };
};

const mockedStorage = fileStorageService as unknown as {
  storeFile: jest.Mock;
};

const mockedFetch = jest.fn();
global.fetch = mockedFetch as unknown as typeof fetch;

describe('IntegrationsService Dropbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a signed Dropbox OAuth URL', () => {
    const result = integrationsService.dropboxOAuthUrl('user-1');

    expect(result.configured).toBe(true);
    const url = new URL(result.authUrl!);
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('dropbox-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/oauth/dropbox/callback',
    );
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('exchanges callback code and stores encrypted Dropbox tokens', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        account_id: 'account-id',
        token_type: 'bearer',
        expires_in: 14400,
        scope: 'files.metadata.read files.content.read',
      }),
    });
    const state = new URL(integrationsService.dropboxOAuthUrl('user-1').authUrl!)
      .searchParams
      .get('state')!;

    await expect(
      integrationsService.handleDropboxCallback({ code: 'oauth-code', state }),
    ).resolves.toEqual({ connected: true });

    expect(mockedPrisma.oAuthConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_provider: {
            userId: 'user-1',
            provider: OAuthProvider.DROPBOX,
          },
        },
        create: expect.objectContaining({
          encryptedTokens: expect.any(String),
          scopes: 'files.metadata.read files.content.read',
        }),
      }),
    );
  });

  it('lists Dropbox files for a connected user', async () => {
    const state = new URL(integrationsService.dropboxOAuthUrl('user-1').authUrl!)
      .searchParams
      .get('state')!;
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 14400,
      }),
    });
    await integrationsService.handleDropboxCallback({ code: 'oauth-code', state });
    const storedTokens = mockedPrisma.oAuthConnection.upsert.mock.calls[0][0]
      .create.encryptedTokens;
    mockedPrisma.oAuthConnection.findUnique.mockResolvedValue({
      encryptedTokens: storedTokens,
      scopes: 'files.metadata.read files.content.read',
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 14400 * 1000),
    });
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entries: [
          { '.tag': 'folder', name: 'Lessons', path_display: '/Lessons' },
          {
            '.tag': 'file',
            name: 'chapter.pdf',
            path_display: '/chapter.pdf',
            size: 1234,
          },
        ],
      }),
    });

    await expect(integrationsService.listDropboxFiles('user-1')).resolves.toMatchObject({
      entries: [
        { name: 'Lessons', type: 'folder' },
        { name: 'chapter.pdf', type: 'file', sizeBytes: 1234 },
      ],
    });
  });

  it('downloads and stores a Dropbox file', async () => {
    const state = new URL(integrationsService.dropboxOAuthUrl('user-1').authUrl!)
      .searchParams
      .get('state')!;
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 14400,
      }),
    });
    await integrationsService.handleDropboxCallback({ code: 'oauth-code', state });
    const storedTokens = mockedPrisma.oAuthConnection.upsert.mock.calls[0][0]
      .create.encryptedTokens;
    mockedPrisma.oAuthConnection.findUnique.mockResolvedValue({
      encryptedTokens: storedTokens,
      scopes: 'files.metadata.read files.content.read',
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 14400 * 1000),
    });
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => JSON.stringify({ name: 'diagram.png', size: 4 }),
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    });
    mockedStorage.storeFile.mockResolvedValue({
      fileName: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      storageKey: 'dropbox/user-1/file.png',
      publicUrl: 'https://cdn.example.com/file.png',
    });

    await expect(
      integrationsService.importDropboxFile('user-1', '/diagram.png'),
    ).resolves.toMatchObject({
      fileName: 'diagram.png',
      publicUrl: 'https://cdn.example.com/file.png',
      dropboxPath: '/diagram.png',
    });
    expect(mockedStorage.storeFile).toHaveBeenCalledWith(
      'dropbox/user-1',
      expect.objectContaining({
        originalname: 'diagram.png',
        mimetype: 'image/png',
        size: 4,
      }),
    );
  });
});
