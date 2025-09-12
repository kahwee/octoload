# Storage Adapters

Octoload supports multiple storage backends through a unified adapter interface.

## Supported Adapters

### AWS S3

The most mature and feature-complete storage adapter.

#### Configuration

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

#### Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:HeadObject",
        "s3:CreateMultipartUpload",
        "s3:CompleteMultipartUpload",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:UploadPart"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

#### CORS Configuration

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<CORSRule>
    <AllowedOrigin>https://your-domain.com</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-amz-meta-custom-header</ExposeHeader>
</CORSRule>
</CORSConfiguration>
```

### Cloudflare R2

R2 is S3-compatible with better pricing and global distribution.

#### Configuration

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

#### R2 Setup

1. Create R2 bucket in Cloudflare dashboard
2. Generate R2 API tokens with read/write permissions
3. Configure custom domain (optional) for public URLs

#### Environment Variables

```bash
R2_BUCKET=my-uploads
R2_REGION=auto
R2_ENDPOINT=https://abc123.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
```

## Storage Features

### Presigned URLs

Both S3 and R2 support presigned URLs for direct client uploads:

```typescript
// Single file upload
const presignResponse = await client.presign({
  filename: 'image.jpg',
  contentType: 'image/jpeg',
  byteSize: 1024 * 1024, // 1MB
});

// Client uploads directly to presignResponse.uploadUrl
```

### Multipart Uploads

For large files (>100MB), Octoload automatically uses multipart uploads:

```typescript
// Automatically uses multipart for large files
const presignResponse = await client.presign({
  filename: 'large-image.jpg',
  contentType: 'image/jpeg',
  byteSize: 500 * 1024 * 1024, // 500MB
  strategy: 'multipart', // or 'single'
});

// Returns multipart upload URLs
console.log(presignResponse.multipart.parts); // Array of part upload URLs
```

### Public vs Private URLs

```typescript
// Public images (accessible without authentication)
const publicImage = await client.uploadFile(file, {
  isPublic: true,
});
console.log(publicImage.image.publicUrl); // Direct public URL

// Private images (require signed URLs)
const privateImage = await client.uploadFile(file, {
  isPublic: false,
});
// Access via client.getImage(id) which returns signed URL
```

## Storage Patterns

### Organizing Files

Octoload automatically organizes files by year:

```
uploads/
├── 2025/
│   ├── cm2abc123-image.jpg
│   ├── cm2def456-photo.png
│   └── cm2ghi789-document.pdf
└── 2024/
    ├── cm1abc123-old-image.jpg
    └── ...
```

Custom organization via hooks:

```typescript
{
  hooks: {
    beforePresign: async (context) => {
      const userId = context.user.id;
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      
      // Custom path: users/{userId}/{year}/{month}/{filename}
      context.storageKey = `users/${userId}/${year}/${month}/${context.filename}`;
      
      return context;
    },
  },
}
```

### Content Delivery

#### S3 with CloudFront

```typescript
{
  storage: {
    adapter: 's3',
    bucket: 'my-uploads',
    region: 'us-east-1',
    cdnDomain: 'https://d123abc.cloudfront.net', // Optional CDN
    credentials: { ... },
  },
}
```

#### R2 with Custom Domain

```typescript
{
  storage: {
    adapter: 'r2',
    bucket: 'my-uploads',
    region: 'auto',
    publicDomain: 'https://cdn.myapp.com', // Custom domain
    endpoint: 'https://account-id.r2.cloudflarestorage.com',
    credentials: { ... },
  },
}
```

## Advanced Storage Configuration

### Cross-Region Replication

For S3, you can configure automatic replication:

```typescript
// Primary bucket configuration
{
  storage: {
    adapter: 's3',
    bucket: 'my-uploads-primary',
    region: 'us-east-1',
    replication: {
      enabled: true,
      destinations: [
        { bucket: 'my-uploads-backup', region: 'us-west-2' },
        { bucket: 'my-uploads-eu', region: 'eu-west-1' },
      ],
    },
    credentials: { ... },
  },
}
```

### Lifecycle Policies

Configure automatic cleanup and transitions:

```json
{
  "Rules": [
    {
      "ID": "DeleteIncompleteMultipartUploads",
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 1
      }
    },
    {
      "ID": "TransitionToIA",
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        }
      ]
    }
  ]
}
```

## Storage Adapter Interface

### Creating Custom Adapters

```typescript
import type { StorageAdapterInterface } from 'octoload';

class GoogleCloudStorageAdapter implements StorageAdapterInterface {
  async getPresignedPutUrl(
    key: string,
    contentType: string,
    expiresIn: number
  ): Promise<{ url: string; fields?: Record<string, string> }> {
    // Implementation for GCS presigned URLs
  }

  async getMultipartUpload(
    key: string,
    contentType: string,
    partCount: number,
    expiresIn: number
  ): Promise<{
    uploadId: string;
    parts: { partNumber: number; uploadUrl: string }[];
  }> {
    // Implementation for GCS multipart uploads
  }

  // ... other required methods
}

// Use custom adapter
{
  storage: {
    adapter: new GoogleCloudStorageAdapter({
      projectId: 'my-project',
      keyFilename: 'service-account.json',
      bucket: 'my-gcs-bucket',
    }),
  },
}
```

### Required Methods

Every storage adapter must implement:

- `getPresignedPutUrl()` - Generate signed upload URLs
- `getMultipartUpload()` - Initialize multipart uploads
- `completeMultipartUpload()` - Complete multipart uploads
- `getPublicUrl()` - Generate public access URLs
- `getPrivateUrl()` - Generate signed download URLs
- `deleteObject()` - Delete objects
- `headObject()` - Get object metadata

## Performance Optimization

### Connection Pooling

```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.S3_REGION,
  maxAttempts: 3,
  retryMode: 'adaptive',
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 30000,
  },
});
```

### Batch Operations

```typescript
// Upload multiple files in parallel
const files = [file1, file2, file3];
const results = await Promise.all(
  files.map(file => client.uploadFile(file, options))
);
```

### Caching Strategies

```typescript
{
  hooks: {
    afterFinalize: async (image) => {
      // Cache public URLs
      if (image.isPublic && image.publicUrl) {
        await redis.setex(
          `image:${image.id}:url`,
          3600, // 1 hour
          image.publicUrl
        );
      }
    },
  },
}
```

## Troubleshooting

### Common Issues

1. **CORS Errors**
   - Check bucket CORS configuration
   - Verify allowed origins match your domain
   - Ensure all required methods are allowed

2. **Permission Errors**
   - Verify IAM policies for S3
   - Check R2 API token permissions
   - Ensure bucket policies allow required operations

3. **Upload Failures**
   - Check file size limits
   - Verify content type restrictions
   - Monitor presigned URL expiration

4. **Performance Issues**
   - Use multipart uploads for large files
   - Configure appropriate part sizes
   - Implement connection pooling

### Debug Mode

```typescript
{
  storage: {
    adapter: 's3',
    debug: process.env.NODE_ENV === 'development',
    // ... other config
  },
}
```

### Monitoring

```typescript
{
  hooks: {
    beforePresign: async (context) => {
      console.log('Generating presigned URL for:', context.filename);
      return context;
    },
    afterFinalize: async (image) => {
      console.log('Upload completed:', image.id);
      // Send to monitoring service
      monitoring.track('upload_success', {
        imageId: image.id,
        size: image.byteSize,
        storage: 's3',
      });
    },
  },
}
```