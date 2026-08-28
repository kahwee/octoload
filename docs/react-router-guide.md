# React Router v7 Framework Mode Guide

Complete guide for integrating Octoload with React Router v7 in framework mode (formerly Remix).

## Overview

React Router v7 framework mode provides file-based routing with server-side rendering, making it ideal for full-stack applications with image upload capabilities.

## Installation & Setup

### 1. Initialize Project

```bash
# Create new React Router v7 project
pnpm dlx create-react-router@latest my-app --template=typescript

cd my-app
pnpm add octoload drizzle-orm
```

### 2. Initialize Octoload

```bash
# Initialize with React Router adapter
pnpm dlx octoload init --adapter s3 --framework react-router
```

This creates:
- `app/lib/octoload/config.ts` - Configuration file
- `app/routes/api.uploads.*.ts` - API route handlers
- `.env.example` - Environment variables template
- Updated `drizzle.config.ts` with upload schema

### 3. Environment Setup

```bash
# Copy from .env.example to .env
cp .env.example .env
```

Update `.env` with your credentials:
```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/myapp

# S3 Configuration
S3_BUCKET=my-app-uploads
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
```

### 4. Generate Schemas & Migrate

```bash
# Generate upload schema
pnpm dlx octoload generate --output app/db/upload-schema.ts

# Generate and apply migrations
pnpm run db:generate
pnpm run db:migrate
```

## Server-Side Integration

### Route Handlers

Octoload generates these API routes automatically:

#### Upload Presign Handler

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
    // Your authentication logic
    const user = await requireAuth(request);
    return { id: user.id };
  },
});

export async function action({ request }: ActionFunctionArgs) {
  return handler({ request, params: {} });
}
```

#### Upload Finalize Handler

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

#### Image Management Routes

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
import { getOptionalUser } from '~/lib/auth.server';

const getHandler = createGetImageHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
  getUser: async ({ request }) => {
    return await getOptionalUser(request);
  },
});

const deleteHandler = createDeleteImageHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
  getUser: async ({ request }) => {
    return await getOptionalUser(request);
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

## Client-Side Integration

### Basic Upload Component

```typescript
// app/components/image-uploader.tsx
import { useState } from 'react';
import { createUploadClient } from 'octoload/client';

const client = createUploadClient({
  baseUrl: window.location.origin,
});

interface ImageUploaderProps {
  onUpload?: (imageId: string) => void;
  multiple?: boolean;
}

export function ImageUploader({ onUpload, multiple = false }: ImageUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [uploadState, setUploadState] = useState<string>('');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    setFiles(selectedFiles);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setProgress({});

    try {
      if (multiple && files.length > 1) {
        // Upload multiple files
        const results = await client.uploadMultiple(files, {
          isPublic: true,
          onProgress: (prog: any) => {
            setProgress(prev => ({
              ...prev,
              [prog.fileIndex || 0]: prog.percentage,
            }));
          },
          onStateChange: (state) => {
            setUploadState(state);
          },
        });

        results.forEach(result => onUpload?.(result.image.id));
      } else {
        // Upload single file
        const result = await client.uploadFile(files[0], {
          isPublic: true,
          onProgress: (prog) => {
            setProgress({ 0: prog.percentage });
          },
          onStateChange: (state) => {
            setUploadState(state);
          },
        });

        onUpload?.(result.image.id);
      }

      // Reset form
      setFiles([]);
      setProgress({});
      setUploadState('');
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadState('error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        onChange={handleFileChange}
        disabled={uploading}
        className="block w-full text-sm text-gray-500
          file:mr-4 file:py-2 file:px-4
          file:rounded-full file:border-0
          file:text-sm file:font-semibold
          file:bg-blue-50 file:text-blue-700
          hover:file:bg-blue-100"
      />

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            {files.length} file{files.length !== 1 ? 's' : ''} selected
          </p>

          <button
            onClick={handleUpload}
            disabled={uploading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md
              hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : 'Upload Images'}
          </button>
        </div>
      )}

      {uploading && (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">State: {uploadState}</p>

          {Object.entries(progress).map(([fileIndex, percentage]) => (
            <div key={fileIndex} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>File {parseInt(fileIndex) + 1}</span>
                <span>{percentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Advanced Upload with Drag & Drop

```typescript
// app/components/drag-drop-uploader.tsx
import { useState, useRef, useCallback } from 'react';
import { createUploadClient, validateFile } from 'octoload/client';

const client = createUploadClient({
  baseUrl: window.location.origin,
});

export function DragDropUploader() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const validFiles = droppedFiles.filter(file => {
      const error = validateFile(file, {
        maxSize: 10 * 1024 * 1024, // 10MB
        allowedTypes: ['image/*'],
      });

      if (error) {
        console.warn(`Skipping ${file.name}: ${error}`);
        return false;
      }

      return true;
    });

    setFiles(prev => [...prev, ...validFiles]);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async () => {
    if (files.length === 0) return;

    setUploading(true);

    try {
      const results = await client.uploadMultiple(files, {
        isPublic: true,
        onProgress: (progress: any) => {
          // Handle progress updates
        },
      });

      console.log('Uploaded images:', results.map(r => r.image.id));
      setFiles([]);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
          }
        `}
      >
        <div className="space-y-2">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            stroke="currentColor"
            fill="none"
            viewBox="0 0 48 48"
          >
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="text-gray-600">
            <span className="font-medium text-blue-600">Click to upload</span> or
            drag and drop
          </div>
          <p className="text-xs text-gray-500">
            PNG, JPG, GIF up to 10MB
          </p>
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* File List */}
      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="font-medium text-gray-900">
            Selected Files ({files.length})
          </h4>

          <div className="space-y-2 max-h-40 overflow-y-auto">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-gray-50 rounded"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  className="ml-2 text-red-500 hover:text-red-700"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={uploadFiles}
            disabled={uploading}
            className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-md
              hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : `Upload ${files.length} Files`}
          </button>
        </div>
      )}
    </div>
  );
}
```

## Database Integration

### Querying Images

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

export async function getPublicImages(limit = 20, offset = 0) {
  return await db
    .select()
    .from(images)
    .where(and(
      eq(images.isPublic, true),
      eq(images.status, 'ready')
    ))
    .limit(limit)
    .offset(offset)
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

### Route with Image Loading

```typescript
// app/routes/gallery.tsx
import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { getUserImages } from '~/models/image.server';
import { requireAuth } from '~/lib/auth.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireAuth(request);
  const images = await getUserImages(user.id);

  return { images };
}

