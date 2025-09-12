# API Reference

Complete API reference for Octoload server endpoints and client methods.

## Server API Endpoints

### Upload Endpoints

#### POST /api/uploads/presign

Generate a presigned URL for direct file upload to storage.

**Request Body:**
```typescript
{
  filename: string;           // Original filename
  contentType: string;        // MIME type (e.g., 'image/jpeg')
  byteSize: number;          // File size in bytes
  strategy?: 'single' | 'multipart'; // Upload strategy
  ownerId?: string;          // User ID who owns the file
  orgId?: string;            // Organization ID
  isPublic?: boolean;        // Whether file is publicly accessible
  alt?: string;              // Alt text for accessibility
  title?: string;            // Display title
  tags?: string[];           // Array of tags
}
```

**Response:**
```typescript
{
  storageKey: string;        // Unique storage identifier
  uploadUrl?: string;        // Direct upload URL (single strategy)
  multipart?: {              // Multipart upload (multipart strategy)
    uploadId: string;
    parts: Array<{
      partNumber: number;
      uploadUrl: string;
    }>;
  };
  headers?: Record<string, string>; // Additional headers
  fields?: Record<string, string>;  // Form fields
  expiresAt: string;         // ISO date when URL expires
}
```

**Example:**
```bash
curl -X POST https://api.example.com/api/uploads/presign \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "filename": "photo.jpg",
    "contentType": "image/jpeg",
    "byteSize": 1048576,
    "isPublic": true,
    "alt": "Vacation photo"
  }'
```

#### POST /api/uploads/finalize

Finalize an upload and create the image record.

**Request Body:**
```typescript
{
  storageKey: string;        // Storage key from presign response
  checksum?: string;         // SHA-256 checksum (optional)
  parts?: Array<{            // Required for multipart uploads
    partNumber: number;
    etag: string;            // ETag returned from part upload
  }>;
  tags?: string[];           // Additional tags to add
}
```

**Response:**
```typescript
{
  id: string;                // Unique image ID
  ownerId?: string;          // Owner user ID
  orgId?: string;            // Organization ID
  filename: string;          // Original filename
  contentType: string;       // MIME type
  byteSize: number;          // File size in bytes
  status: 'processing' | 'ready' | 'failed';
  storageKey: string;        // Storage identifier
  publicUrl?: string;        // Public URL (if isPublic: true)
  checksum?: string;         // File checksum
  alt?: string;              // Alt text
  title?: string;            // Display title
  isPublic: boolean;         // Public accessibility
  createdAt: string;         // ISO creation date
  updatedAt: string;         // ISO update date
}
```

### Image Management Endpoints

#### GET /api/images/:id

Retrieve image metadata and access URL.

**Parameters:**
- `id` (string): Image ID

**Response:**
```typescript
{
  image: {
    id: string;
    ownerId?: string;
    filename: string;
    contentType: string;
    byteSize: number;
    status: string;
    alt?: string;
    title?: string;
    isPublic: boolean;
    createdAt: string;
    updatedAt: string;
  };
  url: string;               // Access URL (public or signed)
}
```

**Example:**
```bash
curl https://api.example.com/api/images/cm2abc123 \
  -H "Authorization: Bearer your-token"
```

#### DELETE /api/images/:id

Delete an image and its storage object.

**Parameters:**
- `id` (string): Image ID

**Response:**
- Status: 204 No Content

**Example:**
```bash
curl -X DELETE https://api.example.com/api/images/cm2abc123 \
  -H "Authorization: Bearer your-token"
```

## Client SDK Reference

### OctoloadClient

Main client class for interacting with Octoload API.

#### Constructor

```typescript
import { OctoloadClient } from 'octoload/client';

const client = new OctoloadClient({
  baseUrl: string;           // API base URL
  apiKey?: string;           // Optional API key
  headers?: Record<string, string>; // Custom headers
});
```

#### Methods

##### uploadFile()

Upload a single file with progress tracking.

```typescript
async uploadFile(
  file: File,
  options?: UploadOptions
): Promise<UploadResult>
```

**Parameters:**
```typescript
interface UploadOptions {
  strategy?: 'single' | 'multipart';
  ownerId?: string;
  orgId?: string;
  isPublic?: boolean;
  alt?: string;
  title?: string;
  tags?: string[];
  onProgress?: (progress: {
    loaded: number;
    total: number;
    percentage: number;
  }) => void;
  onStateChange?: (state: 
    'presigning' | 'uploading' | 'finalizing' | 'completed' | 'error'
  ) => void;
}

interface UploadResult {
  image: ImageRecord;
  url?: string;
}
```

**Example:**
```typescript
const file = document.querySelector('input[type="file"]').files[0];

const result = await client.uploadFile(file, {
  isPublic: true,
  alt: 'Product image',
  tags: ['product', 'featured'],
  onProgress: (progress) => {
    console.log(`Upload: ${progress.percentage}%`);
  },
  onStateChange: (state) => {
    console.log('State:', state);
  },
});

console.log('Uploaded image:', result.image.id);
```

##### uploadMultiple()

Upload multiple files with concurrency control.

