import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Document.storageKey is internal: it is left out of every result unless a query selects it explicitly,
  // so file locations are never returned to the browser or the company portal.
  constructor() { super({ omit: { document: { storageKey: true } } }); }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
