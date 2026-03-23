import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Mnemo API',
      version: '1.0.0',
      description: 'API for Mnemo - a personal knowledge base with wiki-style linking, graph visualization, and markdown editing.',
    },
    servers: [
      { url: '/api', description: 'API server' },
    ],
  },
  apis: ['./src/routes/*.ts', './src/index.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
