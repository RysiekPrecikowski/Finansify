import { put } from '@vercel/blob';
import { describe, expect, it, vi } from 'vitest';

import { createFileStore } from './file-store';

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}));

const mockedPut = vi.mocked(put);

describe('createFileStore', () => {
  it('calls put() with access: private, addRandomSuffix: false, the token, and a Buffer built from the input bytes', async () => {
    mockedPut.mockResolvedValue({
      pathname: 'imports/acc-1/123-statement.csv',
      url: 'https://blob.example/imports/acc-1/123-statement.csv',
      downloadUrl: 'https://blob.example/download/imports/acc-1/123-statement.csv',
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment',
    } as Awaited<ReturnType<typeof put>>);

    const store = createFileStore('a-blob-token');
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);

    await store.put('imports/acc-1/123-statement.csv', bytes);

    expect(mockedPut).toHaveBeenCalledTimes(1);
    const [key, body, options] = mockedPut.mock.calls[0]!;
    expect(key).toBe('imports/acc-1/123-statement.csv');
    expect(body).toBeInstanceOf(Buffer);
    expect(Buffer.from(body as Buffer)).toEqual(Buffer.from(bytes));
    expect(options).toMatchObject({
      access: 'private',
      addRandomSuffix: false,
      token: 'a-blob-token',
    });
  });

  it('maps the returned PutBlobResult to StoredFile using pathname for key and url for url, never downloadUrl', async () => {
    mockedPut.mockResolvedValue({
      pathname: 'imports/acc-2/456-other.csv',
      url: 'https://blob.example/imports/acc-2/456-other.csv',
      downloadUrl: 'https://blob.example/download/imports/acc-2/456-other.csv',
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment',
    } as Awaited<ReturnType<typeof put>>);

    const store = createFileStore('a-blob-token');

    const result = await store.put('imports/acc-2/456-other.csv', Uint8Array.from([9, 9, 9]));

    expect(result).toEqual({
      key: 'imports/acc-2/456-other.csv',
      url: 'https://blob.example/imports/acc-2/456-other.csv',
    });
  });
});
