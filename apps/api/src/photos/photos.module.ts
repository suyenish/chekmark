import { Global, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PHOTO_STORE } from './photo-store.js';
import { S3PhotoStore } from './s3-photo-store.js';

@Global()
@Module({
  providers: [
    {
      provide: PHOTO_STORE,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig) => {
        const store = new S3PhotoStore(config);
        // Locally the bucket is created on start. In production it is set up once, by hand.
        if (config.nodeEnv === 'development') {
          await store.ensureBucket().catch((error: unknown) => {
            new Logger('PhotosModule').warn(`Photo storage is not reachable, uploads will fail: ${String(error)}`);
          });
        }
        return store;
      },
    },
  ],
  exports: [PHOTO_STORE],
})
export class PhotosModule {}
