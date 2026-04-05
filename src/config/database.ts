import { PrismaClient } from '@prisma/client';
import { env } from './env';

type GlobalPrismaState = typeof globalThis & {
  __softlogicPrisma?: PrismaClient;
  __softlogicPrismaConnection?: Promise<void>;
};

const globalPrisma = globalThis as GlobalPrismaState;

const createPrismaClient = () =>
  new PrismaClient({
    log:
        env.NODE_ENV === 'development'
            ? ['query', 'info', 'warn', 'error']
            : ['error'],
  });

const prisma = globalPrisma.__softlogicPrisma ?? createPrismaClient();

if (!globalPrisma.__softlogicPrisma) {
  globalPrisma.__softlogicPrisma = prisma;
}

export const connectDatabase = async (): Promise<void> => {
  if (!globalPrisma.__softlogicPrismaConnection) {
    globalPrisma.__softlogicPrismaConnection = prisma
      .$connect()
      .then(() => {
        console.log('Database connected successfully');
      })
      .catch((error) => {
        globalPrisma.__softlogicPrismaConnection = undefined;
        console.error('Database connection failed:', error);
        throw error;
      });
  }

  await globalPrisma.__softlogicPrismaConnection;
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  globalPrisma.__softlogicPrismaConnection = undefined;
};

export { prisma };
