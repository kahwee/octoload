# Getting Started

This guide will help you set up Octoload in your project for direct-to-storage image uploads.

## Installation

```bash
pnpm add octoload
# or
yarn add octoload
# or
pnpm add octoload
```

## Quick Setup

### 1. Initialize Octoload

Run the init command to scaffold configuration and routes:

```bash
pnpm dlx octoload init --adapter s3 --framework nextjs
# or for React Router
pnpm dlx octoload init --adapter r2 --framework react-router
```

This creates:
- `src/lib/octoload/config.ts` - Configuration file
- `.env.example` - Environment variables template
- API route handlers for your framework
- Drizzle configuration updates

### 2. Environment Setup

Copy the generated environment variables to your `.env` file:

```bash
# S3 Configuration
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key

# Database
DATABASE_URL=postgresql://...
```

### 3. Generate Database Schema

Generate the Drizzle schemas for image uploads:

```bash
pnpm dlx octoload generate
```

This creates `src/db/upload-schema.ts` with tables for:
- **images** - Main image records with metadata
- **upload_sessions** - Multipart upload tracking
- **asset_variants** - Image processing variants
- **image_tags** - Tagging system

### 4. Run Migrations

Apply the database migrations:

```bash
pnpm dlx octoload migrate
```

## Basic Usage

### Client-Side Upload

```typescript
import { createUploadClient } from 'octoload/client';

const client = createUploadClient({
  baseUrl: 'https://your-app.com',
});

// Upload a single file
const file = document.querySelector('input[type="file"]').files[0];
const result = await client.uploadFile(file, {
  isPublic: true,
  alt: 'Product image',
  tags: ['product', 'featured'],
  onProgress: (progress) => {
    console.log(`${progress.percentage}% uploaded`);
  },
});

console.log('Uploaded:', result.image);
```

### Server-Side Configuration

#### Next.js App Router

```typescript
// app/api/uploads/presign/route.ts
import { NextRequest } from 'next/server';
import { createPresignHandler } from 'octoload/nextjs';
import { octoloadConfig } from '@/lib/octoload/config';
import { db } from '@/db';
import * as uploadSchema from '@/db/upload-schema';

const handler = createPresignHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
  getUser: async (request) => {
    // Your auth logic here
    return { id: 'user-id' };
  },
});

export async function POST(request: NextRequest) {
  return handler(request);
}
```

#### React Router

```typescript
// app/routes/api.uploads.presign.ts
import type { ActionFunctionArgs } from 'react-router';
import { createPresignHandler } from 'octoload/react-router';
import { octoloadConfig } from '~/lib/octoload/config';

const handler = createPresignHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
});

export async function action({ request }: ActionFunctionArgs) {
  return handler({ request, params: {} });
}
```

## Upload Flow

1. **Client requests presigned URL** → `POST /api/uploads/presign`
2. **Server generates presigned URL** → Returns upload URL + metadata
3. **Client uploads directly to storage** → Bypasses your server
4. **Client finalizes upload** → `POST /api/uploads/finalize`
5. **Server verifies and stores metadata** → Image ready for use

This approach scales infinitely since your server only handles metadata, not file transfers.

## Next Steps

- [Configuration Guide](./configuration.md) - Detailed configuration options
- [Storage Adapters](./storage-adapters.md) - S3, R2, and custom adapters
- [Security Guide](./security.md) - Access controls and validation
- [API Reference](./api-reference.md) - Complete API documentation
- [Examples](../examples/) - Complete integration examples