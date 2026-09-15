import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main(){console.log('Seed vide : aucune donnée statique ou de démonstration n’est créée.');}
main().finally(async()=>prisma.$disconnect());
