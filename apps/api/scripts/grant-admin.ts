/*
  Accorde ou retire le droit d'administrer.

    pnpm --filter @odyssai/api admin:grant <email>
    pnpm --filter @odyssai/api admin:grant <email> --revoke

  Cette bascule n'a volontairement aucune route : un tableau de bord capable
  de nommer des administrateurs transformerait une session volee en prise de
  controle definitive. Il faut un acces a la base, donc au serveur.

  L'adresse est un miroir du realm et n'est pas unique : si deux lignes la
  portent, le script refuse plutot que de choisir a votre place.
*/
import { createPrismaClient, loadRootEnvFile } from '@odyssai/db';

loadRootEnvFile(new URL('..', import.meta.url).pathname);

const [email, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');

if (!email) {
  console.error('Usage : admin:grant <email> [--revoke]');
  process.exit(1);
}

const prisma = createPrismaClient(process.env.POSTGRES_URL ?? '');

try {
  const users = await prisma.user.findMany({
    where: { email },
    select: { id: true, username: true, isAdmin: true },
  });

  if (users.length === 0) {
    console.error(
      'Aucun joueur avec cette adresse. Connectez-vous une fois au site : la ligne nait au retour de Keycloak, pas a l inscription.',
    );
    process.exit(1);
  }

  if (users.length > 1) {
    console.error(
      `${users.length} joueurs portent cette adresse. Passez par db:studio pour choisir.`,
    );
    process.exit(1);
  }

  const user = users[0]!;
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: !revoke },
    select: { id: true, username: true, isAdmin: true },
  });

  console.log(
    `${updated.username ?? updated.id} : administrateur ${updated.isAdmin ? 'accorde' : 'retire'}`,
  );
} finally {
  await prisma.$disconnect();
}
