# Configuration

This guide covers all configuration options for Octoload.

## Basic Configuration

```typescript
// src/lib/octoload/config.ts
import type { OctoloadConfig } from 'octoload';

export const octoloadConfig: OctoloadConfig = {
  storage: {
    adapter: 's3', // or 'r2'
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION!,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  },
  limits: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxVariants: 5,
  },
  hooks: {
    beforePresign: async (context) => {
      // Custom validation
      return context;
    },
    afterFinalize: async (image) => {
      // Post-upload processing
    },
  },
};
```

## Storage Configuration

### AWS S3

```typescript
{
  storage: {
    adapter: 's3',
    bucket: 'my-app-uploads',
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  },
}
```

### Cloudflare R2

```typescript
{
  storage: {
    adapter: 'r2',
    bucket: 'my-app-uploads',
    region: 'auto',
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  },
}
```

## Limits Configuration

### File Size Limits

```typescript
{
  limits: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/avif',
    ],
    maxVariants: 10, // Maximum number of variants per image
  },
}
```

### Content Type Validation

```typescript
{
  limits: {
    allowedTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/avif',
      'image/svg+xml', // Be careful with SVG
    ],
  },
}
```

## Hooks Configuration

Hooks allow you to customize the upload process with your own logic.

### Before Presign Hook

Runs before generating presigned URLs. Use for authentication and custom validation.

```typescript
{
  hooks: {
    beforePresign: async (context) => {
      // Authentication check
      if (!context.user) {
        throw new Error('Authentication required');
      }

      // Custom file size limits per user type
      if (context.user.plan === 'free' && context.byteSize > 5 * 1024 * 1024) {
        throw new Error('Free plan limited to 5MB files');
      }

      // Modify filename
      const timestamp = Date.now();
      context.filename = `${timestamp}-${context.filename}`;

      return context;
    },
  },
}
```

### After Finalize Hook

Runs after successful upload. Use for notifications, processing, or analytics.

```typescript
{
  hooks: {
    afterFinalize: async (image) => {
      // Send notification
      await notificationService.send({
        type: 'image_uploaded',
        userId: image.ownerId,
        imageId: image.id,
      });

      // Trigger image processing
      await imageProcessor.queue({
        imageId: image.id,
        variants: ['thumb', 'webp', 'small', 'medium'],
      });

      // Analytics
      analytics.track('image_uploaded', {
        userId: image.ownerId,
        fileSize: image.byteSize,
        contentType: image.contentType,
      });
    },
  },
}
```

### On Delete Hook

Runs when images are deleted.

```typescript
{
  hooks: {
    onDelete: async (image) => {
      // Clean up variants
      await variantService.deleteAll(image.id);
      
      // Analytics
      analytics.track('image_deleted', {
        userId: image.ownerId,
        imageId: image.id,
      });
    },
  },
}
```

### On Process Variant Hook

Runs when image variants are processed.

```typescript
{
  hooks: {
    onProcessVariant: async (variant) => {
      // Update search index
      await searchService.updateImageVariants(variant.imageId);
      
      // Notify user of processing completion
      if (variant.variant === 'thumb') {
        await notificationService.send({
          type: 'thumbnail_ready',
          imageId: variant.imageId,
        });
      }
    },
  },
}
```

## Database Configuration

### Custom Schema Options

```typescript
{
  db: {
    schema: 'uploads', // Use custom schema
    tablePrefix: 'octo_', // Prefix all tables
  },
}
```

### Table Names

By default, Octoload creates these tables:
- `images` - Main image records
- `upload_sessions` - Multipart upload tracking
- `asset_variants` - Image variants
- `image_tags` - Image tags

With custom prefix:
- `octo_images`
- `octo_upload_sessions`
- `octo_asset_variants`
- `octo_image_tags`

## Environment Variables

### Required Variables

```bash
# Storage (choose S3 or R2)
S3_BUCKET=your-s3-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...

# OR for R2
R2_BUCKET=your-r2-bucket
R2_REGION=auto
R2_ENDPOINT=https://account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...

# Database
DATABASE_URL=postgresql://...
```

### Optional Variables

```bash
# Upload limits
OCTOLOAD_MAX_FILE_SIZE=10485760  # 10MB in bytes
OCTOLOAD_MAX_VARIANTS=5

# Storage configuration
OCTOLOAD_STORAGE_ADAPTER=s3      # or 'r2'
OCTOLOAD_PRESIGN_EXPIRY=3600     # 1 hour in seconds
```

## Framework-Specific Configuration

### Next.js Configuration

```typescript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['octoload'],
  },
};

module.exports = nextConfig;
```

### React Router Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['octoload'],
  },
});
```

## TypeScript Configuration

Ensure your `tsconfig.json` includes proper module resolution:

```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true
  }
}
```

## Advanced Configuration

### Custom Storage Keys

```typescript
{
  hooks: {
    beforePresign: async (context) => {
      // Custom storage key generation
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, '0');
      const userId = context.user?.id || 'anonymous';
      const randomId = crypto.randomUUID();
      
      // Override default storage key
      context.storageKey = `uploads/${year}/${month}/${userId}/${randomId}`;
      
      return context;
    },
  },
}
```

### Custom Multipart Thresholds

```typescript
{
  storage: {
    // ... other config
    multipartThreshold: 100 * 1024 * 1024, // 100MB
    partSize: 50 * 1024 * 1024, // 50MB parts
  },
}
```

## Performance Tuning

### Connection Pooling

```typescript
import { S3Client } from '@aws-sdk/client-s3';

// Custom S3 client with connection pooling
const s3Client = new S3Client({
  region: process.env.S3_REGION,
  maxAttempts: 3,
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 30000,
  },
});

// Use with Octoload (advanced usage)
```

### Batch Operations

```typescript
{
  hooks: {
    afterFinalize: async (image) => {
      // Batch multiple operations
      await Promise.all([
        analytics.track('upload', { imageId: image.id }),
        cache.invalidate(`user:${image.ownerId}:images`),
        searchIndex.add(image),
      ]);
    },
  },
}
```

## Troubleshooting

### Common Configuration Issues

1. **CORS Errors**: Ensure your S3/R2 bucket allows CORS from your domain
2. **Permission Errors**: Verify IAM permissions for S3 operations
3. **Database Errors**: Check DATABASE_URL format and connection
4. **TypeScript Errors**: Ensure proper module resolution in tsconfig.json

### Debug Configuration

```typescript
{
  debug: process.env.NODE_ENV === 'development',
  hooks: {
    beforePresign: async (context) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('Presign context:', context);
      }
      return context;
    },
  },
}
```