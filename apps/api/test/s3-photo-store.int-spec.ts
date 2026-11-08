import { PhotoNotFoundError } from '../src/photos/photo-store.js';
import { S3PhotoStore } from '../src/photos/s3-photo-store.js';
import { startTestS3 } from './helpers/test-s3.js';

describe('S3PhotoStore against S3-compatible storage', () => {
  let s3: Awaited<ReturnType<typeof startTestS3>>;
  let store: S3PhotoStore;

  beforeAll(async () => {
    s3 = await startTestS3();
    store = new S3PhotoStore({
      s3Endpoint: s3.endpoint,
      s3Region: 'us-east-1',
      s3Bucket: 'test-photos',
      s3AccessKeyId: 'test',
      s3SecretAccessKey: 'test',
    });
    await store.ensureBucket();
    await store.ensureBucket(); // a second call finds the bucket and does nothing
  });

  afterAll(async () => {
    await s3?.stop();
  });

  it('puts, gets and deletes a photo', async () => {
    const photo = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    await store.put('users/u1/pages/p1.jpg', photo);
    expect(await store.get('users/u1/pages/p1.jpg')).toEqual(photo);

    await store.delete('users/u1/pages/p1.jpg');
    await expect(store.get('users/u1/pages/p1.jpg')).rejects.toBeInstanceOf(PhotoNotFoundError);
  });

  it('throws PhotoNotFoundError for a missing photo and deletes a missing photo without error', async () => {
    await expect(store.get('users/u1/pages/missing.jpg')).rejects.toBeInstanceOf(PhotoNotFoundError);
    await expect(store.delete('users/u1/pages/missing.jpg')).resolves.toBeUndefined();
  });
});
