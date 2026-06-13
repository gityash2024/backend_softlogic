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
    GOOGLE_DRIVE_CLIENT_ID: 'google-drive-client-id',
    GOOGLE_DRIVE_CLIENT_SECRET: 'google-drive-client-secret',
    GOOGLE_DRIVE_REDIRECT_URI: 'https://app.example.com/oauth/google-drive/callback',
    ONEDRIVE_CLIENT_ID: 'onedrive-client-id',
    ONEDRIVE_CLIENT_SECRET: 'onedrive-client-secret',
    ONEDRIVE_REDIRECT_URI: 'https://app.example.com/oauth/onedrive/callback',
  },
  prisma: {
    oAuthConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    organizationStorageConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    lmsConnection: {
      findMany: jest.fn(),
    },
    lmsSyncJob: {
      create: jest.fn(),
    },
    canvas: {
      findMany: jest.fn(),
    },
    export: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
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
  organizationStorageConnection: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
  };
  canvas: {
    findMany: jest.Mock;
  };
  export: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
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
    expect(result.action).toBe('connect');
    const url = new URL(result.authUrl!);
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('dropbox-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/oauth/dropbox/callback',
    );
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('returns an actionable disconnected Dropbox status', async () => {
    mockedPrisma.oAuthConnection.findUnique.mockResolvedValue(null);

    await expect(integrationsService.dropboxStatus('user-1')).resolves.toMatchObject({
      configured: true,
      connected: false,
      action: 'connect',
      message: 'Connect your Dropbox account.',
    });
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

  it('uploads a file to Dropbox', async () => {
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
      scopes: 'files.metadata.read files.content.read files.content.write',
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 14400 * 1000),
    });
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'dbx-file-id',
        name: 'board.softlogic-board',
        path_display: '/Boards/board.softlogic-board',
        size: 4,
      }),
    });

    await expect(
      integrationsService.uploadDropboxFile('user-1', {
        fileName: 'board.softlogic-board',
        path: '/Boards',
        contentBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      }),
    ).resolves.toMatchObject({
      id: 'dbx-file-id',
      path: '/Boards/board.softlogic-board',
      sizeBytes: 4,
    });
    expect(mockedFetch).toHaveBeenLastCalledWith(
      'https://content.dropboxapi.com/2/files/upload',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Dropbox-API-Arg': expect.stringContaining('/Boards/board.softlogic-board'),
        }),
      }),
    );
  });

  it('creates a signed Google Drive OAuth URL', () => {
    const result = integrationsService.googleDriveOAuthUrl('user-1');

    expect(result.configured).toBe(true);
    expect(result.action).toBe('connect');
    const url = new URL(result.authUrl!);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('google-drive-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/oauth/google-drive/callback',
    );
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/drive.file',
    );
  });

  it('returns an actionable disconnected Google Drive status', async () => {
    mockedPrisma.oAuthConnection.findUnique.mockResolvedValue(null);

    await expect(integrationsService.googleDriveStatus('user-1')).resolves.toMatchObject({
      configured: true,
      connected: false,
      action: 'connect',
      message: 'Connect your Google Drive account.',
    });
  });

  it('lists Google Drive files for a connected user', async () => {
    const state = new URL(integrationsService.googleDriveOAuthUrl('user-1').authUrl!)
      .searchParams
      .get('state')!;
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'drive-access-token',
        refresh_token: 'drive-refresh-token',
        expires_in: 3600,
      }),
    });
    await integrationsService.handleGoogleDriveCallback({ code: 'oauth-code', state });
    const storedTokens = mockedPrisma.oAuthConnection.upsert.mock.calls.at(-1)[0]
      .create.encryptedTokens;
    mockedPrisma.oAuthConnection.findUnique.mockResolvedValue({
      encryptedTokens: storedTokens,
      scopes: 'https://www.googleapis.com/auth/drive.file',
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: [
          {
            id: 'folder-id',
            name: 'Lessons',
            mimeType: 'application/vnd.google-apps.folder',
          },
          {
            id: 'file-id',
            name: 'worksheet.pdf',
            mimeType: 'application/pdf',
            size: '2048',
          },
        ],
      }),
    });

    await expect(
      integrationsService.listGoogleDriveFiles('user-1', 'root'),
    ).resolves.toMatchObject({
      entries: [
        { id: 'folder-id', name: 'Lessons', type: 'folder' },
        { id: 'file-id', name: 'worksheet.pdf', type: 'file', sizeBytes: 2048 },
      ],
    });
  });

  it('stores Web Portal uploads through app storage', async () => {
    mockedStorage.storeFile.mockResolvedValue({
      fileName: 'board.softlogic-board',
      mimeType: 'application/octet-stream',
      sizeBytes: 3,
      storageKey: 'web-portal/user-1/board.softlogic-board',
      publicUrl: 'https://cdn.example.com/board.softlogic-board',
    });

    await expect(
      integrationsService.uploadWebPortalFile('user-1', {
        fileName: 'board.softlogic-board',
        contentBase64: Buffer.from([1, 2, 3]).toString('base64'),
      }),
    ).resolves.toMatchObject({
      storageKey: 'web-portal/user-1/board.softlogic-board',
      publicUrl: 'https://cdn.example.com/board.softlogic-board',
      type: 'file',
    });
  });

  it('imports completed Web Portal exports through app storage', async () => {
    mockedPrisma.export.findFirst.mockResolvedValue({
      id: 'export-1',
      fileUrl: 'https://app.example.com/storage/exports/export-1.pdf',
      format: 'PDF',
    });
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Buffer.from([4, 5, 6]).buffer,
    });
    mockedStorage.storeFile.mockResolvedValue({
      fileName: 'Export export-1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'web-portal-import/user-1/export-1.pdf',
      publicUrl: 'https://cdn.example.com/export-1.pdf',
    });

    await expect(
      integrationsService.importWebPortalFile(
        'user-1',
        'https://app.example.com/storage/exports/export-1.pdf',
        'Export export-1.pdf',
      ),
    ).resolves.toMatchObject({
      exportId: 'export-1',
      webPortalPath: 'https://app.example.com/storage/exports/export-1.pdf',
      publicUrl: 'https://cdn.example.com/export-1.pdf',
    });
    expect(mockedPrisma.export.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
    expect(mockedStorage.storeFile).toHaveBeenCalledWith(
      'web-portal-import/user-1',
      expect.objectContaining({
        originalname: 'Export export-1.pdf',
        mimetype: 'application/pdf',
      }),
    );
  });

  it.each([
    ['diagram.svg', 'image/svg+xml'],
    ['slide.ppt', 'application/vnd.ms-powerpoint'],
    ['lesson.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['recording.m4a', 'audio/mp4'],
    ['voice.ogg', 'audio/ogg'],
    ['clip.webm', 'video/webm'],
    ['movie.mov', 'video/quicktime'],
    ['notes.md', 'text/markdown'],
    ['board.slwb', 'application/vnd.softlogic.whiteboard+json'],
  ])('resolves %s MIME type for connector uploads', async (fileName, mimeType) => {
    mockedStorage.storeFile.mockResolvedValue({
      fileName,
      mimeType,
      sizeBytes: 2,
      storageKey: `web-portal/user-1/${fileName}`,
      publicUrl: `https://cdn.example.com/${fileName}`,
    });

    await integrationsService.uploadWebPortalFile('user-1', {
      fileName,
      contentBase64: Buffer.from([1, 2]).toString('base64'),
    });

    expect(mockedStorage.storeFile).toHaveBeenCalledWith(
      'web-portal/user-1',
      expect.objectContaining({
        originalname: fileName,
        mimetype: mimeType,
      }),
    );
  });
});

describe('IntegrationsService OneDrive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates an organization-scoped Microsoft OAuth URL', () => {
    const result = integrationsService.oneDriveOAuthUrl('user-1', 'org-1');

    expect(result.configured).toBe(true);
    const url = new URL(result.authUrl!);
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('onedrive-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/oauth/onedrive/callback',
    );
    expect(url.searchParams.get('scope')).toContain('Files.ReadWrite');
  });

  it('returns an actionable disconnected OneDrive status', async () => {
    mockedPrisma.organizationStorageConnection.findUnique.mockResolvedValue(null);

    await expect(integrationsService.oneDriveStatus('org-1')).resolves.toMatchObject({
      configured: true,
      connected: false,
      action: 'connect',
      message: 'Connect your OneDrive account.',
    });
  });
});
