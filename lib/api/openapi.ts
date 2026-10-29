import { z } from "zod";
import { createDocument } from "zod-openapi";
import pkg from "../../package.json" with { type: "json" };
import {
  AuthUrlSchema,
  CreateAuthUrlSchema,
  CreateSocialPostBaseSchema,
  CreateSocialPostSchema,
  CreateUploadUrlSchema,
  CreateWebhookEndpointSchema,
  ListSchema,
  ProblemSchema,
  SocialAccountSchema,
  SocialPostResultSchema,
  SocialPostSchema,
  UploadUrlSchema,
  WebhookEndpointSchema,
} from "./schemas";

const problemContent = {
  "application/problem+json": { schema: ProblemSchema },
};
const errors = {
  "401": { description: "Missing or invalid API key", content: problemContent },
  "422": { description: "Validation failed", content: problemContent },
  "429": { description: "Rate limited", content: problemContent },
};
const json = (schema: z.ZodType) => ({ "application/json": { schema } });
const ok = (description: string, schema: z.ZodType) => ({
  description,
  content: json(schema),
});
const idParam = { path: z.object({ id: z.uuid() }) };
const idemHeader = z.object({
  "Idempotency-Key": z.string().max(255).optional(),
});

type Op = {
  operationId: string;
  summary: string;
  tag: string;
  post?: boolean;
  params?: Record<string, z.ZodObject>;
  body?: z.ZodType;
  status?: "200" | "201" | "204";
  res?: z.ZodType;
};

function op(o: Op) {
  const status = o.status ?? "200";
  const requestParams: Record<string, z.ZodObject> = { ...o.params };
  if (o.post) requestParams.header = idemHeader;
  return {
    operationId: o.operationId,
    summary: o.summary,
    tags: [o.tag],
    ...(Object.keys(requestParams).length ? { requestParams } : {}),
    ...(o.body ? { requestBody: { content: json(o.body) } } : {}),
    responses: {
      [status]: o.res ? ok("Success", o.res) : { description: "No content" },
      ...errors,
    },
  };
}

const ACC = "Social accounts";
const POSTS = "Social posts";

export function buildOpenApi(): Record<string, unknown> {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "PostPipe API",
      version: pkg.version,
      description: "Unified social publishing API.",
      license: { name: "Proprietary" },
    },
    servers: [
      { url: "https://postpipe.com/v1" },
      { url: "http://localhost:3000/v1" },
    ],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/social-accounts/auth-url": {
        post: op({
          operationId: "createAuthUrl",
          summary: "Create an account connect URL",
          tag: ACC,
          post: true,
          body: CreateAuthUrlSchema,
          res: AuthUrlSchema,
        }),
      },
      "/social-accounts": {
        get: op({
          operationId: "listSocialAccounts",
          summary: "List social accounts",
          tag: ACC,
          res: ListSchema(SocialAccountSchema),
        }),
      },
      "/social-accounts/{id}": {
        get: op({
          operationId: "getSocialAccount",
          summary: "Get a social account",
          tag: ACC,
          params: idParam,
          res: SocialAccountSchema,
        }),
        delete: op({
          operationId: "deleteSocialAccount",
          summary: "Delete a social account",
          tag: ACC,
          params: idParam,
          status: "204",
        }),
      },
      "/social-accounts/{id}/disconnect": {
        post: op({
          operationId: "disconnectSocialAccount",
          summary: "Disconnect a social account",
          tag: ACC,
          post: true,
          params: idParam,
          res: SocialAccountSchema,
        }),
      },
      "/media/create-upload-url": {
        post: op({
          operationId: "createUploadUrl",
          summary: "Create a media upload URL",
          tag: "Media",
          post: true,
          body: CreateUploadUrlSchema,
          res: UploadUrlSchema,
        }),
      },
      "/social-posts": {
        post: op({
          operationId: "createSocialPost",
          summary: "Create a social post",
          tag: POSTS,
          post: true,
          body: CreateSocialPostSchema,
          status: "201",
          res: SocialPostSchema,
        }),
        get: op({
          operationId: "listSocialPosts",
          summary: "List social posts",
          tag: POSTS,
          res: ListSchema(SocialPostSchema),
        }),
      },
      "/social-posts/{id}": {
        get: op({
          operationId: "getSocialPost",
          summary: "Get a social post",
          tag: POSTS,
          params: idParam,
          res: SocialPostSchema,
        }),
        // Base schema: Zod 4 cannot .partial() a refined schema.
        patch: op({
          operationId: "updateSocialPost",
          summary: "Update a social post",
          tag: POSTS,
          params: idParam,
          body: CreateSocialPostBaseSchema.partial(),
          res: SocialPostSchema,
        }),
        delete: op({
          operationId: "deleteSocialPost",
          summary: "Delete a social post",
          tag: POSTS,
          params: idParam,
          status: "204",
        }),
      },
      "/social-post-results": {
        get: op({
          operationId: "listSocialPostResults",
          summary: "List social post results",
          tag: POSTS,
          params: {
            query: z.object({
              post_id: z.uuid().optional(),
              social_account_id: z.uuid().optional(),
            }),
          },
          res: ListSchema(SocialPostResultSchema),
        }),
      },
      "/webhooks": {
        post: op({
          operationId: "createWebhookEndpoint",
          summary: "Create a webhook endpoint",
          tag: "Webhooks",
          post: true,
          body: CreateWebhookEndpointSchema,
          status: "201",
          res: WebhookEndpointSchema,
        }),
        get: op({
          operationId: "listWebhookEndpoints",
          summary: "List webhook endpoints",
          tag: "Webhooks",
          res: ListSchema(WebhookEndpointSchema),
        }),
      },
      "/webhooks/{id}": {
        delete: op({
          operationId: "deleteWebhookEndpoint",
          summary: "Delete a webhook endpoint",
          tag: "Webhooks",
          params: idParam,
          status: "204",
        }),
      },
    },
  }) as unknown as Record<string, unknown>;
}