export default function Gallery() {
  const { images } = useLoaderData<typeof loader>();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {images.map((image) => (
        <div key={image.id} className="bg-white rounded-lg shadow-md overflow-hidden">
          <img
            src={image.publicUrl || `/api/images/${image.id}`}
            alt={image.alt || image.filename}
            className="w-full h-48 object-cover"
          />
          <div className="p-4">
            <h3 className="font-medium text-gray-900">
              {image.title || image.filename}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {new Date(image.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

## Authentication Integration

### With Better Auth

```typescript
// app/lib/auth.server.ts
import { auth } from '~/lib/auth';

export async function requireAuth(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    throw redirect('/login');
  }

  return session.user;
}

export async function getOptionalUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user || null;
}
```

### Protecting Upload Routes

```typescript
// app/routes/api.uploads.presign.ts
import { createPresignHandler } from 'octoload/react-router';
import { requireAuth } from '~/lib/auth.server';

const handler = createPresignHandler({
  config: octoloadConfig,
  db,
  schema: uploadSchema,
  getUser: async ({ request }) => {
    // Require authentication for uploads
    const user = await requireAuth(request);
    return { id: user.id };
  },
});
```

## Configuration

### Octoload Config

```typescript
// app/lib/octoload/config.ts
import type { OctoloadConfig } from 'octoload';

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
    allowedTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ],
    maxVariants: 5,
  },
  hooks: {
    beforePresign: async (context) => {
      // Add user context for ownership
      if (!context.ownerId) {
        throw new Error('Authentication required');
      }

      // Custom filename with timestamp
      const timestamp = Date.now();
      context.filename = `${timestamp}-${context.filename}`;

      return context;
    },
    afterFinalize: async (image) => {
      console.log(`Image uploaded: ${image.id} by user ${image.ownerId}`);

      // Trigger any post-processing
      // await imageProcessor.generateThumbnails(image.id);
    },
  },
};
```

## Error Handling

### Global Error Boundary

```typescript
// app/components/error-boundary.tsx
import { useRouteError, isRouteErrorResponse } from 'react-router';

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    if (error.status === 413) {
      return <div>File too large. Please choose a smaller file.</div>;
    }

    if (error.status === 415) {
      return <div>File type not supported. Please choose an image file.</div>;
    }
  }

  return <div>Something went wrong. Please try again.</div>;
}
```

## Performance Optimization

### Image Component with Lazy Loading

```typescript
// app/components/lazy-image.tsx
import { useState, useRef, useEffect } from 'react';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholder?: string;
}

export function LazyImage({ src, alt, className, placeholder }: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className={className}>
      {isInView && (
        <img
          src={src}
          alt={alt}
          onLoad={() => setIsLoaded(true)}
          className={`transition-opacity duration-300 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      {!isLoaded && (
        <div className="bg-gray-200 animate-pulse w-full h-full" />
      )}
    </div>
  );
}
```

## Deployment

### Environment Variables

Ensure all environment variables are set in production:

```bash
DATABASE_URL=postgresql://...
S3_BUCKET=prod-app-uploads
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
```

### Build Process

```json
{
  "scripts": {
    "build": "react-router build",
    "postbuild": "pnpm dlx octoload migrate --generate-only",
    "start": "react-router-serve ./build/server/index.js"
  }
}
```

This guide provides everything you need to integrate Octoload with React Router v7 framework mode. The generated API routes handle the server-side logic, while the client components provide a smooth upload experience.