```typescript
async uploadMultiple(
  files: File[],
  options?: UploadOptions
): Promise<UploadResult[]>
```

**Example:**
```typescript
const files = Array.from(document.querySelector('input[type="file"]').files);

const results = await client.uploadMultiple(files, {
  isPublic: false,
  onProgress: (progress) => {
    console.log(
      `File ${progress.fileIndex + 1}/${progress.totalFiles}: ${progress.percentage}%`
    );
  },
});

console.log(`Uploaded ${results.length} files`);
```

##### getImage()

Retrieve image metadata and access URL.

```typescript
async getImage(imageId: string): Promise<{
  image: ImageRecord;
  url: string;
}>
```

**Example:**
```typescript
const { image, url } = await client.getImage('cm2abc123');
console.log(`Image: ${image.filename}, URL: ${url}`);
```

##### deleteImage()

Delete an image.

```typescript
async deleteImage(imageId: string): Promise<void>
```

**Example:**
```typescript
await client.deleteImage('cm2abc123');
console.log('Image deleted');
```

### Utility Functions

#### createUploadClient()

Factory function to create an OctoloadClient instance.

```typescript
import { createUploadClient } from 'octoload/client';

const client = createUploadClient({
  baseUrl: 'https://api.example.com',
  apiKey: 'your-api-key',
});
```

#### validateFile()

Validate a file against size and type constraints.

```typescript
import { validateFile } from 'octoload/client';

const file = document.querySelector('input[type="file"]').files[0];

const error = validateFile(file, {
  maxSize: 10 * 1024 * 1024,  // 10MB
  allowedTypes: ['image/*'],
});

if (error) {
  console.error('File validation failed:', error);
} else {
  // File is valid, proceed with upload
}
```

## Type Definitions

### Core Types

```typescript
interface ImageRecord {
  id: string;
  ownerId?: string;
  orgId?: string;
  filename: string;
  contentType: string;
  byteSize: number;
  status: 'processing' | 'ready' | 'failed';
  storageKey: string;
  publicUrl?: string;
  checksum?: string;
  alt?: string;
  title?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PresignRequest {
  filename: string;
  contentType: string;
  byteSize: number;
  strategy?: 'single' | 'multipart';
  ownerId?: string;
  orgId?: string;
  isPublic?: boolean;
  alt?: string;
  title?: string;
  tags?: string[];
}

interface PresignResponse {
  storageKey: string;
  uploadUrl?: string;
  multipart?: {
    uploadId: string;
    parts: { partNumber: number; uploadUrl: string }[];
  };
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  expiresAt: Date;
}
```

### Configuration Types

```typescript
interface OctoloadConfig {
  storage: StorageAdapter;
  limits: OctoloadLimits;
  hooks?: OctoloadHooks;
  db?: {
    schema?: string;
    tablePrefix?: string;
  };
}

interface StorageAdapter {
  adapter: 's3' | 'r2';
  bucket: string;
  region: string;
  endpoint?: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

interface OctoloadLimits {
  maxFileSize: number;
  allowedTypes: string[];
  maxVariants: number;
}
```

## Error Handling

### HTTP Status Codes

- `200 OK` - Successful request
- `204 No Content` - Successful deletion
- `400 Bad Request` - Invalid request data
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `413 Payload Too Large` - File exceeds size limits
- `415 Unsupported Media Type` - Invalid content type
- `500 Internal Server Error` - Server error

### Error Response Format

```typescript
{
  error: string;             // Human-readable error message
  code?: string;             // Machine-readable error code
  details?: Record<string, any>; // Additional error details
}
```

### Common Error Codes

- `FILE_TOO_LARGE` - File exceeds maximum size
- `INVALID_FILE_TYPE` - File type not allowed
- `UPLOAD_EXPIRED` - Presigned URL expired
- `CHECKSUM_MISMATCH` - File integrity check failed
- `STORAGE_ERROR` - Storage provider error
- `AUTHENTICATION_REQUIRED` - Missing authentication
- `ACCESS_DENIED` - Insufficient permissions

### Client Error Handling

```typescript
try {
  const result = await client.uploadFile(file);
  console.log('Upload successful:', result.image.id);
} catch (error) {
  if (error.message.includes('FILE_TOO_LARGE')) {
    console.error('File is too large');
  } else if (error.message.includes('INVALID_FILE_TYPE')) {
    console.error('File type not supported');
  } else {
    console.error('Upload failed:', error.message);
  }
}
```

## Rate Limiting

API endpoints may be rate limited:

- **Presign**: 100 requests per minute per user
- **Finalize**: 100 requests per minute per user
- **Get Image**: 1000 requests per minute per user
- **Delete**: 50 requests per minute per user

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## Authentication

### Bearer Token

```bash
curl -H "Authorization: Bearer your-api-token" \
  https://api.example.com/api/images/cm2abc123
```

### API Key Header

```bash
curl -H "X-API-Key: your-api-key" \
  https://api.example.com/api/images/cm2abc123
```

### Framework Integration

See framework-specific guides for authentication integration:
- [Next.js Authentication](./frameworks/nextjs.md#authentication)
- [React Router Authentication](./frameworks/react-router.md#authentication)