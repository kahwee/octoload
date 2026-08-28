# React Router Example

This example shows how to integrate Octoload with a React Router v7 application.

## Setup

1. **Install dependencies**
   ```bash
   pnpm add octoload drizzle-orm drizzle-kit @aws-sdk/client-s3
   ```

2. **Initialize Octoload**
   ```bash
   pnpm dlx octoload init --adapter s3 --framework react-router
   ```

3. **Update environment**
   ```bash
   # Copy from .env.example
   S3_BUCKET=my-app-uploads
   S3_REGION=us-east-1
   S3_ACCESS_KEY_ID=AKIA...
   S3_SECRET_ACCESS_KEY=...
   DATABASE_URL=postgresql://...
   ```

4. **Generate schemas and migrate**
   ```bash
   pnpm dlx octoload generate
   pnpm dlx octoload migrate
   ```

## Configuration

```typescript
// app/lib/octoload/config.ts
import type { OctoloadConfig } from 'octoload';
import { auth } from '~/lib/auth.server';

export const octoloadConfig: OctoloadConfig = {
  storage: {
    adapter: 's3',
    bucket: process.env.S3_BUCKET!,
    region: process.env.S3_REGION!,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  },
  limits: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxVariants: 3,
  },
  hooks: {
    beforePresign: async (context) => {
      // Add owner validation
      if (!context.ownerId) {
        throw new Error('Authentication required');
      }
      return context;
    },
    afterFinalize: async (image) => {
      console.log(\`Image \${image.id} uploaded successfully\`);
    },
  },
};
```

## Route Handlers

### Upload Routes

```typescript
// app/routes/api.uploads.presign.ts
import type { ActionFunctionArgs } from 'react-router';
import { createPresignHandler } from 'octoload/react-router';
import { octoloadConfig } from '~/lib/octoload/config';
import { db } from '~/db';
import * as uploadSchema from '~/db/upload-schema';
import { requireAuth } from '~/lib/auth.server';

const handler = createPresignHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
  getUser: async ({ request }) => {
    return await requireAuth(request);
  },
});

export async function action({ request }: ActionFunctionArgs) {
  return handler({ request, params: {} });
}
```

```typescript
// app/routes/api.uploads.finalize.ts
import type { ActionFunctionArgs } from 'react-router';
import { createFinalizeHandler } from 'octoload/react-router';
import { octoloadConfig } from '~/lib/octoload/config';
import { db } from '~/db';
import * as uploadSchema from '~/db/upload-schema';

const handler = createFinalizeHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
});

export async function action({ request }: ActionFunctionArgs) {
  return handler({ request, params: {} });
}
```

### Image Routes

```typescript
// app/routes/api.images.$imageId.ts
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { 
  createGetImageHandler, 
  createDeleteImageHandler 
} from 'octoload/react-router';
import { octoloadConfig } from '~/lib/octoload/config';
import { db } from '~/db';
import * as uploadSchema from '~/db/upload-schema';
import { getUser } from '~/lib/auth.server';

const getHandler = createGetImageHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
  getUser: async ({ request }) => {
    return await getUser(request);
  },
});

const deleteHandler = createDeleteImageHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
  getUser: async ({ request }) => {
    return await getUser(request);
  },
});

export async function loader({ request, params }: LoaderFunctionArgs) {
  return getHandler({ request, params });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method === 'DELETE') {
    return deleteHandler({ request, params });
  }
  
  return new Response('Method not allowed', { status: 405 });
}
```

## Client Component

```typescript
// app/components/image-uploader.tsx
import { useState } from 'react';
import { createUploadClient } from 'octoload/client';

const uploadClient = createUploadClient({
  baseUrl: window.location.origin,
});

export function ImageUploader() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadState, setUploadState] = useState<string>('');

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    
    try {
      const results = await uploadClient.uploadMultiple(files, {
        isPublic: true,
        onProgress: (prog) => {
          setProgress(prog.percentage);
        },
        onStateChange: (state) => {
          setUploadState(state);
        },
      });

      console.log('Uploaded images:', results);
      setFiles([]);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
      setProgress(0);
      setUploadState('');
    }
  };

  return (
    <div className="upload-container">
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => setFiles(Array.from(e.target.files || []))}
        disabled={uploading}
      />
      
      {files.length > 0 && (
        <div>
          <p>{files.length} files selected</p>
          <button onClick={handleUpload} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload Images'}
          </button>
        </div>
      )}

      {uploading && (
        <div>
          <p>State: {uploadState}</p>
          <progress value={progress} max={100}>{progress}%</progress>
        </div>
      )}
    </div>
  );
}
```

## Database Integration

```typescript
// app/models/image.server.ts
import { eq, and, desc } from 'drizzle-orm';
import { db } from '~/db';
import { images, imageTags } from '~/db/upload-schema';

export async function getUserImages(userId: string) {
  return await db
    .select()
    .from(images)
    .where(and(
      eq(images.ownerId, userId),
      eq(images.status, 'ready')
    ))
    .orderBy(desc(images.createdAt));
}

export async function getImageWithTags(imageId: string) {
  const [image] = await db
    .select()
    .from(images)
    .where(eq(images.id, imageId));

  if (!image) return null;

  const tags = await db
    .select({ tag: imageTags.tag })
    .from(imageTags)
    .where(eq(imageTags.imageId, imageId));

  return {
    ...image,
    tags: tags.map(t => t.tag),
  };
}
```

## Auth Integration

```typescript
// app/lib/auth.server.ts
import { redirect } from 'react-router';

export async function requireAuth(request: Request) {
  // Your auth logic here
  const userId = await getUserId(request);
  
  if (!userId) {
    throw redirect('/login');
  }

  return { id: userId };
}

export async function getUser(request: Request) {
  // Optional auth - returns null if not authenticated
  const userId = await getUserId(request);
  return userId ? { id: userId } : null;
}
```

This example provides a complete integration with authentication, database operations, and client-side upload handling.