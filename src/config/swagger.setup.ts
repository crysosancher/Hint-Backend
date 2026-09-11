import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Name of the security scheme registered for JWT bearer tokens. */
export const SWAGGER_BEARER_AUTH = 'access-token';

/**
 * Builds the OpenAPI document metadata. Kept separate from the app so tests can
 * generate and inspect the document without starting an HTTP listener.
 *
 * Note: `DocumentBuilder.build()` returns the document *without* `paths` — that
 * is added later by `SwaggerModule.createDocument` from the route metadata.
 */
export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('Hint Backend API')
    .setDescription(
      [
        'Hyperlocal matchmaking platform. A user may discover, or initiate interest',
        'toward, another user only when both are actively discoverable (Nearby Mode)',
        'and their latest valid locations are within **250 metres**. The distance check',
        'is server-authoritative and exact coordinates are never exposed.',
        '',
        'Authenticate with a JWT access token from `POST /api/v1/auth/login` and pass it',
        'as a Bearer token.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT access token issued by the Auth module',
      },
      SWAGGER_BEARER_AUTH,
    )
    .addTag('Health', 'Liveness and readiness probes (served outside the /api/v1 prefix)')
    .addTag('Auth', 'Registration, login and refresh-token rotation')
    .build();
}

/** Generates the OpenAPI document for the given application instance. */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildSwaggerConfig());
}

/**
 * Mounts the Swagger UI at `path` (outside the global API prefix) plus a raw
 * JSON document at `<path>/json`. Returns the generated document.
 */
export function setupSwagger(app: INestApplication, path: string): OpenAPIObject {
  const normalized = path.replace(/^\/+|\/+$/g, '');
  const document = createOpenApiDocument(app);

  SwaggerModule.setup(normalized, app, document, {
    jsonDocumentUrl: `${normalized}/json`,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
    },
  });

  return document;
}
