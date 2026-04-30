import swaggerJsdoc from 'swagger-jsdoc';
import * as path from 'path';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Kryton API',
      version: '3.2.0',
      description: 'API for Kryton - a personal knowledge base with wiki-style linking, graph visualization, and markdown editing.',
    },
    servers: [
      { url: '/api', description: 'API server' },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description: 'Session cookie set by the authentication system',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key with kryton_ prefix (e.g. kryton_a1b2c3d4...)',
        },
      },
    },
    security: [
      { cookieAuth: [] },
      { bearerAuth: [] },
    ],
  },
  apis: [
    path.join(import.meta.dirname, 'routes', '*.ts'),
    path.join(import.meta.dirname, 'routes', '*.js'),
    path.join(import.meta.dirname, 'index.ts'),
    path.join(import.meta.dirname, 'index.js'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
