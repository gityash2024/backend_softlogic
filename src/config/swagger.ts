import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';
import { appVersionMetadata } from './version';

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Softlogic Whiteboard API',
      version: appVersionMetadata.version,
      description: 'API documentation for the Softlogic Whiteboard application',
      contact: {
        name: 'Softlogic Team',
      },
    },
    servers: [
      {
        url: 'https://softlogic-api.mymultimeds.com/api/v1',
        description: 'Production server',
      },
      {
        url: `http://localhost:${env.PORT}/api/${env.API_VERSION}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            message: { type: 'string' },
            errors: { type: 'array', items: { type: 'object' } },
            meta: { type: 'object' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/modules/**/*.routes.ts', './src/modules/**/*.controller.ts'],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);
